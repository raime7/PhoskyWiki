// 相关词条推荐（T12）：词条页「相关词条」区块的数据层。
// 基础分 = 共同引用强度——links 聚合出的当前词条 1 跳邻居无向边权（复用
// 词条页已取的局部图谱 getLocalGraph，不重复聚合查询）；
// 兴趣分 = 在线兴趣诠释者在该邻居词条的视角数 + 兴趣分类命中数。
// 设了兴趣的用户按「兴趣分优先，其次共同引用」的顺序看到推荐；游客纯共同引用。

import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb } from "@/db";
import { interpreters, pages, perspectives, termCategories } from "@/db/schema";
import { listTerms } from "@/lib/content";
import { expandInterestedInterpreters } from "@/lib/interests";
import type { LocalGraphData } from "@/lib/graph-types";
import { hasAnyInterest, type InterestSet } from "@/lib/interest-tags";

export interface RelatedTerm {
  id: number;
  title: string;
  /** 词条枢纽页路径 */
  href: string;
  /** 共同引用强度（links 无向边权：两个词条互相指向的双链总数） */
  commonRefCount: number;
  /** 兴趣匹配数：兴趣诠释者在该词条的视角数 + 兴趣分类命中数；无兴趣恒 0 */
  interestMatchCount: number;
}

const DEFAULT_LIMIT = 5;

/**
 * 从局部图谱（1 跳）提取相关词条。interests 为 null（游客）或空集时
 * 纯按共同引用排序；感兴趣的内容由调用方先经 expandInterestedInterpreters 展开
 * （词条页为视角重排已经展开过，这里复用同一份，不重复查询）。
 */
export async function listRelatedTerms(
  graph: LocalGraphData,
  interests: InterestSet | null,
  interestedInterpreterIds: ReadonlySet<number>,
  limit: number = DEFAULT_LIMIT,
): Promise<RelatedTerm[]> {
  // 1 跳邻居 + 共同引用权重（边已排除自环，root 不会出现在邻居位）
  const weightByNeighbor = new Map<number, number>();
  for (const edge of graph.edges) {
    if (edge.source === graph.rootId) {
      weightByNeighbor.set(edge.target, edge.weight);
    } else if (edge.target === graph.rootId) {
      weightByNeighbor.set(edge.source, edge.weight);
    }
  }
  if (weightByNeighbor.size === 0) return [];

  const neighborIds = [...weightByNeighbor.keys()];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  const matches = await countInterestMatches(neighborIds, interests, interestedInterpreterIds);

  return neighborIds
    .flatMap((id) => {
      const node = nodesById.get(id);
      if (!node) return [];
      return [
        {
          id,
          title: node.title,
          href: node.url,
          commonRefCount: weightByNeighbor.get(id)!,
          interestMatchCount:
            matches.get(id) ?? 0,
        },
      ];
    })
    .sort(
      (a, b) =>
        b.interestMatchCount - a.interestMatchCount ||
        b.commonRefCount - a.commonRefCount ||
        a.id - b.id,
    )
    .slice(0, limit);
}

/** 首页和相关词条共用兴趣计分；候选词条由各入口先过滤为在线页面。 */
async function countInterestMatches(
  termIds: number[],
  interests: InterestSet | null,
  interestedInterpreterIds: ReadonlySet<number>,
): Promise<Map<number, number>> {
  if (termIds.length === 0) return new Map();
  const interpreterMatch = new Map<number, number>();
  const categoryMatch = new Map<number, number>();
  const personalized = interests !== null && hasAnyInterest(interests);
  if (personalized) {
    // 可见性口径与视角列表一致：视角页与诠释者页软删除的不计
    const interpreterIds = [...interestedInterpreterIds];
    if (interests.categories.length > 0) {
      const rows = await getDb()
        .select({ termId: termCategories.termId, count: sql<number>`count(*)`.mapWith(Number) })
        .from(termCategories)
        .where(
          and(
            inArray(termCategories.termId, termIds),
            inArray(termCategories.categoryId, interests.categories),
          ),
        )
        .groupBy(termCategories.termId);
      for (const row of rows) categoryMatch.set(row.termId, row.count);
    }
    if (interpreterIds.length > 0) {
      const perspectivePages = alias(pages, "related_perspective_pages");
      const interpreterPages = alias(pages, "related_interpreter_pages");
      const rows = await getDb()
        .select({ termId: perspectives.termId, count: sql<number>`count(*)`.mapWith(Number) })
        .from(perspectives)
        .innerJoin(perspectivePages, eq(perspectivePages.id, perspectives.pageId))
        .innerJoin(interpreters, eq(interpreters.pageId, perspectives.interpreterId))
        .innerJoin(interpreterPages, eq(interpreterPages.id, interpreters.pageId))
        .where(
          and(
            inArray(perspectives.termId, termIds),
            inArray(perspectives.interpreterId, interpreterIds),
            isNull(perspectivePages.deletedAt),
            isNull(interpreterPages.deletedAt),
          ),
        )
        .groupBy(perspectives.termId);
      for (const row of rows) interpreterMatch.set(row.termId, row.count);
    }
  }

  return new Map(termIds.map((id) => [id, (interpreterMatch.get(id) ?? 0) + (categoryMatch.get(id) ?? 0)]));
}

/** 首页只展示命中账号兴趣的在线词条；没有命中时由 UI 引导调整兴趣。 */
export async function listHomeRecommendations(interests: InterestSet, limit = 6) {
  if (!hasAnyInterest(interests)) return [];
  const [candidates, interpreterIds] = await Promise.all([
    listTerms(), expandInterestedInterpreters(interests),
  ]);
  const matches = await countInterestMatches(candidates.map((term) => term.id), interests, interpreterIds);
  return candidates
    .map((term) => ({ ...term, interestMatchCount: matches.get(term.id) ?? 0 }))
    .filter((term) => term.interestMatchCount > 0)
    .sort((a, b) => b.interestMatchCount - a.interestMatchCount || a.id - b.id)
    .slice(0, limit);
}
