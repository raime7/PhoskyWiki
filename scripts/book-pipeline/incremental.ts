// 增量更新（incremental，#111；#105「增量更新」；ADR-0009）：把新书的材料按论点并入现有视角。
//
// 输入：现有视角的 head 修订与上一次 AI 编者账号产生的修订（文件导出 → base.json），
// 工作目录中已冻结的来源（旧书与新书），以及会话写的增量论点映射 claim-map.json。
// 产出：base.json（以 head 为 base）、locks.json（人工改过的块），以及编辑稿
// perspective.md + assembled.json（mode = edit，baseRevisionId = head），供 validate / submit 使用。
//
// 合并规则：
// - 正文（一句话核心与各论点，直到分隔线）以 head 原文为底，只做插入，不改写任何既有字节：
//   kept 论点原样保留；extended 论点在原解读之后追加解读、在原摘录之后追加摘录；new 论点整节插入。
// - 资料说明（分隔线及其后）由程序依实际引用重新推导（与 assemble 同一套文案）；head 的资料说明
//   与上一次 AI 修订不同（人工改过）时拒绝（INCREMENTAL_FOOTER_EDITED），除非显式 rederiveFooter。
// - 锁定：head 正文中不以同样文字出现在上一次 AI 修订里的顶层块，即人工改过的块（blocks.ts 的切法）。
//   没有 AI 修订时，正文全部锁定。合并只插入，锁定块必然原样保留；validate 再按 locks.json 复查。
// - 既有摘录须能在工作目录的冻结来源中逐字定位（出处行 + 句子范围），从而 assembled.json 记录全部引用，
//   validate 走精确回查。新摘录与 assemble 一样依「段落 ID + 起止句」回填，出处行以《书名》标注所出书目。
// 全部在内存中算完并自检通过后才落盘；重跑逐字节一致。

import { existsSync, readFileSync } from "node:fs";
import type { Node } from "unist";

import { markdownParser } from "@/lib/markdown-ast";

import { citationFor, deriveCoverage, selfCheck, sourceLoader } from "./assemble";
import { topLevelBlocks } from "./blocks";
import { requireConfirmed } from "./candidates";
import { checkClaimMapCommon, validHeading } from "./claim-map";
import {
  claimBlocks,
  excerptBlockMarkdown,
  excerptSlice,
  expectedVisibleQuote,
  footerMarkdown,
  parsePerspectiveMarkdown,
  plainText,
  renderedExcerpts,
  renderExcerpt,
  TEMPLATE,
  type RenderedExcerpt,
} from "./template";
import {
  SCHEMAS,
  type AssembledExcerpt,
  type AssembledPerspective,
  type CandidateEntry,
  type CandidateList,
  type Claim,
  type ClaimMap,
  type ConceptKey,
  type ExcerptRef,
  type FrozenParagraph,
  type IncrementalBase,
  type LockedBlock,
  type LockInfo,
  type PageId,
  type RevisionId,
  type WorkdirManifest,
} from "./types";
import { fileEquals, jsonText, readJson, sha256, workdirLayout, writeText } from "./workdir";
import { fail } from "./errors";

interface MdNode extends Node {
  depth?: number;
  children?: MdNode[];
}

const start = (node: Node) => node.position!.start.offset!;
const end = (node: Node) => node.position!.end.offset!;

// ---------------------------------------------------------------------------
// head 的结构：按模板拆成可定位的块
// ---------------------------------------------------------------------------

interface HeadClaim {
  heading: string;
  /** 解读最后一块的结束偏移（追加解读的插入点） */
  expositionEnd: number;
  /** 本节最后一个摘录引用块的结束偏移（追加摘录与其后新增论点的插入点） */
  end: number;
  excerpts: { paragraph: FrozenParagraph; ref: ExcerptRef; rendered: RenderedExcerpt; citation: string }[];
}

interface HeadStructure {
  content: string;
  /** 一句话核心的 Markdown 源 */
  core: string;
  coreEnd: number;
  claims: HeadClaim[];
  /** 分隔线的起始偏移：此前为正文，原样保留；此后为资料说明，重新推导 */
  separatorStart: number;
  /** topLevelBlocks(content) 的全部块，以及正文块的个数（分隔线在其后） */
  blocks: string[];
  bodyBlocks: number;
}

type Loader = ReturnType<typeof sourceLoader>;

/** 在冻结来源中定位既有摘录：出处行一致，且某个句子范围回填出的可见引文完全相同。 */
function locateExcerpt(
  shown: { text: string; citation: string },
  candidates: { paragraph: FrozenParagraph; citation: string }[],
): { paragraph: FrozenParagraph; ref: ExcerptRef } | null {
  for (const { paragraph, citation } of candidates) {
    if (TEMPLATE.citationPrefix + citation !== shown.citation) continue;
    const count = paragraph.sentences.length;
    for (let from = 1; from <= count; from++) {
      for (let to = from; to <= count; to++) {
        const ref = { paragraph: paragraph.id, from, to };
        if (expectedVisibleQuote(excerptSlice(paragraph, ref)) === shown.text) return { paragraph, ref };
      }
    }
  }
  return null;
}

function analyzeHead(content: string, workdir: WorkdirManifest, load: Loader): HeadStructure {
  const parsed = parsePerspectiveMarkdown(content);
  if (parsed.errors.length) {
    fail("INCREMENTAL_HEAD_TEMPLATE", `the head revision does not follow the perspective template (${parsed.errors.join("; ")}); rewrite it wholesale with \`assemble --rewrite <key>\` instead`);
  }
  const tree = markdownParser().parse(content) as MdNode;
  const all = tree.children ?? [];
  // 与 parsePerspectiveMarkdown 相同：原始 HTML 块不参与结构（原样留在正文切片里）
  const nodes = all.filter((node) => node.type !== "html");
  let i = 0;
  const coreNode = nodes[i++];
  const claims: HeadClaim[] = [];
  while (nodes[i]?.type === "heading" && nodes[i].depth === TEMPLATE.claimHeadingDepth) {
    const heading = plainText(nodes[i++]).trim();
    let expositionEnd = 0;
    while (nodes[i]?.type === "paragraph" || nodes[i]?.type === "list") expositionEnd = end(nodes[i++]);
    let claimEnd = expositionEnd;
    while (nodes[i]?.type === "blockquote") claimEnd = end(nodes[i++]);
    claims.push({ heading, expositionEnd, end: claimEnd, excerpts: [] });
  }
  const separator = nodes[i];

  // 既有摘录：按站点渲染出的可见文字与出处行，回到冻结来源的段落与句子范围
  const paragraphs = workdir.sources.flatMap((s) => {
    const source = load(s.id);
    return [...source.paragraphs.values()].filter((p) => p.inRange).map((paragraph) => ({ paragraph, citation: citationFor(paragraph, source.manifest) }));
  });
  const visible = renderedExcerpts(content);
  const owners = parsed.claims.flatMap((claim, index) => claim.excerpts.map(() => index));
  if (owners.length !== visible.length) fail("INCREMENTAL_HEAD_TEMPLATE", `the head renders ${visible.length} excerpts but its claims hold ${owners.length}`);
  visible.forEach((shown, n) => {
    const found = locateExcerpt(shown, paragraphs);
    if (!found) {
      fail(
        "INCREMENTAL_EXCERPT_UNRESOLVED",
        `excerpt ${n + 1} of the head («${shown.text.slice(0, 24)}» ${shown.citation}) cannot be traced to a frozen paragraph and sentence range; freeze the book it cites into this workdir`,
      );
    }
    const rendered = renderExcerpt(found.paragraph, found.ref);
    claims[owners[n]].excerpts.push({ ...found, rendered, citation: shown.citation.slice(TEMPLATE.citationPrefix.length) });
  });

  return {
    content,
    core: content.slice(start(coreNode), end(coreNode)).trim(),
    coreEnd: end(coreNode),
    claims,
    separatorStart: start(separator),
    blocks: topLevelBlocks(content),
    bodyBlocks: all.indexOf(separator),
  };
}

// ---------------------------------------------------------------------------
// 锁定：head 正文中人工改过的块
// ---------------------------------------------------------------------------

function computeLocks(base: IncrementalBase, head: HeadStructure): { locks: LockInfo; footerHumanEdits: number } {
  const ai = new Set(base.lastAi ? topLevelBlocks(base.lastAi.content) : []);
  const blocks: LockedBlock[] = [];
  head.blocks.slice(0, head.bodyBlocks).forEach((text, index) => {
    if (!ai.has(text)) blocks.push({ index, sha256: sha256(text), text, reason: "human-edit" });
  });
  const footerHumanEdits = base.lastAi ? head.blocks.slice(head.bodyBlocks).filter((text) => !ai.has(text)).length : 0;
  return {
    locks: {
      schema: SCHEMAS.locks,
      pageId: base.pageId,
      headRevisionId: base.head.revisionId,
      lastAiRevisionId: base.lastAi?.revisionId ?? null,
      blocks,
    },
    footerHumanEdits,
  };
}

// ---------------------------------------------------------------------------
// 增量论点映射
// ---------------------------------------------------------------------------

/**
 * 会话的增量论点映射：在共用规则（claim-map.ts）之上，核心照抄 head；既有论点按 head 顺序、以原标题逐个出现，
 * 可追加摘录或解读；新增论点须有合法且不与既有论点重复的标题、解读与摘录。
 */
function checkClaimMap(map: ClaimMap, key: ConceptKey, entry: CandidateEntry, interpreter: string, head: HeadStructure): (HeadClaim | null)[] {
  const bad = checkClaimMapCommon(map, { key, entry, interpreter, code: "INCREMENTAL_CLAIM_MAP" });
  if (map.core !== head.core) bad("core must be copied verbatim from the head revision (incremental never rewrites it)");

  const headings = new Set(head.claims.map((c) => c.heading));
  const matched: (HeadClaim | null)[] = [];
  let next = 0;
  for (const claim of map.claims) {
    const exposition = claim.exposition.trim();
    if (claim.revision === "new") {
      if (!validHeading(claim.heading)) bad(`${claim.id}: heading must be a single non-empty line`);
      if (headings.has(claim.heading.trim())) bad(`${claim.id}: a new claim cannot reuse the existing heading "${claim.heading}"; mark it extended`);
      if (!exposition) bad(`${claim.id}: a new claim needs exposition`);
      if (!claim.excerpts.length) bad(`${claim.id}: a new claim needs at least one excerpt`);
      matched.push(null);
      continue;
    }
    const existing = head.claims[next];
    if (!existing || existing.heading !== claim.heading) {
      bad(
        existing
          ? `${claim.id}: expected the existing claim "${existing.heading}" here (existing claims keep their head order and headings), got "${claim.heading}"`
          : `${claim.id}: "${claim.heading}" is not an existing claim left to match; new claims need revision "new"`,
      );
    }
    next++;
    if (claim.revision === "kept" && (exposition || claim.excerpts.length)) bad(`${claim.id}: a kept claim adds nothing; mark it extended to append material`);
    if (claim.revision === "extended" && !exposition && !claim.excerpts.length) bad(`${claim.id}: an extended claim must append exposition or excerpts`);
    matched.push(existing);
  }
  if (next < head.claims.length) {
    bad(`existing claims cannot be dropped: ${head.claims.slice(next).map((c) => `"${c.heading}"`).join(", ")} missing (mark them kept)`);
  }
  return matched;
}

/** 供会话起草的骨架：既有论点全部 kept，核心照抄 head。 */
function scaffold(key: ConceptKey, entry: CandidateEntry, interpreter: string, head: HeadStructure): ClaimMap {
  return {
    schema: SCHEMAS.claimMap,
    conceptKey: key,
    term: entry.existingTerm?.title ?? entry.canonicalName,
    interpreter,
    core: head.core,
    claims: head.claims.map((c, i): Claim => ({ id: `k${i + 1}`, heading: c.heading, exposition: "", excerpts: [], revision: "kept" })),
  };
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

export interface RevisionExport {
  revisionId: RevisionId;
  content: string;
}

export interface IncrementalOptions {
  workdir: string;
  key: ConceptKey;
  /** 现有视角的导出；省略则读已有的 base.json */
  head?: RevisionExport;
  /** 与 head 同时给出：上一次 AI 编者修订，null = 从无 AI 修订（正文全部锁定） */
  lastAi?: RevisionExport | null;
  /** 缺省取候选清单的 existingPerspective.pageId；给出时须与之一致 */
  pageId?: PageId;
  /** 资料说明（分隔线之后）有人工改动时，确认接受按引用重新推导（覆盖人工改动）；否则拒绝 */
  rederiveFooter?: boolean;
}

export interface IncrementalResult {
  key: ConceptKey;
  status: "written" | "unchanged";
  /** merged = 已写出编辑稿；awaiting-claim-map = 只写了 base/locks，等会话写 claim-map.json */
  stage: "merged" | "awaiting-claim-map";
  pageId: PageId;
  baseRevisionId: RevisionId;
  lastAiRevisionId: RevisionId | null;
  locked: number;
  /** 资料说明中人工改过、经 rederiveFooter 确认后被重新推导覆盖的块数 */
  footerHumanEdits: number;
  claims: { kept: number; extended: number; new: number } | null;
  newExcerpts: number;
  markdownSha256: string | null;
  /** 只在 awaiting-claim-map 时给出：增量论点映射的起点 */
  scaffold?: ClaimMap;
}

function revisionId(value: unknown, what: string): RevisionId {
  if (!Number.isInteger(value) || (value as number) < 1) fail("INCREMENTAL_BASE_INVALID", `${what} must be a positive integer revision id`);
  return value as RevisionId;
}

function loadBase(options: IncrementalOptions, entry: CandidateEntry & { existingPerspective: object }, basePath: string): IncrementalBase {
  const pageId = entry.existingPerspective.pageId;
  if (options.pageId !== undefined && options.pageId !== pageId) {
    fail("INCREMENTAL_PAGE_MISMATCH", `${options.key}: --page ${options.pageId} differs from the candidate list's existing perspective ${pageId}`);
  }
  let base: IncrementalBase;
  if (options.head) {
    base = { schema: SCHEMAS.incrementalBase, pageId, head: options.head, lastAi: options.lastAi ?? null };
  } else {
    if (!existsSync(basePath)) fail("MISSING_INPUT", `perspectives/${options.key}/base.json not found; pass --head and --last-ai (or --no-last-ai)`);
    base = readJson<IncrementalBase>(basePath);
    if (base.schema !== SCHEMAS.incrementalBase) fail("INCREMENTAL_BASE_INVALID", `base.json schema must be ${SCHEMAS.incrementalBase}`);
    if (base.pageId !== pageId) fail("INCREMENTAL_PAGE_MISMATCH", `base.json is for page ${base.pageId}, the candidate list for ${pageId}`);
  }
  revisionId(base.head?.revisionId, "head revision");
  if (typeof base.head.content !== "string") fail("INCREMENTAL_BASE_INVALID", "head content must be a string");
  if (base.lastAi) {
    revisionId(base.lastAi.revisionId, "last AI revision");
    if (typeof base.lastAi.content !== "string") fail("INCREMENTAL_BASE_INVALID", "last AI content must be a string");
    if (base.lastAi.revisionId > base.head.revisionId) fail("INCREMENTAL_BASE_INVALID", "the last AI revision is newer than the head");
    if (base.lastAi.revisionId === base.head.revisionId && base.lastAi.content !== base.head.content) {
      fail("INCREMENTAL_BASE_INVALID", "the last AI revision has the head's id but different content");
    }
  }
  return base;
}

export function incremental(options: IncrementalOptions): IncrementalResult {
  const { key } = options;
  requireConfirmed(options.workdir, key);
  const layout = workdirLayout(options.workdir);
  const paths = layout.perspective(key);
  const listText = readFileSync(layout.candidates.list, "utf8");
  const confirmationText = readFileSync(layout.candidates.confirmation, "utf8");
  const entry = (JSON.parse(listText) as CandidateList).entries.find((e) => e.key === key)!;
  if (!entry.existingPerspective) {
    fail("INCREMENTAL_NO_PERSPECTIVE", `${key}: the candidate list has no existing perspective for this concept; use assemble for a new one`);
  }
  const base = loadBase(options, entry as CandidateEntry & { existingPerspective: object }, paths.base);
  const workdir = readJson<WorkdirManifest>(layout.manifest);
  const load = sourceLoader(layout, workdir);
  const head = analyzeHead(base.head.content, workdir, load);
  const { locks, footerHumanEdits } = computeLocks(base, head);
  // 资料说明总是按引用重新推导；人工改过它时不静默覆盖，须操作者显式确认
  if (footerHumanEdits && !options.rederiveFooter) {
    fail(
      "INCREMENTAL_FOOTER_EDITED",
      `${key}: ${footerHumanEdits} block(s) after the separator differ from the last AI revision (a human edited the source notes); they would be re-derived from the citations and the edit lost. Carry the edit into the session's material, or pass --rederive-footer to accept the re-derivation`,
    );
  }

  const outputs: [string, string][] = [
    [paths.base, jsonText(base)],
    [paths.locks, jsonText(locks)],
  ];
  const result: Omit<IncrementalResult, "key" | "status"> = {
    stage: "awaiting-claim-map",
    pageId: base.pageId,
    baseRevisionId: base.head.revisionId,
    lastAiRevisionId: locks.lastAiRevisionId,
    locked: locks.blocks.length,
    footerHumanEdits,
    claims: null,
    newExcerpts: 0,
    markdownSha256: null,
  };

  if (!existsSync(paths.claimMap)) {
    result.scaffold = scaffold(key, entry, workdir.interpreter, head);
  } else {
    const claimMapText = readFileSync(paths.claimMap, "utf8");
    const map = JSON.parse(claimMapText) as ClaimMap;
    const matched = checkClaimMap(map, key, entry, workdir.interpreter, head);

    // 新摘录：与 assemble 相同，依引用从冻结来源回填
    const cited = new Map<string, FrozenParagraph[]>();
    const noteCited = (paragraph: FrozenParagraph) => {
      const list = cited.get(paragraph.sourceId) ?? [];
      if (!list.includes(paragraph)) list.push(paragraph);
      cited.set(paragraph.sourceId, list);
    };
    const backfill = (claimId: string, input: ExcerptRef) => {
      const ref: ExcerptRef = { paragraph: input.paragraph, from: input.from, to: input.to };
      const source = load(String(ref.paragraph).split(":")[0]);
      const paragraph = source.paragraphs.get(ref.paragraph);
      if (!paragraph) fail("ASSEMBLE_EXCERPT", `${key}/${claimId}: unknown paragraph ${ref.paragraph}`);
      if (!paragraph.inRange) fail("ASSEMBLE_EXCERPT", `${key}/${claimId}: ${ref.paragraph} lies outside the frozen range (a note kept only for reference)`);
      let rendered: RenderedExcerpt;
      try {
        rendered = renderExcerpt(paragraph, ref);
      } catch (error) {
        fail("ASSEMBLE_EXCERPT", `${key}/${claimId}: ${(error as Error).message}`);
      }
      return { paragraph, ref, rendered, citation: citationFor(paragraph, source.manifest) };
    };

    const excerpts: AssembledExcerpt[] = [];
    const checks: { citation: string; check: RenderedExcerpt }[] = [];
    const record = (claimId: string, e: { paragraph: FrozenParagraph; ref: ExcerptRef; rendered: RenderedExcerpt; citation: string }) => {
      noteCited(e.paragraph);
      excerpts.push({
        claimId,
        ref: e.ref,
        text: e.rendered.text,
        truncatedStart: e.rendered.truncatedStart,
        truncatedEnd: e.rendered.truncatedEnd,
        citation: e.citation,
      });
      checks.push({ citation: e.citation, check: e.rendered });
    };

    // 插入点（head 偏移）与插入文字；同一偏移按论点映射的顺序
    const inserts: { at: number; text: string }[] = [];
    const counts = { kept: 0, extended: 0, new: 0 };
    let anchor = head.coreEnd;
    let newExcerpts = 0;
    map.claims.forEach((claim, i) => {
      counts[claim.revision]++;
      const existing = matched[i];
      const added = claim.excerpts.map((ref) => backfill(claim.id, ref));
      newExcerpts += added.length;
      if (existing) {
        for (const e of existing.excerpts) record(claim.id, e);
        for (const e of added) record(claim.id, e);
        if (claim.exposition.trim()) inserts.push({ at: existing.expositionEnd, text: claim.exposition.trim() });
        for (const e of added) inserts.push({ at: existing.end, text: excerptBlockMarkdown(e.rendered.markdown, e.citation) });
        anchor = existing.end;
      } else {
        for (const e of added) record(claim.id, e);
        const blocks = claimBlocks({
          heading: claim.heading,
          exposition: claim.exposition,
          excerpts: added.map((e) => ({ quote: e.rendered.markdown, citation: e.citation })),
        });
        inserts.push({ at: anchor, text: blocks.join("\n\n") });
      }
    });

    const body = head.content.slice(0, head.separatorStart);
    let merged = "";
    let cursor = 0;
    for (const insert of inserts.sort((a, b) => a.at - b.at)) {
      merged += body.slice(cursor, insert.at) + "\n\n" + insert.text;
      cursor = insert.at;
    }
    merged += body.slice(cursor);
    const derived = deriveCoverage(workdir, load, cited);
    const markdown = merged.trimEnd() + "\n\n" + footerMarkdown(derived.items, derived.translations) + "\n";

    selfCheck(key, markdown, checks, "INCREMENTAL_SELF_CHECK");
    // 正文的每个既有块都须原样作为顶层块留存，并保持原有顺序（锁定块自然在内）
    const after = topLevelBlocks(markdown);
    let at = 0;
    for (const block of head.blocks.slice(0, head.bodyBlocks)) {
      at = after.indexOf(block, at);
      if (at < 0) fail("INCREMENTAL_SELF_CHECK", `${key}: an existing block «${block.slice(0, 24)}» does not survive the merge verbatim`);
      at++;
    }

    const assembled: AssembledPerspective = {
      schema: SCHEMAS.assembled,
      conceptKey: key,
      term: map.term,
      interpreter: map.interpreter,
      mode: "edit",
      baseRevisionId: base.head.revisionId,
      inputs: { claimMap: sha256(claimMapText), candidateList: sha256(listText), confirmation: sha256(confirmationText) },
      markdownSha256: sha256(markdown),
      excerpts,
      coverage: derived.coverage,
    };
    outputs.push([paths.markdown, markdown], [paths.assembled, jsonText(assembled)]);
    Object.assign(result, { stage: "merged", claims: counts, newExcerpts, markdownSha256: assembled.markdownSha256 });
  }

  const unchanged = outputs.every(([path, text]) => fileEquals(path, text));
  if (!unchanged) for (const [path, text] of outputs) writeText(path, text);
  // key、status 在前，与其他命令的输出行一致
  return { key, status: unchanged ? "unchanged" : "written", ...result };
}
