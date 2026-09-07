// SearchIndex 的内存实现（主缝替身，spec Testing Decisions：主缝测试全部用 fake）。
// 匹配 = 大小写无关的 contains，标题命中排前（贴近 Meili 的标题加权）；
// 分面计数与 Meili 实现同一契约：始终统计全部类型，不受 type 过滤约束。

import type {
  SearchDocument,
  SearchFacets,
  SearchHit,
  SearchIndex,
  SearchQueryOptions,
  SearchResultPage,
} from "@/lib/search/search-types";
import { highlightHtml } from "@/lib/search/search-types";

export class FakeSearchIndex implements SearchIndex {
  /** pageId → 文档；测试可直接读取/篡改以构造漂移或断言索引内容。 */
  readonly docs = new Map<number, SearchDocument>();

  has(pageId: number): boolean {
    return this.docs.has(pageId);
  }

  private queryAll(query: string): SearchDocument[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const matched = [...this.docs.values()].filter(
      (doc) => doc.title.toLowerCase().includes(q) || doc.body.toLowerCase().includes(q),
    );
    return matched.sort(
      (a, b) =>
        Number(a.title.toLowerCase().includes(q) ? 0 : 1) -
          Number(b.title.toLowerCase().includes(q) ? 0 : 1) ||
        a.pageId - b.pageId,
    );
  }

  private toHit(doc: SearchDocument, query: string): SearchHit {
    const q = query.trim().toLowerCase();
    const at = q ? doc.body.toLowerCase().indexOf(q) : -1;
    const raw =
      at >= 0
        ? doc.body.slice(Math.max(0, at - 40), at + q.length + 60)
        : doc.body.slice(0, 100);
    return {
      pageId: doc.pageId,
      type: doc.type,
      title: doc.title,
      slug: doc.slug,
      // 端口契约：片段必须 HTML 安全（fake 无高亮，纯转义即可）
      snippet: highlightHtml(raw),
    };
  }

  async upsert(docs: SearchDocument[]): Promise<void> {
    for (const doc of docs) this.docs.set(doc.pageId, { ...doc });
  }

  async remove(pageIds: number[]): Promise<void> {
    for (const id of pageIds) this.docs.delete(id);
  }

  async search(query: string, options: SearchQueryOptions = {}): Promise<SearchResultPage> {
    const all = this.queryAll(query);
    const facets: SearchFacets = {};
    for (const doc of all) facets[doc.type] = (facets[doc.type] ?? 0) + 1;
    const filtered = options.type ? all.filter((doc) => doc.type === options.type) : all;
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 20;
    return {
      hits: filtered.slice(offset, offset + limit).map((doc) => this.toHit(doc, query)),
      total: filtered.length,
      facets,
    };
  }

  async suggest(query: string, limit: number): Promise<SearchHit[]> {
    return this.queryAll(query).slice(0, limit).map((doc) => this.toHit(doc, query));
  }

  async replaceAll(docs: SearchDocument[]): Promise<void> {
    this.docs.clear();
    await this.upsert(docs);
  }
}
