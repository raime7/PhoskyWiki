// freeze：读取有文字层的 EPUB / TXT / Markdown 与章节范围，写出 sources/<id>/ 冻结产物。
// 纯函数 freezeBook 产出全部文件内容；writeFrozenSource 负责落盘与重跑一致性检查。
// 不支持 OCR：没有文字层的来源在读取阶段就会得到空段落并报错。

import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";

import { readEpub } from "./source/epub";
import { normalizeText, splitSentences } from "./source/normalize";
import type { RawBlock, RawBook } from "./source/raw";
import { readMarkdown, readTxt } from "./source/text";
import {
  isPseudoInterpreter,
  SCHEMAS,
  type EmphasisSpan,
  type FreezeRules,
  type FrozenParagraph,
  type Landmark,
  type Layer,
  type NormalizationLogEntry,
  type NoteRef,
  type SourceFormat,
  type SourceManifest,
  type WorkdirManifest,
} from "./types";
import { fileEquals, ID_PATTERN, jsonlText, jsonText, readJson, sha256, workdirLayout, writeText } from "./workdir";

const CHINESE_NUMERAL = "[一二三四五六七八九十百千零〇两\\d]+";

export const DEFAULT_RULES: FreezeRules = {
  sectionMarkers: [{ pattern: "^§\\s*(\\d+)$", label: "§$1" }],
  layerMarkers: [
    { pattern: "^[〔【\\[［]说明[〕】\\]］]", layer: "说明", label: "说明", sticky: true },
    { pattern: "^说明[：:]", layer: "说明", label: "说明", sticky: true },
    { pattern: "^附释([一二三四五六七八九十]*)[：:]", layer: "附释", label: "附释$1", sticky: true },
    { pattern: "^[〔【\\[［](译注|译者注)[〕】\\]］]", layer: "译注", label: "译注", sticky: false },
    { pattern: "^(译注|译者注)[：:]", layer: "译注", label: "译注", sticky: false },
    { pattern: "^[〔【\\[［](原注|作者注)[〕】\\]］]", layer: "原注", label: "原注", sticky: false },
    { pattern: "^[〔【\\[［](编者注|编注)[〕】\\]］]", layer: "编者注", label: "编者注", sticky: false },
  ],
  noteLayers: [
    { pattern: "译者注|译注|——译者", layer: "译注" },
    { pattern: "编者注|编注|——编者", layer: "编者注" },
    { pattern: "原注|作者注", layer: "原注" },
  ],
  txtHeadings: [
    { pattern: `^第${CHINESE_NUMERAL}[部卷编篇]`, level: 1, maxLength: 40 },
    { pattern: `^第${CHINESE_NUMERAL}章`, level: 2, maxLength: 40 },
    { pattern: `^第${CHINESE_NUMERAL}节`, level: 3, maxLength: 40 },
    { pattern: "^[A-ZＡ-Ｚ][．.][^\\s.．]", level: 3, maxLength: 20 },
  ],
  emphasisClasses: { point: "strong", bold: "strong", emphasis: "strong", em: "em", italic: "em" },
  noteContainerClasses: ["footnote", "footnotes", "endnote", "endnotes", "note", "notes"],
};

const NOTE_LAYERS = new Set<Layer>(["译注", "原注", "编者注", "注"]);
const NOTE_MARKER = /^[[［〔(（【]?\s*(?:注\s*)?(?:\d{1,4}|[①-⑳㉑-㉟]|\*{1,3}|[†‡]|[一二三四五六七八九十]{1,3})\s*[\]］〕)）】]?$/;

export interface FreezeInput {
  bytes: Buffer;
  fileName: string;
  format?: SourceFormat;
  sourceId: string;
  title: string;
  author: string;
  translator: string | null;
  edition: string | null;
  from: string | null;
  to: string | null;
  rules?: Partial<FreezeRules>;
}

export interface FrozenSource {
  manifest: SourceManifest;
  paragraphs: FrozenParagraph[];
  landmarks: Landmark[];
  log: NormalizationLogEntry[];
  /** 待写入的文件：相对 sources/<id>/ 的名称 → 内容 */
  files: { name: string; content: string | Buffer }[];
}

export function detectFormat(fileName: string): SourceFormat {
  const ext = extname(fileName).toLowerCase();
  if (ext === ".epub") return "epub";
  if (ext === ".txt") return "txt";
  if (ext === ".md" || ext === ".markdown") return "md";
  throw new Error(`FREEZE_FORMAT: unsupported file type ${ext || "(none)"}; use EPUB, TXT or Markdown with a text layer (no OCR)`);
}

export function resolveRules(override: Partial<FreezeRules> | undefined): FreezeRules {
  const rules: FreezeRules = { ...DEFAULT_RULES, ...override };
  const patterns = [
    ...rules.sectionMarkers.map((r) => r.pattern),
    ...rules.layerMarkers.map((r) => r.pattern),
    ...rules.noteLayers.map((r) => r.pattern),
    ...rules.txtHeadings.map((r) => r.pattern),
  ];
  for (const pattern of patterns) {
    try {
      new RegExp(pattern);
    } catch {
      throw new Error(`FREEZE_RULES: invalid pattern ${pattern}`);
    }
  }
  return rules;
}

interface Item {
  order: number;
  unit: string;
  inSpine: boolean;
  block: RawBlock;
  text: string;
  landmark: Landmark | null;
  paragraph: FrozenParagraph | null;
  map: number[];
  normalizationRules: NormalizationLogEntry["rules"];
}

function squash(value: string): string {
  return value.replace(/[\s　]+/g, "");
}

export function freezeBook(input: FreezeInput): FrozenSource {
  if (!ID_PATTERN.test(input.sourceId)) throw new Error(`FREEZE_ID: source id must match ${ID_PATTERN}`);
  if (!input.title.trim()) throw new Error("FREEZE_ARGS: --title is required");
  if (!input.author.trim()) throw new Error("FREEZE_ARGS: --author (the interpreter) is required");
  if (isPseudoInterpreter(input.author)) {
    throw new Error(`FREEZE_PSEUDO_INTERPRETER: "${input.author}" is not an interpreter (ADR-0007); use the work's author`);
  }
  const format = input.format ?? detectFormat(input.fileName);
  const rules = resolveRules(input.rules);
  // 产物只记文件名，不记调用路径，保证换目录重跑仍逐字节一致
  const fileName = basename(input.fileName);
  const book: RawBook =
    format === "epub"
      ? readEpub(input.bytes, fileName, rules)
      : format === "txt"
        ? readTxt(input.bytes, fileName, rules)
        : readMarkdown(input.bytes, fileName);

  const items = buildItems(input.sourceId, book, rules);
  linkNotes(items);
  assignLayersAndChapters(items, rules);
  const included = selectRange(items, input.from, input.to);

  const paragraphs: FrozenParagraph[] = [];
  const log: NormalizationLogEntry[] = [];
  const includedIds = new Set(included.map((item) => item.paragraph!.id));
  for (const item of included) {
    const p = item.paragraph!;
    p.noteRefs = p.noteRefs.filter((ref) => includedIds.has(ref.note));
    p.noteFor = p.noteFor.filter((id) => includedIds.has(id));
    p.sentences = splitSentences(p.id, p.text, p.noteRefs);
    paragraphs.push(p);
    const ruleList = [...item.block.readerRules, ...item.normalizationRules];
    if (ruleList.length) log.push({ paragraph: p.id, rules: ruleList, before: item.block.original, after: p.text });
  }
  if (!paragraphs.some((p) => p.inRange)) throw new Error("FREEZE_EMPTY: no paragraphs with a text layer in the selected range");

  const landmarks = items.filter((item) => item.landmark).map((item) => item.landmark!);
  const usedUnits = new Set(paragraphs.map((p) => p.unit));
  const members = book.units
    .filter((unit) => unit.member && usedUnits.has(unit.key))
    .map((unit) => unit.member!)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const paragraphsText = jsonlText(paragraphs);
  const landmarksText = jsonText(landmarks);
  const logText = jsonlText(log);
  const range = rangeLandmarks(items, input.from, input.to);
  const manifest: SourceManifest = {
    schema: SCHEMAS.sourceManifest,
    sourceId: input.sourceId,
    work: { title: input.title.trim(), author: input.author.trim(), translator: input.translator, edition: input.edition },
    file: { name: fileName, format, sha256: sha256(input.bytes), bytes: input.bytes.length },
    members,
    range: { from: input.from, to: input.to, fromLandmark: range?.from.id ?? null, toLandmark: range?.to.id ?? null },
    rules,
    counts: {
      paragraphs: paragraphs.length,
      inRange: paragraphs.filter((p) => p.inRange).length,
      notes: paragraphs.filter((p) => NOTE_LAYERS.has(p.layer)).length,
      sentences: paragraphs.reduce((sum, p) => sum + p.sentences.length, 0),
      normalized: log.length,
    },
    outputs: { paragraphs: sha256(paragraphsText), landmarks: sha256(landmarksText), normalizationLog: sha256(logText) },
  };
  return {
    manifest,
    paragraphs,
    landmarks,
    log,
    files: [
      { name: `original.${format}`, content: input.bytes },
      { name: "manifest.json", content: jsonText(manifest) },
      { name: "paragraphs.jsonl", content: paragraphsText },
      { name: "landmarks.json", content: landmarksText },
      { name: "normalization-log.jsonl", content: logText },
      { name: "reading.md", content: readingText(manifest, paragraphs) },
    ],
  };
}

function buildItems(sourceId: string, book: RawBook, rules: FreezeRules): Item[] {
  const sectionRules = rules.sectionMarkers.map((rule) => ({ regex: new RegExp(rule.pattern), label: rule.label }));
  const items: Item[] = [];
  let order = 0;
  for (const unit of book.units) {
    let paragraphOrdinal = 0;
    let landmarkOrdinal = 0;
    for (const block of unit.blocks) {
      const normalized = normalizeText(block.raw);
      const text = normalized.text;
      if (!text) continue;
      order++;
      const base = { order, unit: unit.key, inSpine: unit.inSpine, block, text, map: normalized.map, normalizationRules: normalized.rules };
      const section = block.kind === "paragraph" ? sectionRules.find((rule) => rule.regex.test(text)) : undefined;
      if (block.kind === "heading" || section) {
        landmarkOrdinal++;
        const landmark: Landmark = {
          id: `${sourceId}:${unit.key}.h${landmarkOrdinal}`,
          kind: section ? "section" : "heading",
          level: section ? 7 : block.level,
          title: section ? text.replace(section.regex, section.label) : text,
          order,
          inRange: false,
        };
        items.push({ ...base, landmark, paragraph: null });
        continue;
      }
      paragraphOrdinal++;
      const id = `${sourceId}:${unit.key}.p${paragraphOrdinal}`;
      const emphasis: EmphasisSpan[] = block.emphasis
        .map((span) => ({ start: normalized.map[span.start], end: normalized.map[span.end], kind: span.kind, via: span.via }))
        .filter((span) => span.end > span.start)
        .sort((a, b) => a.start - b.start || a.end - b.end);
      const paragraph: FrozenParagraph = {
        id,
        sourceId,
        unit: unit.key,
        ordinal: paragraphOrdinal,
        order,
        inRange: false,
        chapterPath: [],
        section: null,
        layer: "正文",
        layerLabel: "正文",
        text,
        rawText: block.original,
        textSha256: sha256(text),
        emphasis,
        sentences: [],
        noteRefs: [],
        noteFor: [],
        locator: block.locator,
      };
      items.push({ ...base, landmark: null, paragraph });
    }
  }
  return items;
}

/** 注号配对：依链接目标而非显示数字；双向链接中较早的一方是正文、较晚的是注释。 */
function linkNotes(items: Item[]): void {
  const byKey = new Map<string, Item>();
  for (const item of items) if (item.paragraph) for (const key of item.block.ids) if (!byKey.has(key)) byKey.set(key, item);
  for (const item of items) {
    const p = item.paragraph;
    if (!p) continue;
    for (const link of item.block.links) {
      const target = byKey.get(link.target);
      if (!target?.paragraph || target === item) continue;
      const start = item.map[link.start];
      const end = item.map[link.end];
      const marker = p.text.slice(start, end);
      const isNote = link.noteref || (NOTE_MARKER.test(marker.trim()) && target.order > item.order && !item.block.noteContainer);
      if (!isNote || end <= start) continue;
      const ref: NoteRef = { marker, start, end, note: target.paragraph.id };
      p.noteRefs.push(ref);
      if (!target.paragraph.noteFor.includes(p.id)) target.paragraph.noteFor.push(p.id);
    }
  }
}

function assignLayersAndChapters(items: Item[], rules: FreezeRules): void {
  const markers = rules.layerMarkers.map((rule) => ({ ...rule, regex: new RegExp(rule.pattern) }));
  const noteLayers = rules.noteLayers.map((rule) => ({ ...rule, regex: new RegExp(rule.pattern) }));
  const headings: { level: number; title: string }[] = [];
  let section: string | null = null;
  let running: { layer: Layer; label: string } = { layer: "正文", label: "正文" };
  for (const item of items) {
    if (item.landmark) {
      running = { layer: "正文", label: "正文" };
      if (item.landmark.kind === "section") {
        section = item.landmark.title;
      } else {
        while (headings.length && headings[headings.length - 1].level >= item.landmark.level) headings.pop();
        headings.push({ level: item.landmark.level, title: item.landmark.title });
        section = null;
      }
      continue;
    }
    const p = item.paragraph!;
    p.chapterPath = headings.map((h) => h.title);
    p.section = section;
    if (item.block.noteContainer || p.noteFor.length) {
      p.layer = noteLayers.find((rule) => rule.regex.test(p.text))?.layer ?? "注";
      p.layerLabel = p.layer;
      continue;
    }
    const marker = markers.find((rule) => rule.regex.test(p.text));
    if (marker) {
      const label = marker.regex.exec(p.text)![0].replace(marker.regex, marker.label);
      p.layer = marker.layer;
      p.layerLabel = label;
      if (marker.sticky) running = { layer: marker.layer, label };
    } else {
      p.layer = running.layer;
      p.layerLabel = running.label;
    }
  }
}

function findLandmark(items: Item[], query: string): Item {
  const landmarks = items.filter((item) => item.landmark && item.inSpine);
  const exact = landmarks.filter((item) => item.landmark!.id === query);
  const matches = exact.length ? exact : landmarks.filter((item) => squash(item.landmark!.title) === squash(query));
  if (matches.length === 1) return matches[0];
  const listing = (matches.length ? matches : landmarks)
    .slice(0, 40)
    .map((item) => `  ${item.landmark!.id}  ${item.landmark!.title}`)
    .join("\n");
  throw new Error(
    matches.length
      ? `FREEZE_RANGE_AMBIGUOUS: "${query}" matches several landmarks; use an id:\n${listing}`
      : `FREEZE_RANGE_NOT_FOUND: no heading or section marker "${query}"; available:\n${listing}`,
  );
}

function rangeLandmarks(items: Item[], from: string | null, to: string | null): { from: Landmark; to: Landmark } | null {
  if (!from && !to) return null;
  const start = from ? findLandmark(items, from) : items.find((item) => item.landmark && item.inSpine);
  if (!start) throw new Error("FREEZE_RANGE_NOT_FOUND: the book has no headings or section markers");
  const end = to ? findLandmark(items, to) : start;
  if (end.order < start.order) throw new Error(`FREEZE_RANGE_ORDER: "${to}" comes before "${from}"`);
  return { from: start.landmark!, to: end.landmark! };
}

/** 标记范围内条目，返回需要写出的段落：范围内段落 + 被其注号引用的范围外注释。 */
function selectRange(items: Item[], from: string | null, to: string | null): Item[] {
  const range = rangeLandmarks(items, from, to);
  let first = 0;
  let last = items.length;
  if (range) {
    first = from ? items.findIndex((item) => item.landmark === range.from) : 0;
    const toIndex = items.findIndex((item) => item.landmark === range.to);
    const next = items.findIndex(
      (item, i) => i > toIndex && item.inSpine && item.landmark && item.landmark.level <= range.to.level,
    );
    if (next >= 0) last = next;
  }
  for (let i = first; i < last; i++) {
    const item = items[i];
    if (!item.inSpine) continue;
    if (item.landmark) item.landmark.inRange = true;
    if (item.paragraph) item.paragraph.inRange = true;
  }
  const inRangeIds = new Set(items.filter((item) => item.paragraph?.inRange).map((item) => item.paragraph!.id));
  return items.filter(
    (item) => item.paragraph && (item.paragraph.inRange || item.paragraph.noteFor.some((id) => inRangeIds.has(id))),
  );
}

function emphasized(p: FrozenParagraph, start: number, end: number): string {
  let out = "";
  let cursor = start;
  for (const span of p.emphasis) {
    const s = Math.max(span.start, start);
    const e = Math.min(span.end, end);
    if (e <= s || s < cursor) continue;
    const mark = span.kind === "strong" ? "**" : "*";
    out += p.text.slice(cursor, s) + mark + p.text.slice(s, e) + mark;
    cursor = e;
  }
  return out + p.text.slice(cursor, end);
}

/** 阅读稿：给会话看的段落与句子编号，强调以 **…**（strong）/ *…*（em）标出；不是发表格式。 */
function readingText(manifest: SourceManifest, paragraphs: FrozenParagraph[]): string {
  const { work } = manifest;
  const lines = [
    `# 《${work.title}》 · ${work.author}${work.translator ? ` · ${work.translator}译` : ""}`,
    "",
    `冻结阅读稿（来源 ${manifest.sourceId}）。摘录引用写作「段落 ID + 起止句号」，如 ${paragraphs[0]?.id ?? "id"} 第 1–2 句；句号以 ⟨n⟩ 标在句首。`,
  ];
  let chapter = "";
  let outside = false;
  for (const p of paragraphs) {
    if (!p.inRange && !outside) {
      outside = true;
      lines.push("", "## 范围外注释（被范围内注号引用）");
    }
    const path = p.chapterPath.join(" › ");
    if (p.inRange && path !== chapter) {
      chapter = path;
      lines.push("", `## ${path || "（无标题）"}`);
    }
    const head = [p.id, p.section, p.layerLabel].filter(Boolean).join(" · ");
    const notes = p.noteRefs.map((ref) => `${ref.marker}→${ref.note}`).join("，");
    const body = p.sentences.map((s) => `⟨${s.n}⟩${emphasized(p, s.start, s.end)}`).join("");
    lines.push("", `### ${head}`, "", body);
    if (notes) lines.push("", `注号：${notes}`);
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// 落盘
// ---------------------------------------------------------------------------

export interface FreezeResult {
  status: "created" | "unchanged" | "replaced";
  manifest: SourceManifest;
  dir: string;
}

export function writeFrozenSource(workdir: string, frozen: FrozenSource, force: boolean): FreezeResult {
  const layout = workdirLayout(workdir);
  const { manifest } = frozen;
  const target = layout.source(manifest.sourceId);

  const workdirManifest: WorkdirManifest = existsSync(layout.manifest)
    ? readJson<WorkdirManifest>(layout.manifest)
    : { schema: SCHEMAS.workdir, interpreter: manifest.work.author, sources: [] };
  if (workdirManifest.interpreter !== manifest.work.author) {
    throw new Error(
      `WORKDIR_INTERPRETER: this workdir serves ${workdirManifest.interpreter}; a work by ${manifest.work.author} needs its own workdir`,
    );
  }

  const existed = existsSync(target.manifest);
  const unchanged = existed && frozen.files.every((file) => fileEquals(`${target.dir}/${file.name}`, file.content));
  if (existed && !unchanged && !force) {
    throw new Error(
      `FROZEN_SOURCE_CHANGED: sources/${manifest.sourceId} already holds a different freeze; later artifacts cite its ids. Use a new --id, or --force to replace it`,
    );
  }
  if (!unchanged) for (const file of frozen.files) writeText(`${target.dir}/${file.name}`, file.content);

  const others = workdirManifest.sources.filter((source) => source.id !== manifest.sourceId);
  const sources = [...others, { id: manifest.sourceId, title: manifest.work.title, fileSha256: manifest.file.sha256 }].sort(
    (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const nextManifest = jsonText({ ...workdirManifest, sources });
  if (!fileEquals(layout.manifest, nextManifest)) writeText(layout.manifest, nextManifest);

  return { status: unchanged ? "unchanged" : existed ? "replaced" : "created", manifest, dir: target.dir };
}

/** 从工作目录中保存的原文件与规则重新冻结，确认冻结产物未被改动（供 validate 等后续命令使用）。 */
export function verifyFrozenSource(workdir: string, sourceId: string): { ok: boolean; mismatched: string[] } {
  const target = workdirLayout(workdir).source(sourceId);
  const manifest = readJson<SourceManifest>(target.manifest);
  const bytes = readFileSync(target.original(manifest.file.format));
  const again = freezeBook({
    bytes,
    fileName: manifest.file.name,
    format: manifest.file.format,
    sourceId,
    title: manifest.work.title,
    author: manifest.work.author,
    translator: manifest.work.translator,
    edition: manifest.work.edition,
    from: manifest.range.from,
    to: manifest.range.to,
    rules: manifest.rules,
  });
  const mismatched = again.files.filter((file) => !fileEquals(`${target.dir}/${file.name}`, file.content)).map((file) => file.name);
  return { ok: mismatched.length === 0, mismatched };
}
