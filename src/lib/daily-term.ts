import "server-only";

import { listPerspectivesOfTerm, listTerms } from "@/lib/content";
import { pagePath } from "@/lib/slug";

const DAY_MS = 86_400_000;

/**
 * 首页"今日词条"：按 UTC 日期在候选里轮换，同一天所有人看到同一个。
 * 不做人工精选，保持 ADR-0007 的中立；候选顺序由调用方给定。
 */
export function pickDailyTerm<T>(candidates: readonly T[], date: Date): T | null {
  if (candidates.length === 0) return null;
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS);
  return candidates[day % candidates.length]!;
}

/** 只在有 2 个以上可见视角的词条中选；没有候选时返回 null，首屏只剩排印。 */
export async function getDailyTerm(date = new Date()) {
  const term = pickDailyTerm((await listTerms()).filter(item => item.perspectiveCount >= 2), date);
  if (!term) return null;
  const perspectives = await listPerspectivesOfTerm(term.id);
  return {
    title: term.title,
    href: pagePath("term", term.slug, term.id),
    perspectives: perspectives.map(p => ({
      id: p.pageId,
      title: p.title,
      interpreterName: p.interpreterName,
      href: pagePath("perspective", p.slug, p.pageId),
    })),
  };
}

export type DailyTerm = NonNullable<Awaited<ReturnType<typeof getDailyTerm>>>;
