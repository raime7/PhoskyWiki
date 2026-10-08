// 站点导出（export-site）：经站点的公开只读接口（游客权限，不登录、不写站点）取得流水线需要的站上现状。
// - 缺省：GET /api/site-catalog → candidates/site-terms.json（SiteExport，只含在线页面）。
// - --key：按候选清单里的已有视角，GET /api/pages/<id>/history → perspectives/<key>/base.json
//   （IncrementalBase：head = 最大修订 id；上一次 AI 修订 = --ai-user 账号产生的最大修订 id），供 incremental 沿用。
// HTTP 只是下面的薄层；把接口载荷整理成工作目录产物的逻辑是纯函数，测试用夹具覆盖。

import { existsSync } from "node:fs";

import type { SiteCatalog } from "@/lib/site-catalog";

import { fail } from "./errors";
import { SCHEMAS, type CandidateList, type ConceptKey, type IncrementalBase, type PageId, type SiteExport } from "./types";
import { fileEquals, jsonText, readJson, workdirLayout, writeText } from "./workdir";

const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const isText = (value: unknown): value is string => typeof value === "string";

function list(payload: Record<string, unknown>, field: string, what: string): Record<string, unknown>[] {
  const value = payload[field];
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object")) {
    fail("EXPORT_SITE_PAYLOAD", `${what}: "${field}" must be an array of objects`);
  }
  return value as Record<string, unknown>[];
}

/** /api/site-catalog 的载荷 → SiteExport（按 pageId 排序；接口只给在线页面，故 deleted 一律为 false）。 */
export function siteExportFromCatalog(payload: unknown, meta: { origin: string; exportedAt: string }): SiteExport {
  const what = "site catalog";
  if (!payload || typeof payload !== "object") fail("EXPORT_SITE_PAYLOAD", `${what} must be a JSON object`);
  const body = payload as Record<string, unknown>;
  const bad = (field: string, item: unknown): never => fail("EXPORT_SITE_PAYLOAD", `${what}: malformed ${field} entry ${JSON.stringify(item)}`);
  const byId = <T extends { pageId: number }>(rows: T[]) => rows.sort((a, b) => a.pageId - b.pageId);
  const catalog: SiteCatalog = {
    terms: list(body, "terms", what).map((t) =>
      isId(t.pageId) && isText(t.title) && isText(t.slug) && Array.isArray(t.aliases) && t.aliases.every(isText)
        ? { pageId: t.pageId, title: t.title, slug: t.slug, aliases: t.aliases as string[] }
        : bad("terms", t),
    ),
    interpreters: list(body, "interpreters", what).map((i) =>
      isId(i.pageId) && isText(i.title) && isText(i.slug) ? { pageId: i.pageId, title: i.title, slug: i.slug } : bad("interpreters", i),
    ),
    perspectives: list(body, "perspectives", what).map((p) =>
      isId(p.pageId) && isId(p.termId) && isId(p.interpreterId) && isId(p.headRevisionId)
        ? { pageId: p.pageId, termId: p.termId, interpreterId: p.interpreterId, headRevisionId: p.headRevisionId }
        : bad("perspectives", p),
    ),
  };
  return {
    schema: SCHEMAS.siteExport,
    exportedAt: meta.exportedAt,
    origin: meta.origin,
    terms: byId(catalog.terms.map((t) => ({ ...t, deleted: false }))),
    interpreters: byId(catalog.interpreters.map((i) => ({ ...i, deleted: false }))),
    perspectives: byId(catalog.perspectives.map((p) => ({ ...p, deleted: false }))),
  };
}

/**
 * /api/pages/<id>/history 的载荷 → IncrementalBase。head 取最大修订 id（与站点编辑的 base 同一取法）；
 * 上一次 AI 修订取 createdBy = aiUser 的最大修订 id，没有则为 null（incremental 会把正文全部锁定）。
 */
export function incrementalBaseFromHistory(payload: unknown, options: { pageId: PageId; aiUser: string }): IncrementalBase {
  const what = `history of page ${options.pageId}`;
  if (!payload || typeof payload !== "object") fail("EXPORT_SITE_PAYLOAD", `${what} must be a JSON object`);
  const body = payload as Record<string, unknown>;
  const page = body.page as Record<string, unknown> | undefined;
  if (!page || page.id !== options.pageId) fail("EXPORT_SITE_PAYLOAD", `${what}: the response is for another page (${JSON.stringify(page?.id)})`);
  if (page.type !== "perspective") fail("EXPORT_SITE_PAYLOAD", `${what}: page ${options.pageId} is a ${String(page.type)}, not a perspective`);
  const revisions = list(body, "revisions", what).map((r) =>
    isId(r.id) && isText(r.content) && (r.createdBy === null || isText(r.createdBy))
      ? { id: r.id, content: r.content, createdBy: r.createdBy as string | null }
      : fail("EXPORT_SITE_PAYLOAD", `${what}: malformed revision ${JSON.stringify({ ...r, content: undefined })}`),
  );
  if (!revisions.length) fail("EXPORT_SITE_PAYLOAD", `${what}: the perspective has no revisions`);
  const latest = (rows: typeof revisions) => rows.reduce((a, b) => (b.id > a.id ? b : a));
  const head = latest(revisions);
  const ai = revisions.filter((r) => r.createdBy === options.aiUser);
  const lastAi = ai.length ? latest(ai) : null;
  return {
    schema: SCHEMAS.incrementalBase,
    pageId: options.pageId,
    head: { revisionId: head.id, content: head.content },
    lastAi: lastAi && { revisionId: lastAi.id, content: lastAi.content },
  };
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

export type FetchJson = (url: string) => Promise<unknown>;

/** 薄 HTTP 层：游客 GET，不带 Cookie，不跟随重定向。 */
const fetchJson: FetchJson = async (url) => {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "error", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(60000) });
  } catch (error) {
    fail("EXPORT_SITE_HTTP", `GET ${url}: ${(error as Error).message}`);
  }
  if (!response.ok) fail("EXPORT_SITE_HTTP", `GET ${url}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    fail("EXPORT_SITE_HTTP", `GET ${url}: the response is not JSON`);
  }
};

export interface ExportSiteOptions {
  workdir: string;
  origin: string;
  /** 给出时导出这些概念的已有视角（base.json），否则导出 site-terms.json */
  keys?: ConceptKey[];
  /** AI 编者账号的用户 id（修订历史的 createdBy），导出视角时必填 */
  aiUser?: string;
  fetch?: FetchJson;
  now?: Date;
}

export type ExportSiteResult =
  | { file: "site-terms.json"; status: "written"; terms: number; interpreters: number; perspectives: number }
  | { file: "base.json"; key: ConceptKey; status: "written" | "unchanged"; pageId: PageId; headRevisionId: number; lastAiRevisionId: number | null; headMovedSinceCandidates: boolean };

export async function exportSite(options: ExportSiteOptions): Promise<ExportSiteResult[]> {
  const origin = options.origin.replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+$/.test(origin)) fail("EXPORT_SITE_ORIGIN", `--origin must be a site origin such as https://wiki.example.org, got "${options.origin}"`);
  const get = options.fetch ?? fetchJson;
  const layout = workdirLayout(options.workdir);

  if (!options.keys?.length) {
    const site = siteExportFromCatalog(await get(`${origin}/api/site-catalog`), { origin, exportedAt: (options.now ?? new Date()).toISOString() });
    writeText(layout.candidates.siteExport, jsonText(site));
    return [{ file: "site-terms.json", status: "written", terms: site.terms.length, interpreters: site.interpreters.length, perspectives: site.perspectives.length }];
  }

  if (!options.aiUser?.trim()) fail("EXPORT_SITE_AI_USER", "exporting a perspective needs --ai-user <user id of the AI editor account>");
  if (!existsSync(layout.candidates.list)) fail("MISSING_INPUT", "candidates.json not found; run `candidates` first");
  const candidateList = readJson<CandidateList>(layout.candidates.list);
  const outputs: { key: ConceptKey; base: IncrementalBase; listed: number }[] = [];
  for (const key of [...new Set(options.keys)]) {
    const entry = candidateList.entries.find((e) => e.key === key);
    if (!entry) fail("EXPORT_SITE_UNKNOWN_KEY", `${key} is not in candidates.json`);
    if (!entry.existingPerspective) fail("EXPORT_SITE_NO_PERSPECTIVE", `${key}: the candidate list has no existing perspective for this concept`);
    const { pageId, headRevisionId } = entry.existingPerspective;
    const base = incrementalBaseFromHistory(await get(`${origin}/api/pages/${pageId}/history`), { pageId, aiUser: options.aiUser.trim() });
    outputs.push({ key, base, listed: headRevisionId });
  }
  // 全部取到后才落盘
  return outputs.map(({ key, base, listed }) => {
    const path = layout.perspective(key).base;
    const text = jsonText(base);
    const unchanged = fileEquals(path, text);
    if (!unchanged) writeText(path, text);
    return {
      file: "base.json",
      key,
      status: unchanged ? "unchanged" : "written",
      pageId: base.pageId,
      headRevisionId: base.head.revisionId,
      lastAiRevisionId: base.lastAi?.revisionId ?? null,
      headMovedSinceCandidates: base.head.revisionId !== listed,
    };
  });
}
