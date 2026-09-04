// 读路径的数据访问层：词条页 / 视角页 / 诠释者页 / 消歧义页 的查询都在这里。
// 全部过滤 pages.deleted_at（软删除页面对读路径不可见，ADR-0003 #7）。

import "server-only";

import { and, asc, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb } from "@/db";
import { interpreters, links, pages, perspectives, revisions, terms } from "@/db/schema";
import type { PageType } from "@/db/schema";
import { baseTermTitle, pagePath } from "@/lib/slug";
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
  /** 编者置顶（管理员标记，T04）：置顶视角紧随通俗视角之后 */
  pinned: boolean;
  linkCount: number;
}

/**
 * 词条下的视角列表，默认排序（spec「Implementation Decisions」）：
 * 编委会通俗视角固定第一 → 编者置顶 → 站内引用数（links 统计）热度 → 并列时按创建序。
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

  const rows = await db
    .select({
      pageId: perspectives.pageId,
      title: pages.title,
      slug: pages.slug,
      interpreterId: interpreters.pageId,
      interpreterName: interpreterPages.title,
      interpreterSlug: interpreterPages.slug,
      isBoard: interpreters.isEditorialBoard,
      pinnedAt: perspectives.pinnedAt,
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
      desc(sql`${perspectives.pinnedAt} is not null`),
      desc(sql`coalesce(${linkCounts.count}, 0)`),
      asc(pages.id),
    );

  return rows.map(({ pinnedAt, ...row }) => ({ ...row, pinned: pinnedAt !== null }));
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
 * 键为 wikiLinkKey 的规范形态：默认链接 = 词条名；显式视角链接 = 词条@诠释者。
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

export interface BacklinkItem {
  /** 引用方视角页 */
  pageId: number;
  title: string;
  slug: string;
  /** 引用方视角所属词条（上下文提示用） */
  termId: number;
  termTitle: string;
  termSlug: string;
}

/**
 * 反链面板数据（ADR-0003 数据模型注记）：直接查 links（target = 本页），
 * 引用方即视角页（双链只出现在视角正文里）；软删除的引用方与其词条不展示。
 */
export async function listBacklinks(targetPageId: number): Promise<BacklinkItem[]> {
  const sourcePages = alias(pages, "source_pages");
  const termPages = alias(pages, "term_pages");
  return getDb()
    .selectDistinct({
      pageId: sourcePages.id,
      title: sourcePages.title,
      slug: sourcePages.slug,
      termId: terms.pageId,
      termTitle: termPages.title,
      termSlug: termPages.slug,
    })
    .from(links)
    .innerJoin(sourcePages, eq(sourcePages.id, links.sourcePageId))
    .innerJoin(perspectives, eq(perspectives.pageId, links.sourcePageId))
    .innerJoin(terms, eq(terms.pageId, perspectives.termId))
    .innerJoin(termPages, eq(termPages.id, terms.pageId))
    .where(
      and(
        eq(links.targetPageId, targetPageId),
        isNull(sourcePages.deletedAt),
        isNull(termPages.deletedAt),
      ),
    )
    .orderBy(asc(sourcePages.id));
}

export interface DisambiguationMember {
  id: number;
  title: string;
  slug: string;
  summary: string;
  perspectiveCount: number;
}

/** LIKE 转义：基准名里的 %/_/\ 不参与模式匹配。 */
function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * 消歧义页成员（ADR-0003 #5）：标题等于基准名、或以「基准名（…）」括号限定的
 * 全部在线词条。成员由命名约定派生，新增同名词目自动进入分流列表。
 */
async function listDisambiguationMembers(base: string): Promise<DisambiguationMember[]> {
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
    .where(
      and(
        eq(pages.type, "term"),
        isNull(pages.deletedAt),
        or(
          eq(pages.title, base),
          like(pages.title, `${escapeLike(base)}\uFF08%\uFF09`),
        ),
      ),
    )
    .orderBy(asc(pages.title));
}

/** 消歧义页详情：成员列表派生自标题命名约定（ADR-0003 #6，不单独建模）。 */
export async function getDisambiguationDetail(id: number) {
  const [page] = await getDb()
    .select({ id: pages.id, title: pages.title, slug: pages.slug })
    .from(pages)
    .where(
      and(
        eq(pages.id, id),
        eq(pages.type, "disambiguation"),
        isNull(pages.deletedAt),
      ),
    )
    .limit(1);
  if (!page) return null;
  return { ...page, members: await listDisambiguationMembers(page.title) };
}

/**
 * 词条所属的消歧义页（词条页顶部提示用）：标题剥掉结尾的括号限定段后，
 * 若存在以基准名为标题的在线消歧义页则返回之；无限定段的词条返回 null。
 */
export async function getTermDisambiguation(termTitle: string) {
  const base = baseTermTitle(termTitle);
  if (base === termTitle.trim()) return null;
  const [row] = await getDb()
    .select({ id: pages.id, title: pages.title, slug: pages.slug })
    .from(pages)
    .where(
      and(
        eq(pages.type, "disambiguation"),
        eq(pages.title, base),
        isNull(pages.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}
