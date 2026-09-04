import { describe, expect, it } from "vitest";

import { baseTermTitle, pageKey, pagePath, parsePageKey, slugify } from "@/lib/slug";

describe("slugify", () => {
  it("保留中文并小写化拉丁字母", () => {
    expect(slugify("主体性")).toBe("主体性");
    expect(slugify("Lacan 论 Subjectivity")).toBe("lacan-论-subjectivity");
  });

  it("剔除全角/半角标点（括号限定标题）", () => {
    expect(slugify("价值（政治经济学）")).toBe("价值政治经济学");
    expect(slugify("The \"Communist\" Manifesto!")).toBe("the-communist-manifesto");
  });

  it("折叠连续连字符并修剪首尾", () => {
    expect(slugify("  a   b - c ")).toBe("a-b-c");
  });

  it("清洗后为空时返回空串（调用方退化为纯 id）", () => {
    expect(slugify("！！！？？？")).toBe("");
  });
});

describe("pageKey / pagePath", () => {
  it("组合 slug 与 id；slug 为空退化为纯 id", () => {
    expect(pageKey("主体性", 3)).toBe("主体性-3");
    expect(pageKey("", 3)).toBe("3");
  });

  it("pagePath 生成规范路径", () => {
    expect(pagePath("term", "主体性", 3)).toBe("/term/主体性-3");
  });
});

describe("parsePageKey", () => {
  it("解析 slug-id 形态（含中文名）", () => {
    expect(parsePageKey("主体性-3")).toBe(3);
    expect(parsePageKey("价值政治经济学-12")).toBe(12);
  });

  it("解析纯 id 形态（仅凭 id 亦可寻址）", () => {
    expect(parsePageKey("42")).toBe(42);
  });

  it("slug 内含连字符与数字时仍取尾随数字", () => {
    expect(parsePageKey("theory-2-5")).toBe(5);
  });

  it("无尾随数字或非法输入返回 null", () => {
    expect(parsePageKey("主体性")).toBeNull();
    expect(parsePageKey("slug-")).toBeNull();
    expect(parsePageKey("")).toBeNull();
  });

  it("超出安全整数范围返回 null", () => {
    expect(parsePageKey("99999999999999999999")).toBeNull();
  });
});

describe("baseTermTitle", () => {
  it("剥结尾的全角括号限定段", () => {
    expect(baseTermTitle("价值（政治经济学）")).toBe("价值");
    expect(baseTermTitle("价值（哲学）")).toBe("价值");
  });

  it("无限定段返回原题（去除首尾空白）", () => {
    expect(baseTermTitle("主体性")).toBe("主体性");
    expect(baseTermTitle(" 价值 ")).toBe("价值");
  });

  it("括号不在结尾或未闭合时不剥", () => {
    expect(baseTermTitle("（价值）政治经济学")).toBe("（价值）政治经济学");
    expect(baseTermTitle("价值（政治经济学")).toBe("价值（政治经济学");
  });
});
