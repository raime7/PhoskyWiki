import "server-only";

import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { pages, revisions } from "@/db/schema";
import { applyContentChange, lockLivePage, ReviewError, type Actor } from "@/lib/review";
import { diffLines } from "@/lib/diff";
import { rebuildPageLinks } from "@/lib/page-links";
import { getLivePage } from "@/lib/content";

export function historyId(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new ReviewError(400, "页面和修订 id 必须为正整数");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) {
    throw new ReviewError(400, "页面和修订 id 必须为正整数");
  }
  return id;
}

/** 删除页的历史只对管理员开放；在读取任何快照前校验页面可见性。 */
export async function getPageHistory(pageId: number, isAdmin = false) {
  const db = getDb();
  const [page] = await db.select({
    id: pages.id, type: pages.type, title: pages.title, slug: pages.slug, deletedAt: pages.deletedAt,
  }).from(pages).where(and(eq(pages.id, pageId), isAdmin ? undefined : isNull(pages.deletedAt)));
  if (!page) throw new ReviewError(404, "页面不存在");
  if (!isAdmin && !(await getLivePage(pageId))) throw new ReviewError(404, "页面不存在");
  const history = await db.select().from(revisions).where(eq(revisions.pageId, pageId))
    .orderBy(desc(revisions.createdAt), desc(revisions.id));
  return { page, revisions: history };
}

export function compareRevisions(history: Awaited<ReturnType<typeof getPageHistory>>, fromId: number, toId: number) {
  const from = history.revisions.find((revision) => revision.id === fromId);
  const to = history.revisions.find((revision) => revision.id === toId);
  if (!from || !to) throw new ReviewError(404, "修订不存在或不属于此页面");
  return { from, to, rows: diffLines(from.content, to.content) };
}

export async function rollbackPage(pageId: number, revisionId: number, actor: Actor) {
  if (actor.role !== "admin") throw new ReviewError(403, "需要管理员角色");
  return getDb().transaction(async (tx) => {
    await lockLivePage(tx, pageId);
    const [target] = await tx.select().from(revisions)
      .where(and(eq(revisions.pageId, pageId), eq(revisions.id, revisionId)));
    if (!target) throw new ReviewError(404, "修订不存在或不属于此页面");
    const id = await applyContentChange(tx, pageId, target.content, target.id);
    return { revisionId: id };
  });
}

/** 只改可见性，不改变 head 或任何既有修订；所有页面类型共用。 */
export async function setPageDeleted(pageId: number, deleted: boolean, actor: Actor) {
  if (actor.role !== "admin") throw new ReviewError(403, "需要管理员角色");
  return getDb().transaction(async (tx) => {
    const [page] = await tx.select().from(pages).where(eq(pages.id, pageId)).for("update");
    if (!page) throw new ReviewError(404, "页面不存在");
    if (Boolean(page.deletedAt) === deleted) return { deleted };
    await tx.update(pages).set({ deletedAt: deleted ? new Date() : null, updatedAt: new Date() })
      .where(eq(pages.id, pageId));
    const [head] = await tx.select({ content: revisions.content }).from(revisions)
      .where(eq(revisions.pageId, pageId)).orderBy(desc(revisions.id)).limit(1);
    // 删除时移除出链，恢复时从保留的 head 重建；入链保留 id，读路径据 deletedAt 显示红链。
    await rebuildPageLinks(tx, pageId, deleted ? "" : head?.content ?? "");
    // 搜索索引同步同受理管线，随 T10 的 SearchIndex 接口接入。
    return { deleted };
  });
}

export async function listDeletedPages(actor: Actor) {
  if (actor.role !== "admin") throw new ReviewError(403, "需要管理员角色");
  return getDb().select({ id: pages.id, title: pages.title, type: pages.type, deletedAt: pages.deletedAt })
    .from(pages).where(isNotNull(pages.deletedAt)).orderBy(desc(pages.deletedAt), desc(pages.id));
}
