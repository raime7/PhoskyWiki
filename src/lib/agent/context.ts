import "server-only";

import { getHeadContent, getTermDetail, getWikiLinkTargets, listPerspectivesOfTerm } from "@/lib/content";
import { getOneHopTermIds } from "@/lib/graph";
import { renderMarkdownText, wikiLinkResolver } from "@/lib/markdown";
import { pagePath } from "@/lib/slug";
import type { AgentContext, AgentSource } from "./types";

/** 只读已发布内容，复用公开读路径的软删除规则。 */
export async function getAgentContext(termId: number): Promise<AgentContext | null> {
  if (!(await getTermDetail(termId))) return null;
  const sources: AgentSource[] = [];
  // 按词条分批，避免邻居多时同时占满数据库连接池。
  for (const id of await getOneHopTermIds(termId)) {
    const term = await getTermDetail(id);
    if (!term) continue;
    sources.push({ id, termId: id, type: "term", title: term.title,
      url: pagePath("term", term.slug, id), text: term.summary });
    for (const perspective of await listPerspectivesOfTerm(id)) {
      const [content, targets] = await Promise.all([
        getHeadContent(perspective.pageId), getWikiLinkTargets(perspective.pageId),
      ]);
      if (content === null) continue;
      sources.push({ id: perspective.pageId, termId: id, type: "perspective",
        title: perspective.title, url: pagePath("perspective", perspective.slug, perspective.pageId),
        text: renderMarkdownText(content, wikiLinkResolver(targets)) });
    }
  }
  return { termId, sources };
}
