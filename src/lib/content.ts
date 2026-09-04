// 读路径的数据访问层：词条页 / 视角页 / 诠释者页 的查询都在这里。
// 全部过滤 pages.deleted_at（软删除页面对读路径不可见，ADR-0003 #7）。

import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb } from "@/db";
import { interpreters, links, pages, perspectives, revisions, terms } from "@/db/schema";
import type { PageType } from "@/db/schema";
import { pagePath } from "@/lib/slug";
import type { WikiLinkTarget } from "@/lib/markdown";

/** 在线页面（未软删除）的最小信息。 */
export interface LivePage {
  id: number;
  type: PageType;
  title: string;
  slug: string;
}

export async function getLivePage(id: number): Promise<LivePage | null> {
  const [row] = await getDb()
    .select({ id: pages.id, type: pages.type, title: pages.title, slug: pages.slug })
    .from(pages)
    .where(and(eq(pages.id, id), isNull(pages.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** 首页词条列表（含各词条视角数）。 */
export async function listTerms(): Promise<
  { id: number; title: string; slug: string; summary: string; perspectiveCount: number }[]
> {
  return getDb()
    .select({
      id: pages.id,
      title: pages.title,
      slug: pages.slug,
      summary: terms.summary,
      perspectiveCount: sql<number>`(
        select count(*) from ${perspectives}
        where ${perspectives.termId} = ${pages.id}
      )`.mapWith(Number),
    })
    .from(pages)
    .innerJoin(terms, eq(terms.pageId, pages.id))
    .where(and(eq(pages.type, "term"), isNull(pages.deletedAt)))
    .orderBy(asc(pages.id));
}

/** 词条详情（信息框用）。 */
export async function getTermDetail(id: number) {
  const [row] = await getDb()
    .select({
      id: pages.id,
      title: pages.title,
      slug: pages.slug,
      summary: terms.summary,
      aliases: terms.aliases,
    })
    .from(pages)
    .innerJoin(terms, eq(terms.pageId, pages.id))
    .where(
      and(eq(pages.id, id), eq(pages.type, "term"), isNull(pages.deletedAt)),
    )
    .limit(1);
  return row ?? null;
}

export interface PerspectiveListItem {
  pageId: number;
  title: string;
  slug: string;
  interpreterId: number;
  interpreterName: string;
  interpreterSlug: string;
  isBoard: boolean;
  linkCount: number;
}

/**
 * 词条下的视角列表，排序规则（spec「Implementation Decisions」）：
 * 编委会通俗视角固定第一 → 其余按站内引用数（links 统计）热度 → 并列时按创建序。
 */
export async function listPerspectivesOfTerm(
  termId: number,
): Promise<PerspectiveListItem[]> {
  const db = getDb();
  const interpreterPages = alias(pages, "interpreter_pages");
  const linkCounts = db
    .select({
      targetPageId: links.targetPageId,
      count: sql<number>`count(*)`.mapWith(Number).as("count"),
    })
    .from(links)
    .groupBy(links.targetPageId)
    .as("link_counts");

  return db
    .select({
      pageId: perspectives.pageId,
      title: pages.title,
      slug: pages.slug,
      interpreterId: interpreters.pageId,
      interpreterName: interpreterPages.title,
      interpreterSlug: interpreterPages.slug,
      isBoard: interpreters.isEditorialBoard,
      linkCount: sql<number>`coalesce(${linkCounts.count}, 0)`.mapWith(Number),
    })
    .from(perspectives)
    .innerJoin(pages, eq(pages.id, perspectives.pageId))
    .innerJoin(interpreters, eq(interpreters.pageId, perspectives.interpreterId))
    .innerJoin(interpreterPages, eq(interpreterPages.id, interpreters.pageId))
    .leftJoin(linkCounts, eq(linkCounts.targetPageId, perspectives.pageId))
    .where(
      and(
        eq(perspectives.termId, termId),
        isNull(pages.deletedAt),
        isNull(interpreterPages.deletedAt),
      ),
    )
    .orderBy(
      desc(interpreters.isEditorialBoard),
      desc(sql`coalesce(${linkCounts.count}, 0)`),
      asc(pages.id),
    );
}

/** 页面当前（head）修订的 Markdown 源文本。 */
export async function getHeadContent(pageId: number): Promise<string | null> {
  const [row] = await getDb()
    .select({ content: revisions.content })
    .from(revisions)
    .where(eq(revisions.pageId, pageId))
    .orderBy(desc(revisions.id))
    .limit(1);
  return row?.content ?? null;
}

/** 视角详情：所属词条 + 诠释者（含生卒年）。 */
export async function getPerspectiveDetail(id: number) {
  const termPages = alias(pages, "term_pages");
  const interpreterPages = alias(pages, "interpreter_pages");
  const [row] = await getDb()
    .select({
      id: pages.id,
      title: pages.title,
      slug: pages.slug,
      termId: terms.pageId,
      termTitle: termPages.title,
      termSlug: termPages.slug,
      interpreterId: interpreters.pageId,
      interpreterName: interpreterPages.title,
      interpreterSlug: interpreterPages.slug,
      interpreterBirthYear: interpreters.birthYear,
      interpreterDeathYear: interpreters.deathYear,
      isBoard: interpreters.isEditorialBoard,
    })
    .from(perspectives)
    .innerJoin(pages, eq(pages.id, perspectives.pageId))
    .innerJoin(terms, eq(terms.pageId, perspectives.termId))
    .innerJoin(termPages, eq(termPages.id, terms.pageId))
    .innerJoin(interpreters, eq(interpreters.pageId, perspectives.interpreterId))
    .innerJoin(interpreterPages, eq(interpreterPages.id, interpreters.pageId))
    .where(
      and(
        eq(perspectives.pageId, id),
        isNull(pages.deletedAt),
        isNull(termPages.deletedAt),
        isNull(interpreterPages.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** 诠释者详情（信息框用）。 */
export async function getInterpreterDetail(id: number) {
  const [row] = await getDb()
    .select({
      id: pages.id,
      title: pages.title,
      slug: pages.slug,
      summary: interpreters.summary,
      birthYear: interpreters.birthYear,
      deathYear: interpreters.deathYear,
      isBoard: interpreters.isEditorialBoard,
    })
    .from(pages)
    .innerJoin(interpreters, eq(interpreters.pageId, pages.id))
    .where(
      and(
        eq(pages.id, id),
        eq(pages.type, "interpreter"),
        isNull(pages.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** 诠释者的全部视角索引。 */
export async function listPerspectivesOfInterpreter(
  interpreterId: number,
): Promise<
  { pageId: number; title: string; slug: string; termId: number; termTitle: string; termSlug: string }[]
> {
  const termPages = alias(pages, "term_pages");
  return getDb()
    .select({
      pageId: perspectives.pageId,
      title: pages.title,
      slug: pages.slug,
      termId: terms.pageId,
      termTitle: termPages.title,
      termSlug: termPages.slug,
    })
    .from(perspectives)
    .innerJoin(pages, eq(pages.id, perspectives.pageId))
    .innerJoin(terms, eq(terms.pageId, perspectives.termId))
    .innerJoin(termPages, eq(termPages.id, terms.pageId))
    .where(
      and(
        eq(perspectives.interpreterId, interpreterId),
        isNull(pages.deletedAt),
        isNull(termPages.deletedAt),
      ),
    )
    .orderBy(asc(pages.id));
}

/**
 * 页面双链的解析结果（受理时落库的即真相，ADR-0003 #4）：
 * links 行 join 目标页 → 名称 → 站内路径 / 红链。
 * 目标页软删除后视同红链（读路径不应导向 404）。
 */
export async function getWikiLinkTargets(
  pageId: number,
): Promise<Map<string, WikiLinkTarget>> {
  const rows = await getDb()
    .select({
      name: links.targetName,
      targetId: pages.id,
      type: pages.type,
      slug: pages.slug,
      deletedAt: pages.deletedAt,
    })
    .from(links)
    .leftJoin(pages, eq(pages.id, links.targetPageId))
    .where(eq(links.sourcePageId, pageId));

  return new Map(
    rows.map((row) => {
      const exists = row.targetId !== null && row.deletedAt === null;
      return [
        row.name,
        exists
          ? { href: pagePath(row.type!, row.slug!, row.targetId!), exists: true }
          : { href: "", exists: false },
      ];
    }),
  );
}
