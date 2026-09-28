// PROTOTYPE（一次性代码）：首页"今日词条"构成与枢纽页并置列所需的数据。
import "server-only";

import { getHeadContent, listPerspectivesOfTerm, listTerms } from "@/lib/content";
import { pagePath } from "@/lib/slug";

/** 视角正文第一段的纯文本摘要：只取首段，不在句中截断。 */
export function firstParagraphExcerpt(markdown: string | null, limit = 200): string {
  if (!markdown) return "";
  const block = markdown
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .find(part => part && !/^(#|>|[-*+] |\d+\. |\||!\[|```|<)/.test(part));
  if (!block) return "";
  const text = block
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const end = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"), cut.lastIndexOf("；"));
  return end > limit * 0.4 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf("，") > 0 ? cut.lastIndexOf("，") : limit)}……`;
}

export async function excerptsFor(pageIds: number[]) {
  const entries = await Promise.all(pageIds.map(async id => [id, firstParagraphExcerpt(await getHeadContent(id))] as const));
  return new Map(entries);
}

/** 按日期轮换：只在有 2 个以上可见视角的词条中选；同一天所有人看到同一个。 */
export async function getDailyTerm(date = new Date()) {
  const candidates = (await listTerms()).filter(term => term.perspectiveCount >= 2);
  if (candidates.length === 0) return null;
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
  const term = candidates[day % candidates.length]!;
  const perspectives = await listPerspectivesOfTerm(term.id);
  return {
    title: term.title,
    summary: term.summary,
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
