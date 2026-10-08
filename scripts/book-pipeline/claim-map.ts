// 论点映射（claim-map.json）的共用检查：assemble 与 incremental 共享同一套形状与身份规则，
// 各自只在其上叠加本命令特有的规则（assemble：核心与每个论点完整；incremental：核心照抄 head、
// 既有论点按 head 顺序对应）。改这里的规则即同时改两条路径，不会漂移。

import { markdownParser } from "@/lib/markdown-ast";

import { fail } from "./errors";
import { TEMPLATE } from "./template";
import { isPseudoInterpreter, SCHEMAS, type CandidateEntry, type Claim, type ClaimMap, type ConceptKey } from "./types";

export function topLevelTypes(markdown: string): string[] {
  const tree = markdownParser().parse(markdown) as { children?: { type: string }[] };
  return (tree.children ?? []).map((node) => node.type);
}

/** 论点标题：非空单行，且按模板的标题层级解析出来恰好是一个标题。 */
export function validHeading(heading: unknown): heading is string {
  if (typeof heading !== "string" || !heading.trim() || heading.includes("\n")) return false;
  return topLevelTypes(`${"#".repeat(TEMPLATE.claimHeadingDepth)} ${heading}`).join() === "heading";
}

const REF_KEYS = ["from", "paragraph", "to"].join();

export interface ClaimMapContext {
  key: ConceptKey;
  entry: CandidateEntry;
  /** 工作目录的诠释者 */
  interpreter: string;
  /** 形状错误的错误码：ASSEMBLE_CLAIM_MAP / INCREMENTAL_CLAIM_MAP */
  code: string;
}

/**
 * 共用规则：schema、概念键、诠释者（含伪诠释者）、词条名；claims 非空；每个论点 ID 唯一、
 * revision 合法、exposition 是字符串且只含段落与列表（可为空，是否必填由调用方决定）、
 * 摘录引用只许 { paragraph, from, to } 三个字段（杜绝夹带引文文字）。
 * 返回以 `${key}: ` 为前缀、带调用方错误码的 bad()，供调用方叠加特有规则。
 */
export function checkClaimMapCommon(map: ClaimMap, ctx: ClaimMapContext): (message: string) => never {
  const { key, entry, interpreter, code } = ctx;
  const bad = (message: string): never => fail(code, `${key}: ${message}`);
  if (map.schema !== SCHEMAS.claimMap) bad(`schema must be ${SCHEMAS.claimMap}`);
  if (map.conceptKey !== key) bad(`conceptKey is "${map.conceptKey}"`);
  if (isPseudoInterpreter(map.interpreter ?? "")) fail("ASSEMBLE_PSEUDO_INTERPRETER", `${key}: "${map.interpreter}" is not an interpreter (ADR-0007)`);
  if (map.interpreter !== interpreter) bad(`interpreter "${map.interpreter}" differs from the workdir interpreter "${interpreter}"`);
  if (map.term !== entry.canonicalName && map.term !== entry.existingTerm?.title) {
    bad(`term "${map.term}" is neither the confirmed name "${entry.canonicalName}" nor the matched site term`);
  }
  if (!Array.isArray(map.claims) || map.claims.length === 0) bad("claims must be a non-empty array");
  const ids = new Set<string>();
  for (const claim of map.claims as Claim[]) {
    if (!claim.id || ids.has(claim.id)) bad(`claim id "${claim.id}" is missing or duplicated`);
    ids.add(claim.id);
    if (!["kept", "extended", "new"].includes(claim.revision)) bad(`${claim.id}: revision must be kept, extended or new`);
    if (typeof claim.exposition !== "string") bad(`${claim.id}: exposition must be a string`);
    const types = claim.exposition.trim() ? topLevelTypes(claim.exposition.trim()) : [];
    if (types.some((t) => t !== "paragraph" && t !== "list")) bad(`${claim.id}: exposition must be paragraphs or lists only (found ${types.join(", ")})`);
    if (!Array.isArray(claim.excerpts)) bad(`${claim.id}: excerpts must be an array`);
    for (const ref of claim.excerpts) {
      if (!ref || typeof ref !== "object" || Object.keys(ref).sort().join() !== REF_KEYS) {
        bad(`${claim.id}: an excerpt ref must be exactly { paragraph, from, to }; quotation text is never written by the session`);
      }
    }
  }
  return bad;
}
