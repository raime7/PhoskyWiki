// 视角置顶（编者置顶，T04）：管理员把某视角标记为置顶/取消置顶。
// 置顶是页面元数据操作，不产生修订（内容写路径随 T06 的提交/受理落地）；
// 排序效果见 listPerspectivesOfTerm：通俗 → 置顶 → 热度。

import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import { pages, perspectives } from "@/db/schema";

/**
 * 置顶/取消置顶一个视角页。返回 false = 页面不存在、已软删除或不是视角页。
 * 幂等：重复置顶刷新 pinnedAt，取消未置顶视角无效果。
 */
export async function setPerspectivePinned(
  pageId: number,
  pinned: boolean,
): Promise<boolean> {
  const db = getDb();
  const [page] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(
      and(
        eq(pages.id, pageId),
        eq(pages.type, "perspective"),
        isNull(pages.deletedAt),
      ),
    )
    .limit(1);
  if (!page) return false;

  await db
    .update(perspectives)
    .set({ pinnedAt: pinned ? new Date() : null })
    .where(eq(perspectives.pageId, pageId));
  return true;
}
