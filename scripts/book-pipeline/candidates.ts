// 候选（#108）：把会话产出的候选与站点导出合并为供站长确认的清单，并提供确认闸门。
// 确认文件的契约在 types.ts（CandidateConfirmation）；组装等命令用 requireConfirmed() 取已确认的概念键。

import { existsSync, readFileSync } from "node:fs";

import type {
  AdmissionBasis,
  CandidateConfirmation,
  CandidateEntry,
  CandidateList,
  ConceptKey,
  ExcludedCandidate,
  FrozenParagraph,
  SessionCandidate,
  SessionCandidates,
  SiteExport,
} from "./types";
import { SCHEMAS, isPseudoInterpreter } from "./types";
import { ID_PATTERN, fileEquals, jsonText, readJson, readJsonl, sha256, workdirLayout, writeText } from "./workdir";

/** 名称比较用的规范形：NFKC、去空白与间隔点、小写。 */
export function nameKey(name: string): string {
  return name.normalize("NFKC").replace(/[\s·・•．.\-_]/g, "").toLowerCase();
}

function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

function readInput(path: string, what: string): string {
  if (!existsSync(path)) fail("MISSING_INPUT", `${what} not found: ${path}`);
  return readFileSync(path, "utf8");
}

function loadParagraphIds(layout: ReturnType<typeof workdirLayout>, sourceIds: string[]): Set<string> {
  const ids = new Set<string>();
  for (const sourceId of sourceIds) {
    const file = layout.source(sourceId).paragraphs;
    if (!existsSync(file)) fail("MISSING_INPUT", `source "${sourceId}" is not frozen (${file})`);
    for (const p of readJsonl<FrozenParagraph>(file)) if (p.inRange) ids.add(p.id);
  }
  return ids;
}

function validClaims(c: SessionCandidate): number {
  return c.proposedClaims.filter((p) => p.summary.trim() && p.paragraphs.length > 0).length;
}

/** 准入门槛：专门论述——至少 2 个论点，或至少 1 段以该概念为中心。 */
function exclusionReasons(c: SessionCandidate): string[] {
  const reasons: string[] = [];
  if (c.treatment !== "dedicated") reasons.push("会话标为顺带提及（mention），不是专门论述");
  if (validClaims(c) < 2 && c.centralParagraphs.length < 1) {
    reasons.push(`未达准入门槛：论点 ${validClaims(c)} 个（需至少 2 个），以该概念为中心的段落 0 段（需至少 1 段）`);
  }
  return reasons;
}

export function buildCandidateList(workdir: string): { list: CandidateList; text: string } {
  const layout = workdirLayout(workdir);
  const sessionText = readInput(layout.candidates.session, "session candidates");
  const siteText = readInput(layout.candidates.siteExport, "site export");
  const session = JSON.parse(sessionText) as SessionCandidates;
  const site = JSON.parse(siteText) as SiteExport;
  if (session.schema !== SCHEMAS.sessionCandidates) fail("SCHEMA", `session-candidates schema must be ${SCHEMAS.sessionCandidates}`);
  if (site.schema !== SCHEMAS.siteExport) fail("SCHEMA", `site export schema must be ${SCHEMAS.siteExport}`);

  const interpreter = session.interpreter?.trim();
  if (!interpreter) fail("SCHEMA", "session candidates need an interpreter");
  // 禁止「编委会」等伪诠释者（ADR-0009、CONTEXT.md）
  if (isPseudoInterpreter(interpreter)) fail("PSEUDO_INTERPRETER", `"${interpreter}" is not a real interpreter`);
  if (existsSync(layout.manifest)) {
    const wd = readJson<{ interpreter: string }>(layout.manifest);
    if (wd.interpreter !== interpreter) fail("WORKDIR_INTERPRETER", `workdir serves "${wd.interpreter}", candidates say "${interpreter}"`);
  }
  const knownParagraphs = loadParagraphIds(layout, session.sourceIds ?? []);

  // 会话内部：键合法且唯一；名称/别名不得跨候选重复（相同概念应已合并，仅相关的放 related）
  const seenKeys = new Set<string>();
  const nameOwner = new Map<string, string>();
  for (const c of session.candidates) {
    if (!ID_PATTERN.test(c.key)) fail("INVALID_ID", `candidate key must match ${ID_PATTERN}: ${c.key}`);
    if (seenKeys.has(c.key)) fail("DUPLICATE_KEY", `duplicate candidate key ${c.key}`);
    seenKeys.add(c.key);
    for (const name of new Set([c.canonicalName, ...c.aliases].map(nameKey))) {
      const owner = nameOwner.get(name);
      if (owner && owner !== c.key) {
        fail("DUPLICATE_CONCEPT", `candidates "${owner}" and "${c.key}" share the name/alias "${name}"; merge them (mergedFrom) or move one to "related"`);
      }
      nameOwner.set(name, c.key);
    }
    for (const id of [...c.centralParagraphs, ...c.proposedClaims.flatMap((p) => p.paragraphs)]) {
      if (!knownParagraphs.has(id)) fail("UNKNOWN_PARAGRAPH", `candidate ${c.key} cites ${id}, which is not an in-range frozen paragraph of ${session.sourceIds.join(",")}`);
    }
  }

  // 站点索引（已删除的词条不参与匹配）
  const titleIndex = new Map<string, Set<number>>();
  const aliasIndex = new Map<string, Set<number>>();
  const add = (map: Map<string, Set<number>>, name: string, id: number) => {
    const k = nameKey(name);
    if (!map.has(k)) map.set(k, new Set());
    map.get(k)!.add(id);
  };
  const termById = new Map(site.terms.map((t) => [t.pageId, t]));
  for (const t of site.terms) {
    if (t.deleted) continue;
    add(titleIndex, t.title, t.pageId);
    for (const a of t.aliases) add(aliasIndex, a, t.pageId);
  }
  const interpreterIds = new Set(site.interpreters.filter((i) => !i.deleted && nameKey(i.title) === nameKey(interpreter)).map((i) => i.pageId));

  const entries: CandidateEntry[] = [];
  const excluded: ExcludedCandidate[] = [];
  const termClaimedBy = new Map<number, string>();

  for (const c of session.candidates) {
    const reasons = exclusionReasons(c);
    if (reasons.length) {
      excluded.push({ key: c.key, canonicalName: c.canonicalName, reason: reasons.join("；") });
      continue;
    }
    // 候选的规范名与别名对照站上词条标题与别名；标题命中优先于别名命中
    const hits = new Map<number, "title" | "alias">();
    for (const n of [c.canonicalName, ...c.aliases]) {
      const k = nameKey(n);
      for (const id of titleIndex.get(k) ?? []) hits.set(id, "title");
      for (const id of aliasIndex.get(k) ?? []) if (!hits.has(id)) hits.set(id, "alias");
    }
    if (hits.size > 1) {
      const names = [...hits.keys()].map((id) => `${termById.get(id)!.title}(#${id})`).join("、");
      fail("AMBIGUOUS_TERM", `candidate ${c.key} matches several existing terms: ${names}; resolve in the session (merge or drop an alias)`);
    }
    let hit: { id: number; by: "title" | "alias" } | null = null;
    if (hits.size === 1) {
      const [id, by] = [...hits][0];
      hit = { id, by };
      const prev = termClaimedBy.get(id);
      if (prev) fail("DUPLICATE_CONCEPT", `candidates "${prev}" and "${c.key}" both match existing term #${id}; merge them in the session`);
      termClaimedBy.set(id, c.key);
    }
    const perspective = hit
      ? site.perspectives.find((p) => p.termId === hit!.id && !p.deleted && interpreterIds.has(p.interpreterId))
      : undefined;
    const admission: AdmissionBasis[] = [];
    if (validClaims(c) >= 2) admission.push("claims>=2");
    if (c.centralParagraphs.length >= 1) admission.push("central-paragraph");
    entries.push({
      key: c.key,
      canonicalName: c.canonicalName,
      aliases: c.aliases,
      originalTerms: c.originalTerms,
      related: c.related,
      existingTerm: hit ? { pageId: hit.id, title: termById.get(hit.id)!.title, matchedBy: hit.by } : null,
      existingPerspective: perspective ? { pageId: perspective.pageId, headRevisionId: perspective.headRevisionId } : null,
      proposedClaimCount: validClaims(c),
      evidenceParagraphs: [...new Set([...c.centralParagraphs, ...c.proposedClaims.flatMap((p) => p.paragraphs)])],
      admission,
    });
  }

  const list: CandidateList = {
    schema: SCHEMAS.candidateList,
    interpreter,
    inputs: { sessionCandidates: sha256(sessionText), siteExport: sha256(siteText) },
    entries,
    excluded,
  };
  return { list, text: jsonText(list) };
}

/** candidates 命令：生成 candidates.json（内容不变则不写）。 */
export function writeCandidateList(workdir: string): { list: CandidateList; changed: boolean; confirmationInvalidated: boolean } {
  const layout = workdirLayout(workdir);
  const { list, text } = buildCandidateList(workdir);
  const changed = !fileEquals(layout.candidates.list, text);
  if (changed) writeText(layout.candidates.list, text);
  let confirmationInvalidated = false;
  if (changed && existsSync(layout.candidates.confirmation)) {
    confirmationInvalidated = readJson<CandidateConfirmation>(layout.candidates.confirmation).candidateListSha256 !== sha256(text);
  }
  return { list, changed, confirmationInvalidated };
}

/** confirm 命令：站长确认全部或指定概念键，绑定当前清单哈希。 */
export function writeConfirmation(
  workdir: string,
  options: { by: string; keys?: ConceptKey[]; all?: boolean; now?: Date },
): CandidateConfirmation {
  const layout = workdirLayout(workdir);
  if (!options.by?.trim()) fail("CONFIRM_ARGS", "--by <站长名> is required");
  const listText = readInput(layout.candidates.list, "candidates.json (run `candidates` first)");
  const list = JSON.parse(listText) as CandidateList;
  // 输入在生成后又变了：清单已过期，须重新生成并重新过目
  if (buildCandidateList(workdir).text !== listText) fail("STALE_LIST", "candidates.json is out of date with its inputs; rerun `candidates` and review it again");
  if (Boolean(options.all) === Boolean(options.keys?.length)) fail("CONFIRM_ARGS", "give exactly one of --all or --keys a,b,c");
  const live = new Set(list.entries.map((e) => e.key));
  const confirmed = options.all ? list.entries.map((e) => e.key) : [...new Set(options.keys!)];
  for (const key of confirmed) {
    if (!live.has(key)) {
      const ex = list.excluded.find((e) => e.key === key);
      fail("NOT_CONFIRMABLE", ex ? `${key} was excluded: ${ex.reason}` : `${key} is not in candidates.json`);
    }
  }
  if (!confirmed.length) fail("CONFIRM_ARGS", "nothing to confirm");
  const confirmation: CandidateConfirmation = {
    schema: SCHEMAS.confirmation,
    candidateListSha256: sha256(listText),
    confirmedBy: options.by.trim(),
    confirmedAt: (options.now ?? new Date()).toISOString(),
    confirmed,
  };
  writeText(layout.candidates.confirmation, jsonText(confirmation));
  return confirmation;
}

/**
 * 确认闸门，供 assemble 等后续命令调用：返回已确认的概念键，否则抛出 `UNCONFIRMED: …`。
 * 要求 candidates.json 与 confirmation.json 存在、哈希相符；传入 key 时还要求它在已确认之列。
 */
export function requireConfirmed(workdir: string, key?: ConceptKey): ConceptKey[] {
  const layout = workdirLayout(workdir);
  if (!existsSync(layout.candidates.list)) fail("UNCONFIRMED", "candidates.json not found; run `candidates` and `confirm`");
  if (!existsSync(layout.candidates.confirmation)) fail("UNCONFIRMED", "candidate list has not been confirmed; run `confirm`");
  const listText = readFileSync(layout.candidates.list, "utf8");
  const confirmation = readJson<CandidateConfirmation>(layout.candidates.confirmation);
  if (confirmation.schema !== SCHEMAS.confirmation) fail("UNCONFIRMED", "confirmation.json has an unknown schema");
  if (confirmation.candidateListSha256 !== sha256(listText)) fail("UNCONFIRMED", "candidates.json changed after confirmation; review and `confirm` again");
  const live = new Set((JSON.parse(listText) as CandidateList).entries.map((e) => e.key));
  const keys = confirmation.confirmed.filter((k) => live.has(k));
  if (key !== undefined && !keys.includes(key)) fail("UNCONFIRMED", `concept "${key}" is not among the confirmed candidates`);
  return keys;
}
