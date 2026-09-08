// T16 验收：公开读查询验证三领域演示网络与首页发现内容。
import { beforeAll, expect, it } from "vitest";

import { seedDatabase } from "@/db/seed";
import { getCategoryDetailBySlug, getHeadContent, listCategoryRows, listPerspectivesOfTerm, listRecentPerspectives, listTerms } from "@/lib/content";
import { getSiteGraph } from "@/lib/graph";
import { listHomeRecommendations } from "@/lib/recommend";

beforeAll(async () => { await seedDatabase(); });

it("演示种子覆盖哲学、政治经济学、历史：≥20 词条、≥60 视角，三领域双链成网", async () => {
  const terms = await listTerms();
  expect(terms.length).toBeGreaterThanOrEqual(20);
  expect(terms.reduce((sum, term) => sum + term.perspectiveCount, 0)).toBeGreaterThanOrEqual(60);
  expect(terms.filter((term) => term.perspectiveCount >= 3).length).toBeGreaterThanOrEqual(20);
  const categories = await listCategoryRows();
  const graph = await getSiteGraph();
  const neighbors = new Map(graph.nodes.map((node) => [node.id, new Set<number>()]));
  for (const edge of graph.edges) {
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
  }
  const visited = new Set<number>();
  const queue = [terms.find((term) => term.title === "主体性")!.id];
  for (const id of queue) {
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(...neighbors.get(id)!);
  }
  expect(visited.size).toBe(terms.length);
  for (const name of ["哲学", "政治经济学", "历史"]) {
    const category = categories.find((item) => item.name === name)!;
    expect(category).toBeDefined();
    const domainTerms = (await getCategoryDetailBySlug(category.slug))!.terms;
    expect(domainTerms.length).toBeGreaterThanOrEqual(3);
    for (const term of domainTerms.slice(0, 3)) {
      expect(visited.has(term.id)).toBe(true);
      const perspectives = await listPerspectivesOfTerm(term.id);
      expect(perspectives.length).toBeGreaterThanOrEqual(1);
      for (const perspective of perspectives) {
        expect(await getHeadContent(perspective.pageId)).toContain("[[");
      }
    }
  }
});

it("首页主题兴趣推荐匹配领域，空兴趣返回空列表，新视角可读取", async () => {
  expect(await listHomeRecommendations({ interpreters: [], schools: [], categories: [] })).toEqual([]);
  const categories = await listCategoryRows();
  const history = categories.find((category) => category.name === "历史")!;
  const historyTerms = (await getCategoryDetailBySlug(history.slug))!.terms;
  const recommendations = await listHomeRecommendations({ interpreters: [], schools: [], categories: [history.id] });
  expect(recommendations).toHaveLength(6);
  for (const term of recommendations) {
    expect(historyTerms.map((item) => item.id)).toContain(term.id);
    expect(term.interestMatchCount).toBeGreaterThan(0);
  }
  const recent = await listRecentPerspectives();
  expect(recent).toHaveLength(6);
  for (const perspective of recent) expect(await getHeadContent(perspective.id)).toBeTruthy();
});
