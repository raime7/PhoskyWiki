// T13 纯函数层：讨论帖索引主键的偏移编码/解码与命中路径拼接。
// 楼层不是页面（ADR-0003），索引主键需要与 pages.id 区隔（search-types）。

import { describe, expect, it } from "vitest";

import {
  DISCUSSION_DOC_ID_OFFSET,
  discussionDocId,
  discussionPostId,
  searchHitHref,
} from "@/lib/search/search-types";

describe("讨论帖索引主键（偏移编码）", () => {
  it("编码 = 偏移 + 楼层 id；解码往返无损", () => {
    for (const postId of [1, 42, 123_456]) {
      expect(discussionDocId(postId)).toBe(DISCUSSION_DOC_ID_OFFSET + postId);
      expect(discussionPostId(discussionDocId(postId))).toBe(postId);
    }
  });

  it("偏移量级远超 pages.id 自增序列的现实上界（十亿页面）", () => {
    expect(DISCUSSION_DOC_ID_OFFSET).toBe(2 ** 30);
  });
});

describe("searchHitHref（讨论命中路径）", () => {
  it("讨论帖命中跳到词条讨论区的楼层锚点；slug 承载词条 pageKey", () => {
    expect(
      searchHitHref({ type: "discussion", slug: "主体性-12", pageId: discussionDocId(34) }),
    ).toBe("/term/主体性-12/discussion#floor-34");
    // 中文 slug 清洗失败退化后的纯 id pageKey 同样成立
    expect(
      searchHitHref({ type: "discussion", slug: "7", pageId: discussionDocId(5) }),
    ).toBe("/term/7/discussion#floor-5");
  });

  it("页面类型命中仍是 /<type>/<slug>-<id>", () => {
    expect(searchHitHref({ type: "term", slug: "主体性", pageId: 12 })).toBe("/term/主体性-12");
    expect(searchHitHref({ type: "perspective", slug: "", pageId: 3 })).toBe("/perspective/3");
  });
});
