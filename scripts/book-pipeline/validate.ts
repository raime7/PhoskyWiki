// 校验（validate，#110）：对已组装的 perspective.md 做确定性检查，写 perspectives/<key>/validation.json。
//
// 不调用模型、不连数据库。双链解析与渲染复用站点的 src/lib/wiki-links.ts 与 src/lib/markdown.ts，
// 模板解析复用 template.ts。报告形状见 types.ts 的 ValidationReport（#112 提交器消费）。
//
// 发现项的严重度：limit = 硬上限，可经 overrides.json 放行；error = 不可放行。
// ok = 放行之后没有剩余发现项。放行过的项不在 findings 中，而在 overridden 里显式列出。

import { existsSync, readFileSync } from "node:fs";

import { markdownParser, visitWikiLinks } from "@/lib/markdown-ast";
import { renderMarkdownText, renderMarkdownTree } from "@/lib/markdown";
import { parseWikiLink, type WikiLinkRef } from "@/lib/wiki-links";

import { citationFor, citedLabel, rangeLabel, sourceLoader, translationLabel } from "./assemble";
import { topLevelBlocks } from "./blocks";
import { nameKey, requireConfirmed } from "./candidates";
import { expectedVisibleEmphasis, expectedVisibleQuote, parsePerspectiveMarkdown, renderedExcerpts, renderExcerpt, TEMPLATE } from "./template";
import {
  isPseudoInterpreter,
  SCHEMAS,
  type AssembledPerspective,
  type CandidateList,
  type ClaimId,
  type ClaimMap,
  type ConceptKey,
  type FrozenParagraph,
  type LimitOverride,
  type LockInfo,
  type ReviewReport,
  type SiteExport,
  type ValidationFinding,
  type ValidationReport,
  type ValidationRule,
  type WorkdirManifest,
} from "./types";
import { jsonText, readJson, sha256, workdirLayout, writeText } from "./workdir";

/** 硬上限（ADR-0009 / #105）。数字按“字”计：不含空白的字符数。 */
export const LIMITS = {
  claims: 5,
  excerptsPerClaim: 3,
  /** 单段摘录的可见引文（不含截断标记） */
  excerptChars: 200,
  /** 一句话核心加全部论点解读的可见文字（不含引用块、标题、资料说明） */
  expositionChars: 1500,
} as const;

function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

const charCount = (text: string): number => Array.from(text.replace(/\s/g, "")).length;
const preview = (text: string): string => (Array.from(text).length > 24 ? Array.from(text).slice(0, 24).join("") + "…" : text);

class Findings {
  readonly list: ValidationFinding[] = [];
  private seen = new Set<string>();
  add(rule: ValidationRule, message: string, claimId: ClaimId | null = null): void {
    const key = `${rule}\u0000${claimId}\u0000${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push({ rule, severity: rule.startsWith("limit.") ? "limit" : "error", message, claimId });
  }
}

function readOptional<T>(path: string): T | null {
  return existsSync(path) ? readJson<T>(path) : null;
}

/** 读 overrides.json（`LimitOverride[]`）。形状不对即报错，不静默忽略：放行是人的决定。 */
function loadOverrides(path: string): LimitOverride[] {
  if (!existsSync(path)) return [];
  const value: unknown = readJson(path);
  if (!Array.isArray(value)) fail("OVERRIDES_INVALID", "overrides.json must be an array of LimitOverride");
  return value.map((item, i) => {
    const o = item as Partial<LimitOverride>;
    const bad = (why: string): never => fail("OVERRIDES_INVALID", `overrides.json[${i}]: ${why}`);
    if (typeof o.rule !== "string" || !o.rule.startsWith("limit.")) bad("only limit.* rules can be overridden");
    if (o.claimId !== null && typeof o.claimId !== "string") bad("claimId must be a string or null");
    if (typeof o.reason !== "string" || !o.reason.trim()) bad("reason is required");
    if (typeof o.approvedBy !== "string" || !o.approvedBy.trim()) bad("approvedBy is required");
    return { rule: o.rule as ValidationRule, claimId: o.claimId ?? null, reason: o.reason!, approvedBy: o.approvedBy! };
  });
}

interface Context {
  workdir: WorkdirManifest;
  /** 站上已有词条（规范化名 → 词条 pageId 集合），含别名；不含已删除 */
  siteTerms: Map<string, Set<number>>;
  siteInterpreters: Map<string, number>;
  sitePerspectives: Set<string>;
  /** 本批已确认候选的名称（规范名与别名，规范化） */
  batchTerms: Set<string>;
}

function buildContext(workdirPath: string, confirmed: ConceptKey[]): Context {
  const layout = workdirLayout(workdirPath);
  const workdir = readJson<WorkdirManifest>(layout.manifest);
  if (!existsSync(layout.candidates.siteExport)) fail("MISSING_INPUT", `site export not found: ${layout.candidates.siteExport}`);
  const site = readJson<SiteExport>(layout.candidates.siteExport);
  const siteTerms = new Map<string, Set<number>>();
  for (const term of site.terms.filter((t) => !t.deleted)) {
    for (const name of [term.title, ...term.aliases]) {
      const set = siteTerms.get(nameKey(name)) ?? new Set<number>();
      set.add(term.pageId);
      siteTerms.set(nameKey(name), set);
    }
  }
  const siteInterpreters = new Map(site.interpreters.filter((i) => !i.deleted).map((i) => [nameKey(i.title), i.pageId]));
  const sitePerspectives = new Set(site.perspectives.filter((p) => !p.deleted).map((p) => `${p.termId}:${p.interpreterId}`));
  const batchTerms = new Set<string>();
  if (confirmed.length) {
    const list = readJson<CandidateList>(layout.candidates.list);
    for (const entry of list.entries.filter((e) => confirmed.includes(e.key))) {
      for (const name of [entry.canonicalName, ...entry.aliases]) batchTerms.add(nameKey(name));
    }
  }
  return { workdir, siteTerms, siteInterpreters, sitePerspectives, batchTerms };
}

/** 双链能否落到已有词条或本批确认候选；显式视角语法还要求该视角存在或属于本批。 */
function linkProblem(ctx: Context, ref: WikiLinkRef): string | null {
  const term = nameKey(ref.term);
  const siteIds = ctx.siteTerms.get(term);
  const inBatch = ctx.batchTerms.has(term);
  if (!siteIds && !inBatch) return `双链目标「${ref.term}」不是站上已有词条，也不在本批确认的候选中`;
  if (ref.interpreter === null) return null;
  const who = nameKey(ref.interpreter);
  if (who === nameKey(ctx.workdir.interpreter) && inBatch) return null;
  const interpreterId = ctx.siteInterpreters.get(who);
  if (interpreterId === undefined) return `双链「${ref.term}|…@${ref.interpreter}」的诠释者「${ref.interpreter}」不存在`;
  if (![...(siteIds ?? [])].some((termId) => ctx.sitePerspectives.has(`${termId}:${interpreterId}`))) {
    return `双链「${ref.term}|…@${ref.interpreter}」指向的视角不存在`;
  }
  return null;
}

export function validatePerspective(workdirPath: string, key: ConceptKey): ValidationReport {
  const layout = workdirLayout(workdirPath);
  const paths = layout.perspective(key);
  if (!existsSync(paths.markdown)) fail("MISSING_INPUT", `perspectives/${key}/perspective.md not found; run assemble`);
  const markdown = readFileSync(paths.markdown, "utf8");
  const found = new Findings();

  // 确认闸门：违反时报告而不是中止，让报告落盘可见
  let confirmed: ConceptKey[] = [];
  try {
    requireConfirmed(workdirPath, key);
    confirmed = requireConfirmed(workdirPath);
  } catch (error) {
    found.add("unconfirmed", (error as Error).message.replace(/^UNCONFIRMED: /, "候选清单未确认："));
  }
  const ctx = buildContext(workdirPath, confirmed);
  const workdir = ctx.workdir;
  const claimMap = readOptional<ClaimMap>(paths.claimMap);
  const assembledRaw = readOptional<AssembledPerspective>(paths.assembled);
  // assembled.json 仅在与当前 perspective.md 一致时用作回查的依据
  const assembled = assembledRaw && assembledRaw.markdownSha256 === sha256(markdown) ? assembledRaw : null;

  // --- 模板 ---------------------------------------------------------------
  const parsed = parsePerspectiveMarkdown(markdown);
  for (const error of parsed.errors) found.add("template", error);
  const claimIds: ClaimId[] = parsed.claims.map((_, i) => claimMap?.claims[i]?.id ?? `claim-${i + 1}`);

  // --- 硬上限 -------------------------------------------------------------
  if (parsed.claims.length > LIMITS.claims) found.add("limit.claims", `论点 ${parsed.claims.length} 个，超过上限 ${LIMITS.claims}`);
  parsed.claims.forEach((claim, i) => {
    if (claim.excerpts.length > LIMITS.excerptsPerClaim) {
      found.add("limit.excerpts-per-claim", `论点「${claim.heading}」有 ${claim.excerpts.length} 段摘录，超过上限 ${LIMITS.excerptsPerClaim}`, claimIds[i]);
    }
  });
  const visibleText = (source: string) => renderMarkdownText(source, () => ({ href: "", exists: true }));
  const expositionChars = charCount(visibleText([parsed.core ?? "", ...parsed.claims.map((c) => c.exposition)].join("\n\n")));
  if (expositionChars > LIMITS.expositionChars) {
    found.add("limit.exposition-length", `解读共 ${expositionChars} 字，超过上限 ${LIMITS.expositionChars}`);
  }

  // --- 双链：站点自己的解析与渲染 -----------------------------------------
  const tree = markdownParser().parse(markdown);
  const headingStarts = (tree.children ?? [])
    .filter((node) => node.type === "heading" && (node as { depth?: number }).depth === TEMPLATE.claimHeadingDepth)
    .map((node) => node.position!.start.offset!);
  const claimAt = (offset: number): ClaimId | null => {
    let index = -1;
    headingStarts.forEach((start, i) => {
      if (start <= offset) index = i;
    });
    return index >= 0 ? (claimIds[index] ?? null) : null;
  };
  const interpreterNames = new Set<string>();
  visitWikiLinks(tree, (node) => {
    const at = claimAt(node.position?.start.offset ?? 0);
    const alias = node.data?.alias ?? null;
    const raw = alias === null ? `[[${node.value}]]` : `[[${node.value}|${alias}]]`;
    if (node.value.includes("@")) found.add("wikilink.reserved-at", `${raw}：词条名中不得含保留字符 @`, at);
    if (alias?.includes("@")) {
      const split = alias.lastIndexOf("@");
      if (!alias.slice(split + 1).trim()) found.add("wikilink.reserved-at", `${raw}：@ 之后缺少诠释者名`, at);
      else if (!alias.slice(0, split).trim()) found.add("wikilink.reserved-at", `${raw}：@ 之前缺少显示文字`, at);
      else if (alias.slice(0, split).includes("@")) found.add("wikilink.reserved-at", `${raw}：显示文字中不得含 @（@ 只用于分隔诠释者）`, at);
    }
    const ref = parseWikiLink(node.value, alias);
    if (ref?.interpreter) interpreterNames.add(ref.interpreter);
  });
  // 经站点渲染管线实际解析一遍：红链即报告（与读者所见一致）
  const unknown = new Set<string>();
  renderMarkdownTree(markdown, (ref) => {
    const problem = linkProblem(ctx, ref);
    if (problem) unknown.add(problem);
    return { href: "", exists: problem === null };
  });
  for (const problem of unknown) found.add("wikilink.unknown-target", problem);

  // --- 引文逐字回查 + 资料覆盖范围 ----------------------------------------
  const load = sourceLoader(layout, workdir);
  const sources = workdir.sources.map((s) => ({ id: s.id, source: load(s.id) }));
  const allParagraphs = sources.flatMap(({ source }) => [...source.paragraphs.values()].filter((p) => p.inRange));
  const visible = renderedExcerpts(markdown);
  const parsedExcerpts = parsed.claims.flatMap((claim, i) => claim.excerpts.map(() => claimIds[i]));
  const claimOf = (i: number): ClaimId | null => (parsedExcerpts.length === visible.length ? parsedExcerpts[i] : null);
  if (assembled && assembled.excerpts.length !== visible.length) {
    found.add("quotation", `页面渲染出 ${visible.length} 段摘录，assembled.json 记录了 ${assembled.excerpts.length} 段`);
  }
  const cited = new Map<string, FrozenParagraph[]>();
  const noteCited = (paragraph: FrozenParagraph) => {
    const list = cited.get(paragraph.sourceId) ?? [];
    if (!list.includes(paragraph)) list.push(paragraph);
    cited.set(paragraph.sourceId, list);
  };
  const stripMarks = (text: string) =>
    text.slice(
      text.startsWith(TEMPLATE.truncation) ? TEMPLATE.truncation.length : 0,
      text.endsWith(TEMPLATE.truncation) ? text.length - TEMPLATE.truncation.length : undefined,
    );
  const expectedCitation = (p: FrozenParagraph) => TEMPLATE.citationPrefix + citationFor(p, load(p.sourceId).manifest);
  visible.forEach((shown, i) => {
    const claimId = claimOf(i);
    const label = `第 ${i + 1} 段摘录`;
    const quote = stripMarks(shown.text);
    if (charCount(quote) > LIMITS.excerptChars) {
      found.add("limit.excerpt-length", `${label}长 ${charCount(quote)} 字，超过上限 ${LIMITS.excerptChars}`, claimId);
    }
    const ref = assembled?.excerpts.length === visible.length ? assembled.excerpts[i].ref : null;
    if (ref) {
      // 精确回查：按 assembled.json 记录的引用，从冻结段落重新取引文
      const paragraph = allParagraphs.find((p) => p.id === ref.paragraph);
      if (!paragraph) return void found.add("quotation", `${label}引用的段落 ${ref.paragraph} 不在冻结来源的范围内`, claimId);
      noteCited(paragraph);
      let rendered: ReturnType<typeof renderExcerpt>;
      try {
        rendered = renderExcerpt(paragraph, ref);
      } catch (error) {
        return void found.add("quotation", `${label}：${(error as Error).message}`, claimId);
      }
      if (shown.text !== expectedVisibleQuote(rendered)) {
        found.add(
          "quotation",
          `${label}与冻结来源 ${ref.paragraph} 不一致：页面为「${preview(shown.text)}」，来源为「${preview(expectedVisibleQuote(rendered))}」`,
          claimId,
        );
      } else if (JSON.stringify(shown.emphasis) !== JSON.stringify(expectedVisibleEmphasis(rendered, rendered.emphasis))) {
        found.add("quotation", `${label}的强调与冻结来源 ${ref.paragraph} 不一致`, claimId);
      }
      if (shown.citation !== expectedCitation(paragraph)) {
        found.add("quotation", `${label}的出处「${shown.citation}」应为「${expectedCitation(paragraph)}」`, claimId);
      }
      return;
    }
    // 退化回查（perspective.md 已被改动、assembled.json 失效）：引文须是某个范围内段落的逐字子串
    const hits = quote ? allParagraphs.filter((p) => p.text.includes(quote)) : [];
    if (!hits.length) {
      const outside = quote ? sources.some(({ source }) => [...source.paragraphs.values()].some((p) => !p.inRange && p.text.includes(quote))) : false;
      found.add("quotation", `${label}「${preview(quote)}」${outside ? "只出现在范围外的注释段落中" : "在冻结来源中找不到逐字出处"}`, claimId);
      return;
    }
    const chosen = hits.find((p) => expectedCitation(p) === shown.citation) ?? hits[0];
    noteCited(chosen);
    if (expectedCitation(chosen) !== shown.citation) {
      found.add("quotation", `${label}的出处「${shown.citation}」与引文所在段落 ${chosen.id} 不符（应为「${expectedCitation(chosen)}」）`, claimId);
    }
  });

  const citedSources = sources.filter(({ id }) => cited.has(id));
  const compareList = (what: string, items: string[], expected: Map<string, string>) => {
    for (const [title, want] of expected) {
      const item = items.find((text) => text.startsWith(`《${title}》`));
      if (!item) found.add("coverage", `「${what}」缺少实际引用的《${title}》`);
      else if (item !== want) found.add("coverage", `「${what}」中《${title}》应为「${want}」，实际为「${item}」`);
    }
    for (const item of items) {
      if (![...expected.keys()].some((title) => item.startsWith(`《${title}》`))) {
        found.add("coverage", `「${what}」列出了没有被引用的资料：「${preview(item)}」`);
      }
    }
  };
  compareList(
    TEMPLATE.labels.coverage,
    parsed.coverage,
    new Map(
      citedSources.map(({ id, source }) => [
        source.manifest.work.title,
        `《${source.manifest.work.title}》，整理范围：${rangeLabel(source)}；摘录出自 ${citedLabel(cited.get(id)!.sort((a, b) => a.order - b.order))}`,
      ]),
    ),
  );
  compareList(
    TEMPLATE.labels.translations,
    parsed.translations,
    new Map(citedSources.map(({ source }) => [source.manifest.work.title, translationLabel(source.manifest)])),
  );

  // --- 伪诠释者（ADR-0007） -----------------------------------------------
  const names: [string, string][] = [
    ["工作目录诠释者", workdir.interpreter],
    ...(claimMap ? [["论点映射诠释者", claimMap.interpreter] as [string, string]] : []),
    ...(assembledRaw ? [["assembled.json 诠释者", assembledRaw.interpreter] as [string, string]] : []),
    ...sources.map(({ id, source }): [string, string] => [`来源 ${id} 的著者`, source.manifest.work.author]),
    ...[...interpreterNames].map((name): [string, string] => ["双链中的诠释者", name]),
  ];
  for (const [what, name] of names) {
    if (isPseudoInterpreter(name ?? "")) found.add("pseudo-interpreter", `${what}「${name}」不是诠释者（编者整理的说明不构成诠释者，ADR-0007）`);
  }

  // --- 增量更新：锁定段落 -------------------------------------------------
  const locks = readOptional<LockInfo>(paths.locks);
  if (locks) {
    if (locks.schema !== SCHEMAS.locks) found.add("locked-block", `locks.json 的 schema 应为 ${SCHEMAS.locks}`);
    if (assembledRaw?.baseRevisionId != null && assembledRaw.baseRevisionId !== locks.headRevisionId) {
      found.add("locked-block", `locks.json 针对修订 ${locks.headRevisionId}，而本稿以修订 ${assembledRaw.baseRevisionId} 为基础`);
    }
    const blocks = new Set(topLevelBlocks(markdown).map((text) => sha256(text)));
    for (const block of locks.blocks ?? []) {
      if (sha256(block.text) !== block.sha256) found.add("locked-block", `locks.json 中锁定块 #${block.index} 的哈希与文字不符`);
      else if (!blocks.has(block.sha256)) found.add("locked-block", `锁定块 #${block.index}「${preview(block.text)}」被改动或删除（人工改过的段落不得改写）`);
    }
  }

  // --- 放行 ---------------------------------------------------------------
  const overrides = loadOverrides(paths.overrides);
  const overridden: LimitOverride[] = [];
  const findings = found.list.filter((finding) => {
    if (finding.severity !== "limit") return true;
    const match = overrides.find((o) => o.rule === finding.rule && o.claimId === finding.claimId);
    if (!match) return true;
    if (!overridden.includes(match)) overridden.push(match);
    return false;
  });

  return {
    schema: SCHEMAS.validation,
    conceptKey: key,
    perspectiveSha256: sha256(markdown),
    ok: findings.length === 0,
    findings,
    overridden,
  };
}

/** 审稿子代理报告（review.json）相对当前稿的状态；不属于校验发现项，仅随命令输出提示。 */
export function reviewStatus(workdirPath: string, key: ConceptKey): { status: "missing" | "stale" | "current"; blockers: number } {
  const paths = workdirLayout(workdirPath).perspective(key);
  const review = readOptional<ReviewReport>(paths.review);
  if (!review) return { status: "missing", blockers: 0 };
  const current = existsSync(paths.markdown) && review.perspectiveSha256 === sha256(readFileSync(paths.markdown, "utf8"));
  return { status: current ? "current" : "stale", blockers: review.issues.filter((i) => i.severity === "blocker").length };
}

export interface ValidateResult {
  key: ConceptKey;
  ok: boolean;
  errors: number;
  limits: number;
  overridden: number;
  review: ReturnType<typeof reviewStatus>;
}

/** 校验给定概念（缺省 = 全部已确认且已组装的概念）。每个概念的报告都会写出，即使有违规。 */
export function validate(workdirPath: string, keys: ConceptKey[] = []): ValidateResult[] {
  const layout = workdirLayout(workdirPath);
  const targets = keys.length ? keys : requireConfirmed(workdirPath).filter((key) => existsSync(layout.perspective(key).markdown));
  if (!targets.length) fail("VALIDATE_NOTHING", "no confirmed concept has perspectives/<key>/perspective.md; run assemble");
  const reports = [...new Set(targets)].map((key) => validatePerspective(workdirPath, key));
  return reports.map((report) => {
    writeText(layout.perspective(report.conceptKey).validation, jsonText(report));
    return {
      key: report.conceptKey,
      ok: report.ok,
      errors: report.findings.filter((f) => f.severity === "error").length,
      limits: report.findings.filter((f) => f.severity === "limit").length,
      overridden: report.overridden.length,
      review: reviewStatus(workdirPath, report.conceptKey),
    };
  });
}
