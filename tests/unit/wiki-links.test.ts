import { describe, expect, it } from "vitest";

import { extractWikiLinks } from "@/lib/wiki-links";

describe("extractWikiLinks", () => {
  it("提取默认链接的中文名", () => {
    expect(extractWikiLinks("见 [[主体性]] 一节")).toEqual(["主体性"]);
  });

  it("带别名的链接只取目标名", () => {
    expect(extractWikiLinks("见 [[意识形态|意识形态概念]]")).toEqual(["意识形态"]);
  });

  it("多个链接去重且保序", () => {
    const source = "[[异化]] 与 [[主体性]]，再说 [[异化]]";
    expect(extractWikiLinks(source)).toEqual(["异化", "主体性"]);
  });

  it("跨行文本与未闭合语法不误收", () => {
    expect(extractWikiLinks("[[异化\n]] 普通文本 [主体性] [[未闭合")).toEqual([]);
  });

  it("空名与纯空白名被忽略", () => {
    expect(extractWikiLinks("[[ ]] [[]]")).toEqual([]);
  });
});
