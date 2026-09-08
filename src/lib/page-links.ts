// 页面双链的落库（写路径，ADR-0003 #4：解析发生在保存时）。
// 「产生修订 → 重建 links → 同步索引」是生效管线（ADR-0004 #8/#9）：
// 受理、管理员直编与回滚走这条路；软删除/恢复保留关系，由公开读取过滤。

import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Db } from "@/db";
import { links, pages, perspectives } from "@/db/schema";
import { parseWikiLinks, wikiLinkKey, type ParsedWikiLink } from "@/lib/wiki-links";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * 重建一页的全部双链：先清旧链，再按新正文解析落库——
 * 默认链接落词条枢纽（无同名词条时落消歧义页），
 * 显式视角链接按「词条 × 诠释者」定位视角页；未命中留名称快照即红链。
 */
export async function rebuildPageLinks(
  tx: Tx,
  pageId: number,
  content: string,
): Promise<void> {
  const refs = parseWikiLinks(content);
  await tx.delete(links).where(eq(links.sourcePageId, pageId));
  if (refs.length === 0) return;

  const targetIds = await Promise.all(refs.map((ref) => resolveLinkTarget(tx, ref)));
  await tx.insert(links).values(
    refs.map((ref, index) => ({
      sourcePageId: pageId,
      targetPageId: targetIds[index],
      targetName: wikiLinkKey(ref),
    })),
  );
}

async function resolveLinkTarget(
  tx: Tx,
  ref: ParsedWikiLink,
): Promise<number | null> {
  if (ref.interpreter === null) {
    // 精确同名词条优先（主词条），否则消歧义页（同名多义的分流入口）
    const [row] = await tx
      .select({ id: pages.id })
      .from(pages)
      .where(
        and(
          eq(pages.title, ref.term),
          isNull(pages.deletedAt),
          inArray(pages.type, ["term", "disambiguation"]),
        ),
      )
      .orderBy(desc(sql`${pages.type} = 'term'`))
      .limit(1);
    return row?.id ?? null;
  }

  const termPage = alias(pages, "link_term_page");
  const interpreterPage = alias(pages, "link_interpreter_page");
  const perspectivePage = alias(pages, "link_perspective_page");
  const [row] = await tx
    .select({ id: perspectives.pageId })
    .from(perspectives)
    .innerJoin(termPage, eq(termPage.id, perspectives.termId))
    .innerJoin(interpreterPage, eq(interpreterPage.id, perspectives.interpreterId))
    .innerJoin(perspectivePage, eq(perspectivePage.id, perspectives.pageId))
    .where(
      and(
        eq(termPage.title, ref.term),
        eq(interpreterPage.title, ref.interpreter),
        isNull(termPage.deletedAt),
        isNull(interpreterPage.deletedAt),
        isNull(perspectivePage.deletedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}
