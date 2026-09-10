// SearchIndex 的注册表：主缝测试注入 fake；MEILI_HOST 已配置时用真 Meili；
// 都没有则降级为 null 实现——搜索返回空、写路径不受影响。CI 的 e2e 任务与
// 未起 compose 的本地环境都靠这条降级路径（ADR-0002：索引是可丢派生数据）。

import "server-only";

import { meiliSearchIndex } from "@/lib/search/meili-index";
import type { SearchIndex } from "@/lib/search/search-types";

let injected: SearchIndex | null = null;
let meili: SearchIndex | null = null;
let warned = false;

/** 主缝测试注入替身；用完（afterEach）必须 resetSearchIndex 归还默认实现。 */
export function injectSearchIndex(index: SearchIndex): void {
  injected = index;
}

export function resetSearchIndex(): void {
  injected = null;
}

/** 搜索实现的故障在路由层统一转 503：如实报错，不拖垮站点其余部分。 */
export function searchErrorResponse(scope: string, _err: unknown): Response {
  void _err; // Adapter exceptions may contain credentials or document content.
  console.error(`${scope}：SEARCH_UNAVAILABLE`);
  return Response.json({ error: "搜索服务暂时不可用" }, { status: 503 });
}

export function searchIsConfigured(): boolean {
  return !!injected || !!process.env.MEILI_HOST;
}

export function getSearchIndex(): SearchIndex {
  if (injected) return injected;
  const host = process.env.MEILI_HOST;
  if (host) {
    meili ??= meiliSearchIndex({ host, apiKey: process.env.MEILI_MASTER_KEY, indexUid: process.env.MEILI_INDEX_UID || undefined });
    return meili;
  }
  if (!warned && process.env.NODE_ENV === "production") {
    warned = true;
    console.warn("MEILI_HOST 未配置：全站搜索降级为空实现（派生索引可由全量校对重建，见 ADR-0002）");
  }
  return nullSearchIndex;
}

const nullSearchIndex: SearchIndex = {
  async upsert() {},
  async remove() {},
  async search() {
    return { hits: [], total: 0, facets: {} };
  },
  async suggest() {
    return [];
  },
  async replaceAll() {},
};
