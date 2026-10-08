// 视角模板（#105「模板」；ADR-0009）：assemble（#109）按它生成，validate（#110）与 incremental（#111）按它解析。
//
// 固定结构（Markdown 顶层块，依次）：
//   1. 一句话核心：一个段落（也是词条枢纽页取用的首段摘要，见 src/lib/perspective-excerpt.ts）
//   2. 每个论点：`## 标题` → 解读（段落或列表，一块或多块）→ 1–3 个摘录引用块
//      摘录引用块恰好两个段落：引文（截断处为“……”）与出处行（以“——”开头）
//   3. 分隔线 `---`
//   4. `**资料覆盖范围**` + 列表（每本实际被引用的书一项）
//   5. `**译本**` + 列表
//   6. `**生成方式**：本解读由 AI 生成、经管理员受理。……`
//
// 引文 Markdown 只由 excerptMarkdown 从冻结段落生成：ASCII 标点一律转义，强调按冻结的 span 写成
// `**`/`*`，两侧用空 HTML 注释 `<!-- -->` 隔开，避免中文紧邻标点时星号不成对（CommonMark 的
// flanking 规则）；站点渲染管线不放行原始 HTML，注释不会出现在页面上。行首不放注释（会变成 HTML 块）。

import type { Node } from "unist";

import { markdownParser } from "@/lib/markdown-ast";
import { renderMarkdownTree } from "@/lib/markdown";

import type { EmphasisKind, EmphasisSpan, ExcerptRef, FrozenParagraph } from "./types";

export const TEMPLATE = {
  /** 论点小节标题层级 */
  claimHeadingDepth: 2,
  /** 截断标记 */
  truncation: "……",
  /** 摘录引用块中出处行的前缀 */
  citationPrefix: "——",
  /** 分隔线（正文与资料说明之间） */
  separator: "---",
  /** 资料说明三节的加粗标签，按顺序出现 */
  labels: { coverage: "资料覆盖范围", translations: "译本", generation: "生成方式" },
  /** AI 生成说明：必须逐字出现在「生成方式」段 */
  aiNotice: "本解读由 AI 生成、经管理员受理。",
  /** 「生成方式」段在 AI 说明之后的固定补充 */
  generationDetail: "原文摘录由程序依冻结来源逐字回填，截断处以“……”标明。",
  /** 强调标记两侧的分隔注释 */
  emphasisSeparator: "<!-- -->",
} as const;

// ---------------------------------------------------------------------------
// 引文：从冻结段落截取并写成 Markdown
// ---------------------------------------------------------------------------

export interface ExcerptSlice {
  start: number;
  end: number;
  /** 引文可见文字（冻结 text 的子串，不含截断标记） */
  text: string;
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

/** 按句子范围截取冻结段落；首尾空白移出引文。引用不合法时抛出 EXCERPT_REF。 */
export function excerptSlice(paragraph: FrozenParagraph, ref: ExcerptRef): ExcerptSlice {
  const count = paragraph.sentences.length;
  if (!Number.isInteger(ref.from) || !Number.isInteger(ref.to) || ref.from < 1 || ref.to < ref.from || ref.to > count) {
    throw new Error(`EXCERPT_REF: ${paragraph.id} has sentences 1–${count}, got ${ref.from}–${ref.to}`);
  }
  let start = paragraph.sentences[ref.from - 1].start;
  let end = paragraph.sentences[ref.to - 1].end;
  while (start < end && /\s/.test(paragraph.text[start])) start++;
  while (end > start && /\s/.test(paragraph.text[end - 1])) end--;
  return {
    start,
    end,
    text: paragraph.text.slice(start, end),
    truncatedStart: ref.from > 1,
    truncatedEnd: ref.to < count,
  };
}

/** 截取范围内的强调（偏移相对引文文字，已去掉首尾空白，按起点排序）。 */
export function excerptEmphasis(paragraph: FrozenParagraph, slice: ExcerptSlice): EmphasisSpan[] {
  const spans: EmphasisSpan[] = [];
  for (const span of paragraph.emphasis) {
    let start = Math.max(span.start, slice.start) - slice.start;
    let end = Math.min(span.end, slice.end) - slice.start;
    while (start < end && /\s/.test(slice.text[start])) start++;
    while (end > start && /\s/.test(slice.text[end - 1])) end--;
    if (start < end) spans.push({ ...span, start, end });
  }
  return spans.sort((a, b) => a.start - b.start || a.end - b.end);
}

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/g;

/** 把纯文本转义为字面显示的 Markdown 行内文字（ASCII 标点一律反斜杠转义，换行保留）。 */
export function escapeMarkdownText(text: string): string {
  return text.replace(ASCII_PUNCTUATION, (char) => `\\${char}`);
}

const MARKER: Record<string, string> = { strong: "**", em: "*", "em+strong": "***" };

/** 引文文字连同强调写成单个 Markdown 段落的内容（不含引用块前缀）。 */
export function emphasizedMarkdown(text: string, spans: readonly EmphasisSpan[]): string {
  // 按全部边界切分，每段取其上生效的强调种类集合；相邻段各自成对，不依赖嵌套
  const cuts = new Set<number>([0, text.length]);
  for (const span of spans) {
    cuts.add(span.start);
    cuts.add(span.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  let out = "";
  for (let i = 0; i < points.length - 1; i++) {
    const [start, end] = [points[i], points[i + 1]];
    const segment = text.slice(start, end);
    const kinds = [...new Set(spans.filter((s) => s.start <= start && s.end >= end).map((s) => s.kind))].sort();
    if (kinds.length === 0) {
      out += escapeMarkdownText(segment);
      continue;
    }
    // 段内首尾空白放到标记外，标记才能成对
    const lead = segment.match(/^\s*/)![0];
    const trail = segment.slice(lead.length).match(/\s*$/)![0];
    const core = segment.slice(lead.length, segment.length - trail.length);
    if (!core) {
      out += escapeMarkdownText(segment);
      continue;
    }
    const marker = MARKER[kinds.join("+") as keyof typeof MARKER];
    out += escapeMarkdownText(lead);
    if (out.length > 0 && !out.endsWith("\n")) out += TEMPLATE.emphasisSeparator;
    out += marker + escapeMarkdownText(core) + marker;
    if (end < text.length || trail) out += TEMPLATE.emphasisSeparator;
    out += escapeMarkdownText(trail);
  }
  return out;
}

export interface RenderedExcerpt extends ExcerptSlice {
  /** 引用块中的引文段落（带截断标记，不含 `> ` 前缀） */
  markdown: string;
  emphasis: EmphasisSpan[];
}

export function renderExcerpt(paragraph: FrozenParagraph, ref: ExcerptRef): RenderedExcerpt {
  const slice = excerptSlice(paragraph, ref);
  const emphasis = excerptEmphasis(paragraph, slice);
  const body = emphasizedMarkdown(slice.text, emphasis);
  const markdown =
    (slice.truncatedStart ? TEMPLATE.truncation : "") + body + (slice.truncatedEnd ? TEMPLATE.truncation : "");
  return { ...slice, markdown, emphasis };
}

/** 引文在页面上应呈现的可见文字（含截断标记），供逐字回查。 */
export function expectedVisibleQuote(slice: Pick<ExcerptSlice, "text" | "truncatedStart" | "truncatedEnd">): string {
  return (slice.truncatedStart ? TEMPLATE.truncation : "") + slice.text + (slice.truncatedEnd ? TEMPLATE.truncation : "");
}

// ---------------------------------------------------------------------------
// 整篇组装
// ---------------------------------------------------------------------------

export interface TemplateInput {
  core: string;
  claims: { heading: string; exposition: string; excerpts: { quote: string; citation: string }[] }[];
  /** 资料覆盖范围列表项（纯文本，会转义） */
  coverage: string[];
  /** 译本列表项（纯文本，会转义） */
  translations: string[];
}

function blockquote(lines: string): string {
  return lines
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

/** 一个摘录引用块：引文段与“——出处”段（出处为纯文本，会转义）。 */
export function excerptBlockMarkdown(quote: string, citation: string): string {
  return blockquote(`${quote}\n\n${TEMPLATE.citationPrefix}${escapeMarkdownText(citation)}`);
}

/** 一个论点小节的顶层块：标题、解读、各摘录引用块（incremental 新增论点也用它）。 */
export function claimBlocks(claim: TemplateInput["claims"][number]): string[] {
  return [
    `${"#".repeat(TEMPLATE.claimHeadingDepth)} ${claim.heading.trim()}`,
    claim.exposition.trim(),
    ...claim.excerpts.map((excerpt) => excerptBlockMarkdown(excerpt.quote, excerpt.citation)),
  ];
}

/** 分隔线及其后的资料说明（资料覆盖范围、译本、生成方式），不含末尾换行。 */
export function footerMarkdown(coverage: string[], translations: string[]): string {
  const list = (items: string[]) => items.map((item) => `- ${escapeMarkdownText(item)}`).join("\n");
  return [
    TEMPLATE.separator,
    `**${TEMPLATE.labels.coverage}**`,
    list(coverage),
    `**${TEMPLATE.labels.translations}**`,
    list(translations),
    `**${TEMPLATE.labels.generation}**：${TEMPLATE.aiNotice}${TEMPLATE.generationDetail}`,
  ].join("\n\n");
}

export function renderPerspectiveMarkdown(input: TemplateInput): string {
  const blocks: string[] = [input.core.trim(), ...input.claims.flatMap(claimBlocks)];
  blocks.push(footerMarkdown(input.coverage, input.translations));
  return blocks.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// 解析（validate / incremental 复用）
// ---------------------------------------------------------------------------

interface MdNode extends Node {
  value?: string;
  depth?: number;
  children?: MdNode[];
  data?: { alias?: string | null };
}

export interface ParsedExcerpt {
  /** 引文段落的 Markdown 源（不含 `> ` 前缀） */
  quoteMarkdown: string;
  /** 出处行纯文本（去掉前缀“——”） */
  citation: string;
}

export interface ParsedClaim {
  heading: string;
  /** 解读的 Markdown 源（各块原样，空行分隔） */
  exposition: string;
  excerpts: ParsedExcerpt[];
}

export interface ParsedPerspective {
  /** 结构问题；为空即符合模板 */
  errors: string[];
  core: string | null;
  claims: ParsedClaim[];
  coverage: string[];
  translations: string[];
  generation: string | null;
}

/** 节点的纯文本（转义已由解析器还原；双链取显示文字）。 */
export function plainText(node: MdNode): string {
  if (node.type === "wikiLink") return node.data?.alias ?? node.value ?? "";
  if (typeof node.value === "string" && node.type !== "html") return node.value;
  return (node.children ?? []).map(plainText).join("");
}

function sourceOf(markdown: string, node: Node): string {
  return markdown.slice(node.position!.start.offset!, node.position!.end.offset!);
}

function isLabel(node: MdNode | undefined, label: string): boolean {
  return (
    node?.type === "paragraph" &&
    node.children?.length === 1 &&
    node.children[0].type === "strong" &&
    plainText(node.children[0]) === label
  );
}

/** 按模板拆解视角 Markdown；不抛异常，所有偏差记入 errors。 */
export function parsePerspectiveMarkdown(markdown: string): ParsedPerspective {
  const tree = markdownParser().parse(markdown) as MdNode;
  const blocks = (tree.children ?? []).filter((node) => node.type !== "html" || plainText(node).trim());
  const result: ParsedPerspective = { errors: [], core: null, claims: [], coverage: [], translations: [], generation: null };
  const fail = (message: string) => result.errors.push(message);

  let i = 0;
  if (blocks[i]?.type === "paragraph") result.core = plainText(blocks[i++]).trim();
  else fail("模板：开头必须是一句话核心（一个段落）");

  while (blocks[i]?.type === "heading" && blocks[i].depth === TEMPLATE.claimHeadingDepth) {
    const claim: ParsedClaim = { heading: plainText(blocks[i++]).trim(), exposition: "", excerpts: [] };
    const exposition: string[] = [];
    while (blocks[i] && (blocks[i].type === "paragraph" || blocks[i].type === "list")) exposition.push(sourceOf(markdown, blocks[i++]));
    claim.exposition = exposition.join("\n\n");
    if (!exposition.length) fail(`模板：论点「${claim.heading}」缺少解读`);
    while (blocks[i]?.type === "blockquote") {
      const quote = blocks[i++];
      const parts = quote.children ?? [];
      const citation = parts[1] ? plainText(parts[1]) : "";
      if (parts.length !== 2 || parts[0].type !== "paragraph" || parts[1].type !== "paragraph" || !citation.startsWith(TEMPLATE.citationPrefix)) {
        fail(`模板：论点「${claim.heading}」的摘录引用块须由引文段与“${TEMPLATE.citationPrefix}”出处段组成`);
        continue;
      }
      claim.excerpts.push({
        quoteMarkdown: sourceOf(markdown, parts[0]).replace(/^> ?/gm, ""),
        citation: citation.slice(TEMPLATE.citationPrefix.length),
      });
    }
    if (!claim.excerpts.length) fail(`模板：论点「${claim.heading}」没有配对的原文摘录`);
    result.claims.push(claim);
  }
  if (!result.claims.length) fail("模板：至少需要一个论点小节（## 标题）");

  if (blocks[i]?.type === "thematicBreak") i++;
  else fail(`模板：论点之后应为分隔线（${blocks[i]?.type ?? "文末"}）`);

  const labelledList = (label: string): string[] => {
    if (!isLabel(blocks[i], label)) {
      fail(`模板：缺少「${label}」`);
      return [];
    }
    i++;
    if (blocks[i]?.type !== "list") {
      fail(`模板：「${label}」之后应为列表`);
      return [];
    }
    return (blocks[i++].children ?? []).map((item) => plainText(item).trim());
  };
  result.coverage = labelledList(TEMPLATE.labels.coverage);
  if (blocks[i - 1]?.type === "list" && !result.coverage.length) fail(`模板：「${TEMPLATE.labels.coverage}」为空`);
  result.translations = labelledList(TEMPLATE.labels.translations);

  const generation = blocks[i];
  const first = generation?.children?.[0];
  if (generation?.type === "paragraph" && first?.type === "strong" && plainText(first) === TEMPLATE.labels.generation) {
    result.generation = plainText(generation).slice(TEMPLATE.labels.generation.length).replace(/^：/, "").trim();
    if (!result.generation.includes(TEMPLATE.aiNotice)) fail(`模板：「${TEMPLATE.labels.generation}」缺少 AI 生成说明`);
    i++;
  } else {
    fail(`模板：缺少「${TEMPLATE.labels.generation}」`);
  }
  if (i < blocks.length) fail(`模板：「${TEMPLATE.labels.generation}」之后不应再有内容（${blocks[i].type}）`);
  return result;
}

// ---------------------------------------------------------------------------
// 经站点渲染管线的实际呈现（validate 逐字回查用）
// ---------------------------------------------------------------------------

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
}

export interface VisibleExcerpt {
  /** 引文段落的可见文字（含截断标记） */
  text: string;
  /** 可见文字上的强调区间（相邻同类区间已合并） */
  emphasis: { start: number; end: number; kind: EmphasisKind }[];
  /** 出处段的可见文字（含前缀“——”） */
  citation: string;
}

/** 用站点自己的 Markdown 管线（src/lib/markdown.ts）渲染，取出每个引用块的可见引文与强调。 */
export function renderedExcerpts(markdown: string): VisibleExcerpt[] {
  const tree = renderMarkdownTree(markdown, () => ({ href: "", exists: false })) as unknown as HastNode;
  const out: VisibleExcerpt[] = [];
  const walk = (node: HastNode) => {
    if (node.type === "element" && node.tagName === "blockquote") {
      const paragraphs = (node.children ?? []).filter((child) => child.type === "element" && child.tagName === "p");
      const emphasis: VisibleExcerpt["emphasis"] = [];
      const text = paragraphs[0] ? collect(paragraphs[0], [], emphasis, { offset: 0 }) : "";
      out.push({ text, emphasis: mergeSpans(emphasis), citation: paragraphs[1] ? collect(paragraphs[1], [], [], { offset: 0 }) : "" });
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return out;
}

function collect(node: HastNode, active: EmphasisKind[], spans: VisibleExcerpt["emphasis"], cursor: { offset: number }): string {
  if (node.type === "text") {
    const value = node.value ?? "";
    for (const kind of new Set(active)) spans.push({ start: cursor.offset, end: cursor.offset + value.length, kind });
    cursor.offset += value.length;
    return value;
  }
  const kind: EmphasisKind | null = node.tagName === "strong" ? "strong" : node.tagName === "em" ? "em" : null;
  const next = kind ? [...active, kind] : active;
  return (node.children ?? []).map((child) => collect(child, next, spans, cursor)).join("");
}

function mergeSpans(spans: VisibleExcerpt["emphasis"]): VisibleExcerpt["emphasis"] {
  const merged: VisibleExcerpt["emphasis"] = [];
  for (const span of [...spans].sort((a, b) => a.kind.localeCompare(b.kind) || a.start - b.start)) {
    const last = merged.at(-1);
    if (last && last.kind === span.kind && last.end === span.start) last.end = span.end;
    else if (span.end > span.start) merged.push({ ...span });
  }
  return merged.sort((a, b) => a.start - b.start || a.end - b.end || a.kind.localeCompare(b.kind));
}

/** 冻结强调区间（引文坐标）在页面可见文字中的期望位置：只按截断标记平移，相邻同类区间合并。 */
export function expectedVisibleEmphasis(
  slice: Pick<ExcerptSlice, "truncatedStart">,
  spans: readonly EmphasisSpan[],
): VisibleExcerpt["emphasis"] {
  const shift = slice.truncatedStart ? TEMPLATE.truncation.length : 0;
  return mergeSpans(spans.map((span) => ({ start: span.start + shift, end: span.end + shift, kind: span.kind })));
}

