import { describe, expect, it } from "vitest";

import { pickDailyTerm } from "@/lib/daily-term";
import { firstParagraphExcerpt } from "@/lib/perspective-excerpt";

describe("firstParagraphExcerpt", () => {
  it("跳过标题、引文与列表，取首个正文段并去掉双链与强调标记", () => {
    const markdown = [
      "## 镜像与误认",
      "> 镜像阶段应被理解为一种认同。",
      "- 列表项",
      "拉康认为主体在[[镜像阶段]]中形成，参见[[主体性|德里达论主体性@德里达]]与**象征界**。",
      "第二段不应出现。",
    ].join("\n\n");
    expect(firstParagraphExcerpt(markdown)).toBe("拉康认为主体在镜像阶段中形成，参见主体性与象征界。");
  });

  it("超长时退到最后一个句末标点，不在句中截断", () => {
    const sentence = "主体是在能指链中被构成的。";
    const text = sentence.repeat(20);
    const excerpt = firstParagraphExcerpt(text, 60);
    expect(excerpt.length).toBeLessThanOrEqual(60);
    expect(excerpt.endsWith("。")).toBe(true);
  });

  it("句子过长时退到逗号并补省略号", () => {
    const text = `${"甲".repeat(30)}，${"乙".repeat(80)}。`;
    expect(firstParagraphExcerpt(text, 60)).toBe(`${"甲".repeat(30)}……`);
  });

  it("空内容或只有标题时为空串", () => {
    expect(firstParagraphExcerpt(null)).toBe("");
    expect(firstParagraphExcerpt("# 只有标题")).toBe("");
  });
});

describe("pickDailyTerm", () => {
  const terms = ["主体性", "异化", "意识形态"];

  it("同一 UTC 日内任何时刻结果相同，次日轮换到下一个", () => {
    const morning = pickDailyTerm(terms, new Date("2026-09-28T00:05:00Z"));
    expect(pickDailyTerm(terms, new Date("2026-09-28T23:55:00Z"))).toBe(morning);
    const next = pickDailyTerm(terms, new Date("2026-09-29T12:00:00Z"));
    expect(terms.indexOf(next!)).toBe((terms.indexOf(morning!) + 1) % terms.length);
  });

  it("没有候选时返回 null", () => {
    expect(pickDailyTerm([], new Date())).toBeNull();
  });
});
