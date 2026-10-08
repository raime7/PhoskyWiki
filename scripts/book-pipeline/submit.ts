// 提交（#112，缝 2）：把已确认、已校验、已审稿的视角整理成站点提交请求。
// 默认试运行：只写 submit/plan.json 并列出“将要发出的请求”；--send 才真正发出。
// 两阶段：第一阶段新诠释者与新词条；第二阶段新视角与编辑（编辑以 head 修订为 base）。
// 幂等：submit/ledger.jsonl 只追加；重跑只列出/发送账本里尚未完成的请求。
// 约定：占位 ID 为 0，对应的 opKey 写在 dependsOn；账本中带 pageId 的 submitted/reconciled 事件提供真实 ID。

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { requireConfirmed } from "./candidates";
import { jsonText, readJson, readJsonl, sha256, workdirLayout, writeText } from "./workdir";
import {
  SCHEMAS,
  type AssembledPerspective,
  type CandidateEntry,
  type CandidateList,
  type ConceptKey,
  type LedgerEntry,
  type PageId,
  type PlannedSubmission,
  type ReviewReport,
  type SiteExport,
  type SubmissionRequest,
  type SubmitPlan,
  type ValidationReport,
  type WorkdirManifest,
} from "./types";
import { fail } from "./errors";
import { loginPipelineAccount, siteHttp } from "./site-session";

/** 与站点 SUBMISSION_NOTE_MAX_LENGTH（src/lib/review-types.ts）一致；脚本不引入站点模块，故复制，另留余量。 */
export const NOTE_MAX_LENGTH = 20000;
const NOTE_BUDGET = 19000;
const PLACEHOLDER: PageId = 0;

// ---------------------------------------------------------------------------
// 账本
// ---------------------------------------------------------------------------

export interface OpState {
  /** done = submitted/reconciled；dangling = 有 intent 无结果（结果未知） */
  status: "done" | "dangling" | "failed";
  contentSha256: string | null;
  pageId: PageId | null;
  submissionId: number | null;
}

export function ledgerState(entries: readonly LedgerEntry[]): Map<string, OpState> {
  const states = new Map<string, OpState>();
  for (const e of entries) {
    const prev = states.get(e.opKey);
    if (e.event === "intent") {
      states.set(e.opKey, { status: "dangling", contentSha256: e.contentSha256, pageId: null, submissionId: null });
    } else if (e.event === "failed") {
      states.set(e.opKey, { status: "failed", contentSha256: e.contentSha256, pageId: null, submissionId: null });
    } else {
      states.set(e.opKey, {
        status: "done",
        contentSha256: e.contentSha256 ?? prev?.contentSha256 ?? null,
        pageId: e.pageId ?? prev?.pageId ?? null,
        submissionId: e.submissionId ?? prev?.submissionId ?? null,
      });
    }
  }
  return states;
}

export function readLedger(workdir: string): LedgerEntry[] {
  const path = workdirLayout(workdir).submit.ledger;
  return existsSync(path) ? readJsonl<LedgerEntry>(path) : [];
}

function appendLedger(workdir: string, entry: Omit<LedgerEntry, "at">): void {
  const path = workdirLayout(workdir).submit.ledger;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

// ---------------------------------------------------------------------------
// 提交说明
// ---------------------------------------------------------------------------

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)) + "…";
}

export function buildNote(opts: {
  interpreter: string;
  term: string;
  mode: "new" | "edit";
  sources: string[];
  review: ReviewReport;
  validation: ValidationReport;
}): string {
  const { review, validation } = opts;
  const lines: string[] = [
    `书籍流水线（AI 编者）${opts.mode === "edit" ? "更新" : "新建"}视角：词条「${opts.term}」，诠释者「${opts.interpreter}」。`,
    `依据来源：${opts.sources.join("；") || "（无）"}`,
    "",
    `【审稿】${review.reviewer}：${clip(review.summary, 2000)}`,
  ];
  const counts = { blocker: 0, warning: 0, note: 0 };
  for (const issue of review.issues) counts[issue.severity]++;
  lines.push(`审稿问题：blocker ${counts.blocker}，warning ${counts.warning}，note ${counts.note}。`);
  for (const issue of review.issues) {
    lines.push(`- [${issue.severity}] ${issue.claimId ?? "全篇"} ${issue.kind}：${clip(issue.message, 400)}`);
  }
  lines.push("", `【校验】${validation.ok ? "通过" : "未通过"}；findings ${validation.findings.length} 项，人工放行 ${validation.overridden.length} 项。`);
  for (const f of validation.findings) lines.push(`- [${f.severity}] ${f.rule}${f.claimId ? ` ${f.claimId}` : ""}：${clip(f.message, 300)}`);
  for (const o of validation.overridden) {
    lines.push(`- 放行 ${o.rule}${o.claimId ? ` ${o.claimId}` : ""}（${o.approvedBy}）：${clip(o.reason, 300)}`);
  }
  // 文风提示不阻断提交，但如实告诉受理者
  if (validation.hints.length) {
    lines.push("", `【文风提示】中文 AI 腔清单命中 ${validation.hints.length} 项（不阻断）：`);
    for (const h of validation.hints) lines.push(`- ${h.rule} ${h.claimId ?? "核心"}：${clip(h.message, 300)}`);
  }
  // 总长兜底：逐行累加，超出预算即截断并注明
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > NOTE_BUDGET) {
      out.push("……（说明过长，已截断；完整报告见工作目录 review.json / validation.json）");
      break;
    }
    out.push(line);
    used += line.length + 1;
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// 门禁与计划
// ---------------------------------------------------------------------------

function gate(workdir: string, key: ConceptKey, markdown: string, assembled: AssembledPerspective): { review: ReviewReport; validation: ValidationReport } {
  const paths = workdirLayout(workdir).perspective(key);
  const hash = sha256(markdown);
  if (assembled.markdownSha256 !== hash) fail("SUBMIT_STALE", `${key}: perspective.md changed after assemble; run assemble again`);
  if (!existsSync(paths.validation)) fail("VALIDATION_MISSING", `${key}: validation.json not found; run validate`);
  if (!existsSync(paths.review)) fail("REVIEW_MISSING", `${key}: review.json not found; the review report is required`);
  const validation = readJson<ValidationReport>(paths.validation);
  const review = readJson<ReviewReport>(paths.review);
  if (validation.schema !== SCHEMAS.validation) fail("VALIDATION_STALE", `${key}: validation.json is ${validation.schema}, expected ${SCHEMAS.validation}; run validate again`);
  if (validation.perspectiveSha256 !== hash) fail("VALIDATION_STALE", `${key}: validation.json was made for a different perspective.md; run validate again`);
  if (review.perspectiveSha256 !== hash) fail("REVIEW_STALE", `${key}: review.json was made for a different perspective.md; review again`);
  // error 不可放行；limit 须有同 rule + claimId 的人工放行；hints 不在 findings 里，不参与门禁
  const unresolved = validation.findings.filter(
    (f) => f.severity === "error" || !validation.overridden.some((o) => o.rule === f.rule && o.claimId === f.claimId),
  );
  if (!validation.ok || unresolved.length) {
    const detail = unresolved.map((f) => `${f.rule}${f.claimId ? `@${f.claimId}` : ""}`).join(", ") || "ok=false";
    fail("VALIDATION_FAILED", `${key}: unresolved validation failures (${detail})`);
  }
  const blockers = review.issues.filter((i) => i.severity === "blocker");
  if (blockers.length) fail("REVIEW_BLOCKERS", `${key}: review has ${blockers.length} blocker issue(s)`);
  return { review, validation };
}

export interface BuiltPlan {
  plan: SubmitPlan;
  /** 账本里已完成而被略去的 opKey */
  skipped: string[];
  /** 结果未知（有 intent 无结果）的 opKey */
  blocked: string[];
}

export function buildPlan(workdir: string, options: { keys?: ConceptKey[]; origin: string; resubmit?: string[] }): BuiltPlan {
  const layout = workdirLayout(workdir);
  const confirmed = requireConfirmed(workdir);
  const keys = options.keys?.length ? [...new Set(options.keys)] : confirmed.filter((k) => existsSync(layout.perspective(k).assembled));
  for (const key of keys) requireConfirmed(workdir, key);
  if (!keys.length) fail("SUBMIT_NOTHING", "no confirmed concept has an assembled perspective");

  const manifest = readJson<WorkdirManifest>(layout.manifest);
  const list = readJson<CandidateList>(layout.candidates.list);
  const site = existsSync(layout.candidates.siteExport) ? readJson<SiteExport>(layout.candidates.siteExport) : null;
  const states = ledgerState(readLedger(workdir));
  const resolvedId = (opKey: string): PageId | null => {
    const s = states.get(opKey);
    return s?.status === "done" && s.pageId ? s.pageId : null;
  };

  const interpreterOp = `new_interpreter:${manifest.interpreter}`;
  let interpreterId: PageId | null = site?.interpreters.find((i) => i.title === manifest.interpreter && !i.deleted)?.pageId ?? null;
  if (interpreterId === null) interpreterId = resolvedId(interpreterOp);
  let interpreterNeeded = false;

  const termOps: PlannedSubmission[] = [];
  const perspectiveOps: PlannedSubmission[] = [];
  const sourceTitles = manifest.sources.map((s) => `《${s.title}》`);

  for (const key of keys) {
    const entry = list.entries.find((e: CandidateEntry) => e.key === key);
    if (!entry) fail("SUBMIT_UNKNOWN_KEY", `${key}: not in candidates.json`);
    const paths = layout.perspective(key);
    if (!existsSync(paths.assembled) || !existsSync(paths.markdown)) fail("SUBMIT_MISSING", `${key}: assemble has not produced perspective.md`);
    const assembled = readJson<AssembledPerspective>(paths.assembled);
    const markdown = readFileSync(paths.markdown, "utf8");
    const { review, validation } = gate(workdir, key, markdown, assembled);
    const sources = assembled.coverage.map((c) => `《${c.title}》`);
    const note = buildNote({
      interpreter: manifest.interpreter,
      term: entry.canonicalName,
      mode: assembled.mode,
      sources: sources.length ? sources : sourceTitles,
      review,
      validation,
    });
    const contentSha256 = sha256(markdown);

    const termOp = `new_term:${entry.key}`;
    let termId: PageId | null = entry.existingTerm?.pageId ?? null;
    const dependsOn: string[] = [];
    if (termId === null) {
      termId = resolvedId(termOp);
      if (termId === null) {
        const termSummary = entry.termSummary?.trim();
        // 防御：站点的词条标题唯一索引也覆盖软删除词条，同名新建必被拒绝
        if (site?.deletedTermTitles?.includes(entry.canonicalName)) {
          fail("SUBMIT_DELETED_TERM", `${key}: new term "${entry.canonicalName}" has the same title as a deleted term; restore that term on the site first, then rerun export-site and candidates`);
        }
        if (!termSummary) fail("SUBMIT_TERM_SUMMARY", `${key}: new term "${entry.canonicalName}" has no termSummary in candidates.json; add it to the session candidates and rerun candidates`);
        termOps.push({
          opKey: termOp,
          phase: "entities",
          conceptKey: key,
          dependsOn: [],
          request: {
            kind: "new_term",
            title: entry.canonicalName,
            aliases: entry.aliases,
            summary: termSummary,
            note: `书籍流水线（AI 编者）为「${manifest.interpreter}」的视角新建词条。`,
          },
          contentSha256: null,
        });
        dependsOn.push(termOp);
      }
    }

    if (assembled.mode === "edit") {
      if (!entry.existingPerspective) fail("SUBMIT_MODE_MISMATCH", `${key}: assembled as edit but candidates.json has no existingPerspective`);
      // base：优先 #111 导出的当前 head（base.json），其次 assemble 记录的 base，最后候选清单里的 head。
      let base: number | null = assembled.baseRevisionId ?? entry.existingPerspective.headRevisionId;
      if (existsSync(paths.base)) {
        base = readJson<{ head: { revisionId: number } }>(paths.base).head.revisionId;
        // 稿子须建在这个 head 上（incremental 写 base.json 时一并重并稿）；否则会以新 base 提交旧稿，覆盖期间的人工改动
        if (assembled.baseRevisionId !== null && assembled.baseRevisionId !== base) {
          fail("SUBMIT_STALE", `${key}: the draft was built on revision ${assembled.baseRevisionId} but base.json head is ${base}; run incremental again`);
        }
      }
      if (!base) fail("SUBMIT_NO_BASE", `${key}: edit needs a base revision`);
      perspectiveOps.push({
        opKey: `perspective:${key}`,
        phase: "perspectives",
        conceptKey: key,
        dependsOn: [],
        request: { kind: "edit", pageId: entry.existingPerspective.pageId, baseRevisionId: base, content: markdown, note },
        contentSha256,
      });
    } else {
      if (interpreterId === null) {
        interpreterNeeded = true;
        dependsOn.push(interpreterOp);
      }
      perspectiveOps.push({
        opKey: `perspective:${key}`,
        phase: "perspectives",
        conceptKey: key,
        dependsOn,
        request: { kind: "new_perspective", termId: termId ?? PLACEHOLDER, interpreterId: interpreterId ?? PLACEHOLDER, content: markdown, note },
        contentSha256,
      });
    }
  }

  const all: PlannedSubmission[] = [];
  if (interpreterNeeded) {
    all.push({
      opKey: interpreterOp,
      phase: "entities",
      conceptKey: null,
      dependsOn: [],
      request: {
        kind: "new_interpreter",
        title: manifest.interpreter,
        summary: `${manifest.interpreter}（著作：${sourceTitles.join("、")}）`,
        note: "书籍流水线（AI 编者）新建诠释者。",
      },
      contentSha256: null,
    });
  }
  all.push(...termOps, ...perspectiveOps);

  // 账本过滤：已完成的略去；结果未知的挡住；内容变了而已提交的须显式 --resubmit
  const resubmit = new Set(options.resubmit ?? []);
  const skipped: string[] = [];
  const blocked: string[] = [];
  const requests: PlannedSubmission[] = [];
  for (const op of all) {
    const s = states.get(op.opKey);
    if (s && !resubmit.has(op.opKey)) {
      if (s.status === "done") {
        if (op.contentSha256 && s.contentSha256 && s.contentSha256 !== op.contentSha256) {
          fail("LEDGER_CONTENT_CHANGED", `${op.opKey}: already submitted with different content; pass --resubmit ${op.opKey} to send the new version`);
        }
        skipped.push(op.opKey);
        continue;
      }
      if (s.status === "dangling") {
        blocked.push(op.opKey);
        continue;
      }
    }
    requests.push(op);
  }
  // 稳定排序：第一阶段在前
  requests.sort((a, b) => (a.phase === b.phase ? 0 : a.phase === "entities" ? -1 : 1));
  return { plan: { schema: SCHEMAS.submitPlan, origin: options.origin, requests }, skipped, blocked };
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

export interface SubmitOptions {
  workdir: string;
  keys?: string[];
  origin?: string;
  send?: boolean;
  /** 每分钟写入上限，默认 60 */
  rate?: number;
  resubmit?: string[];
  /** `opKey` 或 `opKey=pageId`：人工确认某请求已被受理，写入账本 reconciled 事件 */
  reconcile?: string[];
  log?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

export async function submit(options: SubmitOptions): Promise<void> {
  const log = options.log ?? ((line: string) => console.log(line));
  const origin = (options.origin ?? "http://localhost:3000").replace(/\/+$/, "");
  const layout = workdirLayout(options.workdir);

  for (const spec of options.reconcile ?? []) {
    const [opKey, id] = spec.split("=");
    const pageId = id === undefined ? null : Number(id);
    if (!opKey || (pageId !== null && (!Number.isSafeInteger(pageId) || pageId <= 0))) fail("USAGE", `--reconcile expects opKey or opKey=pageId: ${spec}`);
    appendLedger(options.workdir, { opKey, event: "reconciled", contentSha256: null, httpStatus: null, submissionId: null, pageId, message: "manual reconcile" });
    log(JSON.stringify({ reconciled: opKey, pageId }));
  }

  const { plan, skipped, blocked } = buildPlan(options.workdir, { keys: options.keys, origin, resubmit: options.resubmit });
  writeText(layout.submit.plan, jsonText(plan));
  for (const r of plan.requests) {
    log(JSON.stringify({ state: "send", opKey: r.opKey, phase: r.phase, kind: r.request.kind, dependsOn: r.dependsOn, request: r.request }));
  }
  for (const opKey of skipped) log(JSON.stringify({ state: "skip-in-ledger", opKey }));
  for (const opKey of blocked) log(JSON.stringify({ state: "blocked-unknown-outcome", opKey, hint: "check the site, then rerun with --reconcile <opKey>[=pageId]" }));
  log(JSON.stringify({ mode: options.send ? "send" : "dry-run", requests: plan.requests.length, skipped: skipped.length, blocked: blocked.length, plan: layout.submit.plan }));
  if (!options.send) return;
  if (blocked.length) fail("LEDGER_AMBIGUOUS", `unknown outcome for ${blocked.join(", ")}; verify on the site and --reconcile`);
  if (!plan.requests.length) return;
  await send(options, plan, origin, log);
}

// ---------------------------------------------------------------------------
// HTTP（薄层，登录见 site-session.ts）：登录 → 逐个 POST /api/submissions → 写账本。不在测试范围内。
// ---------------------------------------------------------------------------

async function send(options: SubmitOptions, plan: SubmitPlan, origin: string, log: (line: string) => void): Promise<void> {
  const { cookie, role } = await loginPipelineAccount(origin, options.env ?? process.env);
  // 管理员提交会直接生效而绕过审核；AI 编者必须是 editor。
  if (role !== "editor") fail("SUBMIT_ROLE", `account role is "${role}"; the AI account must be an editor`);

  const interval = Math.ceil(60000 / Math.max(1, options.rate ?? 60));
  let last = 0;
  const ids = new Map<string, PageId>();
  for (const [opKey, s] of ledgerState(readLedger(options.workdir))) if (s.status === "done" && s.pageId) ids.set(opKey, s.pageId);
  const waiting: string[] = [];

  // plan.requests 已按阶段排序；第二阶段请求依赖的实体未受理（无 pageId）则等待
  for (const op of plan.requests) {
    if (op.dependsOn.some((d) => !ids.has(d))) {
      waiting.push(op.opKey);
      continue;
    }
    const request = structuredClone(op.request) as SubmissionRequest;
    if (request.kind === "new_perspective") {
      for (const d of op.dependsOn) {
        if (d.startsWith("new_term:")) request.termId = ids.get(d)!;
        if (d.startsWith("new_interpreter:")) request.interpreterId = ids.get(d)!;
      }
    }
    const wait = last + interval - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    appendLedger(options.workdir, { opKey: op.opKey, event: "intent", contentSha256: op.contentSha256, httpStatus: null, submissionId: null, pageId: null, message: null });
    const response = await siteHttp(origin, cookie, "/api/submissions", request);
    const result = (await response.json().catch(() => ({}))) as { submissionId?: number; pageId?: number; error?: string };
    if (!response.ok) {
      appendLedger(options.workdir, { opKey: op.opKey, event: "failed", contentSha256: op.contentSha256, httpStatus: response.status, submissionId: null, pageId: null, message: result.error ?? null });
      fail("SUBMIT_HTTP", `${op.opKey}: HTTP ${response.status} ${result.error ?? ""}`.trim());
    }
    appendLedger(options.workdir, { opKey: op.opKey, event: "submitted", contentSha256: op.contentSha256, httpStatus: response.status, submissionId: result.submissionId ?? null, pageId: result.pageId ?? null, message: null });
    if (result.pageId) ids.set(op.opKey, result.pageId);
    log(JSON.stringify({ sent: op.opKey, submissionId: result.submissionId ?? null, pageId: result.pageId ?? null }));
  }
  if (waiting.length) {
    log(JSON.stringify({ waiting, hint: "entities are pending review; after approval run `--reconcile <opKey>=<pageId>` (or refresh site-terms.json and rerun candidates), then submit --send again" }));
  }
}
