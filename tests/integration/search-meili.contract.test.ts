// 打真 Meilisearch 的契约测试（T10 验收，ADR-0002）：验证 meili-index 实现
// 满足 SearchIndex 端口语义——upsert/remove 读己之写、类型过滤、
// 分面计数不受过滤约束、前缀联想、全量替换修漂移、高亮片段安全。
// 用专用索引 pages-contract-test，不污染开发索引；Meili 不可达时整组跳过
// （本地未起 compose 时不出红，CI 的 lint-test 任务配有 Meili 服务必跑）。

import { Meilisearch } from "meilisearch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { meiliSearchIndex } from "@/lib/search/meili-index";
import type { SearchDocument } from "@/lib/search/search-types";

const HOST = process.env.SEARCH_CONTRACT_HOST ?? "http://localhost:7700";
const API_KEY = process.env.MEILI_MASTER_KEY ?? "dev-meili-master-key";
const UID = "pages-contract-test";

const reachable = await (async () => {
  try {
    const health = await new Meilisearch({ host: HOST, apiKey: API_KEY }).health();
    return health.status === "available";
  } catch {
    return false;
  }
})();

const docs: SearchDocument[] = [
  {
    pageId: 1,
    type: "term",
    title: "异化",
    slug: "yi-hua",
    body: "人造的世界反过来支配人：劳动产品、关系与本质如何成为敌对的力量。",
  },
  {
    pageId: 2,
    type: "interpreter",
    title: "马克思",
    slug: "ma-ke-si",
    body: "《1844 年经济学哲学手稿》的作者。",
  },
  {
    pageId: 3,
    type: "perspective",
    title: "马克思论异化",
    slug: "ma-ke-si-lun-yi-hua",
    body: "工人同自己的劳动产品的关系，就是同一个异己的对象的关系。",
  },
];

describe.skipIf(!reachable)("SearchIndex 契约（真 Meilisearch）", () => {
  const admin = new Meilisearch({ host: HOST, apiKey: API_KEY });
  const index = meiliSearchIndex({ host: HOST, apiKey: API_KEY, indexUid: UID });

  beforeAll(async () => {
    // 首次运行时索引尚不存在：删除任务以 index_not_found 失败但属预期，吞掉即可
    await admin.index(UID).delete().waitTask().catch(() => {});
  });

  afterAll(async () => {
    await admin.index(UID).delete().waitTask().catch(() => {});
  });

  it("upsert 后读己之写；命中带高亮片段且片段只含 mark 标签", async () => {
    await index.upsert(docs);

    const result = await index.search("异化");
    expect(result.hits.map((hit) => hit.pageId)).toContain(1);
    expect(result.total).toBeGreaterThanOrEqual(2);

    // 正文命中的片段带 <mark>（标题命中时片段无 mark 是合理形态；
    // 分词可能拆成相邻两组高亮，如 <mark>劳动</mark><mark>产品</mark>）
    const bodyHit = (await index.search("劳动产品")).hits.find((hit) => hit.pageId === 1);
    expect(bodyHit?.snippet).toContain("<mark>劳动</mark><mark>产品</mark>");
    // 原文里的任意 HTML 必须被转义，只有自家 <mark> 放行（XSS 契约）
    await index.upsert([
      { pageId: 90, type: "perspective", title: "注入测试", slug: "inject", body: "<script>alert(1)</script>异化" },
    ]);
    const hostile = await index.search("异化");
    const hostileHit = hostile.hits.find((hit) => hit.pageId === 90);
    expect(hostileHit?.snippet).not.toContain("<script>");
  });

  it("类型过滤只出该类型；分面计数不受过滤约束（端口契约）", async () => {
    const result = await index.search("异化", { type: "term" });
    expect(result.hits.map((hit) => hit.type)).toEqual(["term"]);
    expect(result.facets).toMatchObject({ term: expect.any(Number), perspective: expect.any(Number) });
    // Meili 省略零计数分面（fake 同契约）：缺类型 = 0 命中
    expect(result.facets.interpreter).toBeUndefined();
  });

  it("remove 后不再命中", async () => {
    await index.remove([2]);
    // 诠释者本体已出索引；其名字仍出现在视角标题里（那是另一篇文档，属正常）
    const result = await index.search("马克思");
    expect(result.hits.map((hit) => hit.pageId)).not.toContain(2);
    // 诠释者简介的独有内容随之不可搜
    const bodyOnly = await index.search("1844");
    expect(bodyOnly.hits).toEqual([]);
  });

  it("suggest 前缀联想命中标题", async () => {
    const suggestions = await index.suggest("马克思", 5);
    expect(suggestions.map((hit) => hit.pageId)).toContain(3);
    const empty = await index.suggest("", 5);
    expect(empty).toEqual([]);
  });

  it("replaceAll 清空重灌：幽灵文档消失、真实文档修正", async () => {
    await index.upsert([{ pageId: 424242, type: "term", title: "幽灵词条", slug: "ghost", body: "ghost" }]);
    await index.replaceAll(docs);
    const ghosts = await index.search("幽灵词条");
    expect(ghosts.hits).toEqual([]);
    const restored = await index.search("劳动产品");
    expect(restored.hits.map((hit) => hit.pageId)).toContain(1);
    // 幂等：再来一次结果一致
    await index.replaceAll([]);
    expect((await index.search("异化")).hits).toEqual([]);
  });
});
