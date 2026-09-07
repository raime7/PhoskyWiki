// SearchIndex 端口的 Meilisearch 实现（ADR-0002）。单索引 pages、主键 pageId；
// 可检索 title 优先于 body，filterable type。所有写操作等任务完成（Meili 任务异步），
// 保证读己之写；失败向上抛——由调用方决定降级（生效管线的 flush 捕获，搜索路由转 503）。

import "server-only";

import { Meilisearch } from "meilisearch";

import type {
  SearchDocument,
  SearchFacets,
  SearchHit,
  SearchIndex,
  SearchQueryOptions,
  SearchResultPage,
} from "@/lib/search/search-types";
import { highlightHtml } from "@/lib/search/search-types";

export const SEARCH_INDEX_UID = "pages";

interface MeiliHit {
  pageId: number | string;
  type: string;
  title: string;
  slug: string;
  body?: string;
  _formatted?: { title?: string; body?: string } | null;
}

/** 片段上限（字符）：超长时在首个命中处取窗口，与 Meili 的 crop 互补。 */
const SNIPPET_MAX_LENGTH = 160;

export interface MeiliIndexOptions {
  host: string;
  apiKey?: string;
  /** 索引名；契约测试用专用 uid，避免污染开发索引 */
  indexUid?: string;
}

export function meiliSearchIndex(options: MeiliIndexOptions): SearchIndex {
  const client = new Meilisearch({ host: options.host, apiKey: options.apiKey });
  const uid = options.indexUid ?? SEARCH_INDEX_UID;
  const index = client.index(uid);
  // 建索引 + 刷设置，进程内一次；失败清缓存允许下次重试（Meili 短暂不可用）
  let ready: Promise<void> | null = null;
  function ensureIndex(): Promise<void> {
    ready ??= (async () => {
      try {
        await client.getIndex(uid);
      } catch {
        await client.createIndex(uid, { primaryKey: "pageId" }).waitTask();
      }
      await index
        .updateSettings({
          searchableAttributes: ["title", "body"],
          filterableAttributes: ["type"],
        })
        .waitTask();
    })().catch((err: unknown) => {
      ready = null;
      throw err;
    });
    return ready;
  }

  function toHit(hit: MeiliHit): SearchHit {
    let snippet = hit._formatted?.body ?? hit.body ?? "";
    if (snippet.length > SNIPPET_MAX_LENGTH) {
      const at = snippet.indexOf("<mark>");
      const start = at >= 0 ? Math.max(0, at - 60) : 0;
      snippet = `${start > 0 ? "…" : ""}${snippet.slice(start, start + SNIPPET_MAX_LENGTH)}…`;
    }
    return {
      pageId: Number(hit.pageId),
      type: hit.type as SearchHit["type"],
      // 标题保持纯文本（联想下拉等处直接展示）；高亮只进 snippet
      title: hit.title,
      slug: hit.slug,
      snippet: highlightHtml(snippet),
    };
  }

  return {
    async upsert(docs: SearchDocument[]): Promise<void> {
      if (docs.length === 0) return;
      await ensureIndex();
      await index.updateDocuments(docs, { primaryKey: "pageId" }).waitTask();
    },

    async remove(pageIds: number[]): Promise<void> {
      if (pageIds.length === 0) return;
      await ensureIndex();
      await index.deleteDocuments(pageIds).waitTask();
    },

    async search(query: string, searchOptions: SearchQueryOptions = {}): Promise<SearchResultPage> {
      await ensureIndex();
      const type = searchOptions.type ?? null;
      const base = {
        limit: searchOptions.limit ?? 20,
        offset: searchOptions.offset ?? 0,
        facets: ["type"],
        filter: type ? `type = ${type}` : undefined,
        attributesToHighlight: ["title", "body"],
        highlightPreTag: "<mark>",
        highlightPostTag: "</mark>",
      };
      const response = await index.search<MeiliHit>(query, base);
      let facets: SearchFacets = asFacets(response.facetDistribution);
      if (type) {
        // 端口契约：分面计数不受 type 过滤约束——补一次只取分面的无过滤查询
        const facetOnly = await index.search<MeiliHit>(query, { limit: 0, facets: ["type"] });
        facets = asFacets(facetOnly.facetDistribution);
      }
      return {
        hits: response.hits.map(toHit),
        total: response.estimatedTotalHits,
        facets,
      };
    },

    async suggest(query: string, limit: number): Promise<SearchHit[]> {
      if (!query.trim()) return [];
      await ensureIndex();
      // Meili 对最后一个词做前缀匹配，天然支撑即打即搜；联想不带正文片段
      const response = await index.search<MeiliHit>(query, {
        limit,
        attributesToRetrieve: ["pageId", "type", "title", "slug"],
      });
      return response.hits.map((hit) => ({
        pageId: Number(hit.pageId),
        type: hit.type as SearchHit["type"],
        title: hit.title,
        slug: hit.slug,
        snippet: "",
      }));
    },

    async replaceAll(docs: SearchDocument[]): Promise<void> {
      await ensureIndex();
      await index.deleteAllDocuments().waitTask();
      if (docs.length > 0) {
        await index.addDocuments(docs, { primaryKey: "pageId" }).waitTask();
      }
    },
  };
}

function asFacets(distribution: Record<string, Record<string, number>> | undefined): SearchFacets {
  const counts = distribution?.type ?? {};
  const facets: SearchFacets = {};
  for (const [type, count] of Object.entries(counts)) {
    facets[type as SearchHit["type"]] = count;
  }
  return facets;
}
