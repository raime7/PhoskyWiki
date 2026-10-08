import "server-only";

import { getHeadContent } from "@/lib/content";

const SENTENCE_ENDS = ["。", "！", "？", "；"];

/**
 * 视角正文第一段的纯文本摘录（词条枢纽页并置列用，ADR-0008）。
 * 跳过标题、引文、列表、表格、图片、代码与 HTML 块，只取首个正文段；
 * 超出上限时退到最后一个句末标点，句子太长才退到逗号并补省略号，不在句中截断。
 */
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
  const end = Math.max(...SENTENCE_ENDS.map(mark => cut.lastIndexOf(mark)));
  if (end > limit * 0.4) return cut.slice(0, end + 1);
  const comma = cut.lastIndexOf("，");
  return `${comma > 0 ? cut.slice(0, comma) : cut}……`;
}

/** 按页 id 取各视角当前修订的首段摘录。 */
export async function listPerspectiveExcerpts(pageIds: number[]): Promise<Record<number, string>> {
  const entries = await Promise.all(pageIds.map(async id => [id, firstParagraphExcerpt(await getHeadContent(id))] as const));
  return Object.fromEntries(entries);
}
