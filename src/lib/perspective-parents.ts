import "server-only";

import { asc, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { pages } from "@/db/schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * 与软删除共用 pages 行锁，依赖按 id 升序锁定，锁一直持有到提交/发布事务结束。
 * 删除只锁单页且不锁提交；审核先锁提交再锁父页，不存在反向等待。
 */
export async function lockPerspectiveParents(tx: Tx, termId: number, interpreterId: number) {
  const parents = await tx.select().from(pages)
    .where(inArray(pages.id, [termId, interpreterId]))
    .orderBy(asc(pages.id)).for("update");
  const term = parents.find((page) => page.id === termId && page.type === "term");
  const interpreter = parents.find((page) => page.id === interpreterId && page.type === "interpreter");
  const reasons: string[] = [];
  if (!term) reasons.push(`词条 #${termId} 不存在`);
  else if (term.deletedAt) reasons.push(`词条「${term.title}」已删除`);
  if (!interpreter) reasons.push(`诠释者 #${interpreterId} 不存在`);
  else if (interpreter.deletedAt) reasons.push(`诠释者「${interpreter.title}」已删除`);
  if (reasons.length || !term || !interpreter) {
    return { available: false as const, reason: `${reasons.join("；")}。请等待父页面恢复或调整目标后重新提交。` };
  }
  return { available: true as const, term, interpreter };
}
