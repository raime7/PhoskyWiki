// 组装（assemble，#109）：已确认概念的论点映射 → perspectives/<key>/perspective.md + assembled.json。
//
// 引文一律依「段落 ID + 起止句」从冻结来源回填（模型从不书写引文文字），截断处加“……”；
// 出处、资料覆盖范围与译本都由实际引用的冻结段落和来源清单推导。模板结构见 template.ts。
// 全部概念先在内存中组装并自检（站点解析与渲染管线），全部成功才落盘；重跑逐字节一致。

import { existsSync, readFileSync } from "node:fs";

import { markdownParser } from "@/lib/markdown-ast";

import { requireConfirmed } from "./candidates";
import {
  expectedVisibleEmphasis,
  expectedVisibleQuote,
  parsePerspectiveMarkdown,
  renderedExcerpts,
  renderExcerpt,
  renderPerspectiveMarkdown,
  TEMPLATE,
} from "./template";
import {
  isPseudoInterpreter,
  SCHEMAS,
  type AssembledExcerpt,
  type AssembledPerspective,
  type CandidateEntry,
  type CandidateList,
  type ClaimMap,
  type ConceptKey,
  type ExcerptRef,
  type FrozenParagraph,
  type Landmark,
  type SourceCoverage,
  type SourceManifest,
  type WorkdirManifest,
} from "./types";
import { fileEquals, jsonText, readJson, readJsonl, sha256, workdirLayout, writeText, type WorkdirLayout } from "./workdir";

function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

export interface LoadedSource {
  manifest: SourceManifest;
  landmarks: Landmark[];
  paragraphs: Map<string, FrozenParagraph>;
}

/** 按需读取冻结来源，并以来源清单中的哈希核对 paragraphs.jsonl 未被改动。 */
export function sourceLoader(layout: WorkdirLayout, workdir: WorkdirManifest) {
  const cache = new Map<string, LoadedSource>();
  return (sourceId: string): LoadedSource => {
    const hit = cache.get(sourceId);
    if (hit) return hit;
    if (!workdir.sources.some((s) => s.id === sourceId)) fail("ASSEMBLE_EXCERPT", `source "${sourceId}" is not frozen in this workdir`);
    const paths = layout.source(sourceId);
    const manifest = readJson<SourceManifest>(paths.manifest);
    const raw = readFileSync(paths.paragraphs);
    if (sha256(raw) !== manifest.outputs.paragraphs) {
      fail("ASSEMBLE_SOURCE_TAMPERED", `sources/${sourceId}/paragraphs.jsonl does not match its manifest hash; re-freeze the source`);
    }
    const loaded: LoadedSource = {
      manifest,
      landmarks: readJson<Landmark[]>(paths.landmarks),
      paragraphs: new Map(readJsonl<FrozenParagraph>(paths.paragraphs).map((p) => [p.id, p])),
    };
    cache.set(sourceId, loaded);
    return loaded;
  };
}

/** 章节或节号：有节号用节号，否则用最内层标题。 */
function location(paragraph: FrozenParagraph): string | null {
  return paragraph.section ?? paragraph.chapterPath.at(-1) ?? null;
}

/** 出处行（不含前缀“——”），如「《小逻辑》，§86，附释，贺麟译」。 */
export function citationFor(paragraph: FrozenParagraph, manifest: SourceManifest): string {
  const parts = [`《${manifest.work.title}》`, location(paragraph), paragraph.layerLabel];
  if (manifest.work.translator) parts.push(`${manifest.work.translator}译`);
  return parts.filter(Boolean).join("，");
}

export function rangeLabel(source: LoadedSource): string {
  const { from, to, fromLandmark, toLandmark } = source.manifest.range;
  const title = (id: string | null, fallback: string | null) => source.landmarks.find((l) => l.id === id)?.title ?? fallback;
  const start = title(fromLandmark, from);
  const end = title(toLandmark, to);
  if (start && end) return `${start} 至 ${end}`;
  if (start) return `${start} 起`;
  if (end) return `开头至 ${end}`;
  return "全书";
}

/** 「摘录出自 §1（正文、说明）、§2（附释一）」：按阅读顺序列出实际被引用段落的位置与层次。 */
export function citedLabel(paragraphs: FrozenParagraph[]): string {
  const groups: { at: string; layers: string[] }[] = [];
  for (const p of paragraphs) {
    const at = location(p) ?? "（无章节）";
    let group = groups.find((g) => g.at === at);
    if (!group) groups.push((group = { at, layers: [] }));
    if (!group.layers.includes(p.layerLabel)) group.layers.push(p.layerLabel);
  }
  return groups.map((g) => `${g.at}（${g.layers.join("、")}）`).join("、");
}

export function translationLabel(manifest: SourceManifest): string {
  const parts = [manifest.work.translator ? `${manifest.work.translator}译` : "未注明译者", manifest.work.edition];
  return `《${manifest.work.title}》：${parts.filter(Boolean).join("，")}`;
}

export function topLevelTypes(markdown: string): string[] {
  const tree = markdownParser().parse(markdown) as { children?: { type: string }[] };
  return (tree.children ?? []).map((node) => node.type);
}

const REF_KEYS = ["from", "paragraph", "to"].join();

/** 论点映射的形状与身份检查；摘录引用只许三个字段，杜绝夹带引文文字。 */
function checkClaimMap(map: ClaimMap, key: ConceptKey, entry: CandidateEntry, interpreter: string): void {
  const bad = (message: string) => fail("ASSEMBLE_CLAIM_MAP", `${key}: ${message}`);
  if (map.schema !== SCHEMAS.claimMap) bad(`schema must be ${SCHEMAS.claimMap}`);
  if (map.conceptKey !== key) bad(`conceptKey is "${map.conceptKey}"`);
  if (isPseudoInterpreter(map.interpreter ?? "")) fail("ASSEMBLE_PSEUDO_INTERPRETER", `${key}: "${map.interpreter}" is not an interpreter (ADR-0007)`);
  if (map.interpreter !== interpreter) bad(`interpreter "${map.interpreter}" differs from the workdir interpreter "${interpreter}"`);
  if (map.term !== entry.canonicalName && map.term !== entry.existingTerm?.title) {
    bad(`term "${map.term}" is neither the confirmed name "${entry.canonicalName}" nor the matched site term`);
  }
  if (typeof map.core !== "string" || !map.core.trim() || map.core.includes("\n") || topLevelTypes(map.core).join() !== "paragraph") {
    bad("core must be one non-empty sentence (a single Markdown paragraph)");
  }
  if (!Array.isArray(map.claims) || map.claims.length === 0) bad("claims must be a non-empty array");
  const ids = new Set<string>();
  for (const claim of map.claims) {
    if (!claim.id || ids.has(claim.id)) bad(`claim id "${claim.id}" is missing or duplicated`);
    ids.add(claim.id);
    if (!["kept", "extended", "new"].includes(claim.revision)) bad(`${claim.id}: revision must be kept, extended or new`);
    const heading = `${"#".repeat(TEMPLATE.claimHeadingDepth)} ${claim.heading ?? ""}`;
    if (!claim.heading?.trim() || claim.heading.includes("\n") || topLevelTypes(heading).join() !== "heading") {
      bad(`${claim.id}: heading must be a single non-empty line`);
    }
    const types = typeof claim.exposition === "string" ? topLevelTypes(claim.exposition) : [];
    if (!types.length || types.some((t) => t !== "paragraph" && t !== "list")) {
      bad(`${claim.id}: exposition must be paragraphs or lists only (found ${types.join(", ") || "nothing"})`);
    }
    if (!Array.isArray(claim.excerpts)) bad(`${claim.id}: excerpts must be an array`);
    for (const ref of claim.excerpts) {
      if (!ref || typeof ref !== "object" || Object.keys(ref).sort().join() !== REF_KEYS) {
        bad(`${claim.id}: an excerpt ref must be exactly { paragraph, from, to }; quotation text is never written by the session`);
      }
    }
  }
}

export interface AssembledOutput {
  key: ConceptKey;
  markdown: string;
  assembled: AssembledPerspective;
}

export function assemblePerspective(workdirPath: string, key: ConceptKey): AssembledOutput {
  requireConfirmed(workdirPath, key);
  const layout = workdirLayout(workdirPath);
  const paths = layout.perspective(key);
  const listText = readFileSync(layout.candidates.list, "utf8");
  const confirmationText = readFileSync(layout.candidates.confirmation, "utf8");
  const entry = (JSON.parse(listText) as CandidateList).entries.find((e) => e.key === key)!;
  if (!existsSync(paths.claimMap)) fail("MISSING_INPUT", `perspectives/${key}/claim-map.json not found`);
  const claimMapText = readFileSync(paths.claimMap, "utf8");
  const map = JSON.parse(claimMapText) as ClaimMap;
  const workdir = readJson<WorkdirManifest>(layout.manifest);
  checkClaimMap(map, key, entry, workdir.interpreter);

  const load = sourceLoader(layout, workdir);
  const excerpts: AssembledExcerpt[] = [];
  const cited = new Map<string, FrozenParagraph[]>();
  const claims = map.claims.map((claim) => ({
    heading: claim.heading,
    exposition: claim.exposition,
    excerpts: claim.excerpts.map((input) => {
      const ref: ExcerptRef = { paragraph: input.paragraph, from: input.from, to: input.to };
      const source = load(String(ref.paragraph).split(":")[0]);
      const paragraph = source.paragraphs.get(ref.paragraph);
      if (!paragraph) fail("ASSEMBLE_EXCERPT", `${key}/${claim.id}: unknown paragraph ${ref.paragraph}`);
      if (!paragraph.inRange) {
        fail("ASSEMBLE_EXCERPT", `${key}/${claim.id}: ${ref.paragraph} lies outside the frozen range (a note kept only for reference)`);
      }
      let rendered: ReturnType<typeof renderExcerpt>;
      try {
        rendered = renderExcerpt(paragraph, ref);
      } catch (error) {
        fail("ASSEMBLE_EXCERPT", `${key}/${claim.id}: ${(error as Error).message}`);
      }
      const citation = citationFor(paragraph, source.manifest);
      excerpts.push({
        claimId: claim.id,
        ref,
        text: rendered.text,
        truncatedStart: rendered.truncatedStart,
        truncatedEnd: rendered.truncatedEnd,
        citation,
      });
      const list = cited.get(paragraph.sourceId) ?? [];
      if (!list.includes(paragraph)) list.push(paragraph);
      cited.set(paragraph.sourceId, list);
      return { quote: rendered.markdown, citation, check: rendered };
    }),
  }));

  const derived = deriveCoverage(workdir, load, cited);
  const markdown = renderPerspectiveMarkdown({ core: map.core, claims, coverage: derived.items, translations: derived.translations });
  selfCheck(key, markdown, claims.flatMap((c) => c.excerpts));

  const assembled: AssembledPerspective = {
    schema: SCHEMAS.assembled,
    conceptKey: key,
    term: map.term,
    interpreter: map.interpreter,
    mode: entry.existingPerspective ? "edit" : "new",
    baseRevisionId: entry.existingPerspective?.headRevisionId ?? null,
    inputs: { claimMap: sha256(claimMapText), candidateList: sha256(listText), confirmation: sha256(confirmationText) },
    markdownSha256: sha256(markdown),
    excerpts,
    coverage: derived.coverage,
  };
  return { key, markdown, assembled };
}

/**
 * 资料覆盖范围与译本：只列实际被引用的来源（按冻结顺序），段落按阅读顺序。
 * `cited` 为各来源被引用的段落（任意顺序，会就地排序）。assemble 与 incremental 共用。
 */
export function deriveCoverage(
  workdir: WorkdirManifest,
  load: ReturnType<typeof sourceLoader>,
  cited: Map<string, FrozenParagraph[]>,
): { coverage: SourceCoverage[]; items: string[]; translations: string[] } {
  const sources = workdir.sources.filter((s) => cited.has(s.id)).map((s) => ({ id: s.id, source: load(s.id) }));
  for (const { id } of sources) cited.get(id)!.sort((a, b) => a.order - b.order);
  return {
    coverage: sources.map(({ id, source: { manifest } }) => ({
      sourceId: id,
      title: manifest.work.title,
      translator: manifest.work.translator,
      edition: manifest.work.edition,
      range: { from: manifest.range.from, to: manifest.range.to },
      paragraphs: cited.get(id)!.map((p) => p.id),
    })),
    items: sources.map(
      ({ id, source }) => `《${source.manifest.work.title}》，整理范围：${rangeLabel(source)}；摘录出自 ${citedLabel(cited.get(id)!)}`,
    ),
    translations: sources.map(({ source }) => translationLabel(source.manifest)),
  };
}

/** 组装结果必须符合模板，且经站点渲染管线后引文与强调逐字一致。 */
export function selfCheck(
  key: ConceptKey,
  markdown: string,
  expected: { citation: string; check: ReturnType<typeof renderExcerpt> }[],
  code = "ASSEMBLE_SELF_CHECK",
): void {
  const parsed = parsePerspectiveMarkdown(markdown);
  if (parsed.errors.length) fail(code, `${key}: ${parsed.errors.join("; ")}`);
  const visible = renderedExcerpts(markdown);
  if (visible.length !== expected.length) fail(code, `${key}: rendered ${visible.length} excerpts, expected ${expected.length}`);
  expected.forEach(({ citation, check }, i) => {
    const want = expectedVisibleQuote(check);
    if (visible[i].text !== want) fail(code, `${key}: excerpt ${i + 1} renders as «${visible[i].text}», expected «${want}»`);
    if (JSON.stringify(visible[i].emphasis) !== JSON.stringify(expectedVisibleEmphasis(check, check.emphasis))) {
      fail(code, `${key}: excerpt ${i + 1} emphasis does not survive rendering`);
    }
    if (visible[i].citation !== TEMPLATE.citationPrefix + citation) fail(code, `${key}: excerpt ${i + 1} citation renders wrongly`);
  });
}

export interface AssembleResult {
  key: ConceptKey;
  status: "written" | "unchanged";
  mode: AssembledPerspective["mode"];
  excerpts: number;
  markdownSha256: string;
}

/** 组装给定概念（缺省为全部已确认且已有论点映射的概念）；任何一个失败则不写任何文件。 */
export function assemble(workdirPath: string, keys: ConceptKey[] = []): AssembleResult[] {
  const layout = workdirLayout(workdirPath);
  const confirmed = requireConfirmed(workdirPath);
  const targets = keys.length ? keys : confirmed.filter((key) => existsSync(layout.perspective(key).claimMap));
  if (!targets.length) fail("ASSEMBLE_NOTHING", "no confirmed concept has perspectives/<key>/claim-map.json");
  const outputs = [...new Set(targets)].map((key) => assemblePerspective(workdirPath, key));
  return outputs.map(({ key, markdown, assembled }) => {
    const paths = layout.perspective(key);
    const json = jsonText(assembled);
    const unchanged = fileEquals(paths.markdown, markdown) && fileEquals(paths.assembled, json);
    if (!unchanged) {
      writeText(paths.markdown, markdown);
      writeText(paths.assembled, json);
    }
    return {
      key,
      status: unchanged ? "unchanged" : "written",
      mode: assembled.mode,
      excerpts: assembled.excerpts.length,
      markdownSha256: assembled.markdownSha256,
    };
  });
}
