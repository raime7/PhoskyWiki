// 站点目录（只读）：全部在线词条（含别名）、诠释者与视角（含 head 修订 id）。
// 供书籍流水线的 export-site 生成 site-terms.json（scripts/book-pipeline/export-site.ts）；
// 只含游客本就能看到的信息，软删除页面及其子视角不出现（page-visibility.ts）。

import "server-only";

import { asc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { interpreters, pages, perspectives, revisions, terms } from "@/db/schema";
import { isPageVisible } from "@/lib/page-visibility";

export interface SiteCatalog {
  terms: { pageId: number; title: string; slug: string; aliases: string[] }[];
  interpreters: { pageId: number; title: string; slug: string }[];
  /** headRevisionId 与编辑的 base 修订同一取法：该页最大的修订 id */
  perspectives: { pageId: number; termId: number; interpreterId: number; headRevisionId: number }[];
}

export async function getSiteCatalog(): Promise<SiteCatalog> {
  const db = getDb();
  // 每页最大修订 id；内连接同时去掉没有修订（无法作为编辑 base）的视角
  const heads = db.select({ pageId: revisions.pageId, headRevisionId: sql<number>`max(${revisions.id})`.mapWith(Number).as("head_revision_id") })
    .from(revisions).groupBy(revisions.pageId).as("heads");
  const [termRows, interpreterRows, perspectiveRows] = await Promise.all([
    db.select({ pageId: pages.id, title: pages.title, slug: pages.slug, aliases: terms.aliases })
      .from(terms).innerJoin(pages, eq(pages.id, terms.pageId))
      .where(isPageVisible(pages.id)).orderBy(asc(pages.id)),
    db.select({ pageId: pages.id, title: pages.title, slug: pages.slug })
      .from(interpreters).innerJoin(pages, eq(pages.id, interpreters.pageId))
      .where(isPageVisible(pages.id)).orderBy(asc(pages.id)),
    db.select({ pageId: perspectives.pageId, termId: perspectives.termId, interpreterId: perspectives.interpreterId, headRevisionId: heads.headRevisionId })
      .from(perspectives).innerJoin(heads, eq(heads.pageId, perspectives.pageId))
      .where(isPageVisible(perspectives.pageId)).orderBy(asc(perspectives.pageId)),
  ]);
  return { terms: termRows, interpreters: interpreterRows, perspectives: perspectiveRows };
}
