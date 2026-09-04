// 行级 diff 纯函数单元测试（T06 审核队列的现算 diff；T08 任意两版对比复用）。

import { describe, expect, it } from "vitest";

import { diffLines } from "@/lib/diff";

function joined(text: string): string {
  return diffLines(text, text)
    .map((row) => row.type)
    .join(",");
}

describe("diffLines", () => {
  it("完全相同的文本全为 same 行", () => {
    const text = "第一行\n第二行\n\n第四行";
    expect(diffLines(text, text).every((row) => row.type === "same")).toBe(true);
    expect(diffLines(text, text).map((row) => row.text)).toEqual([
      "第一行",
      "第二行",
      "",
      "第四行",
    ]);
  });

  it("文末换行差异视为相同（尾部空行不是内容）", () => {
    expect(joined("a\nb")).toBe(joined("a\nb\n"));
  });

  it("纯新增：新文本多出的行标记为 add", () => {
    const rows = diffLines("甲\n乙", "甲\n乙\n丙\n丁");
    expect(rows).toEqual([
      { type: "same", text: "甲" },
      { type: "same", text: "乙" },
      { type: "add", text: "丙" },
      { type: "add", text: "丁" },
    ]);
  });

  it("纯删除：旧文本多出的行标记为 del", () => {
    const rows = diffLines("甲\n乙\n丙", "甲");
    expect(rows).toEqual([
      { type: "same", text: "甲" },
      { type: "del", text: "乙" },
      { type: "del", text: "丙" },
    ]);
  });

  it("中间改一段：呈现为相邻的 del + add，公共前后行保持 same", () => {
    const rows = diffLines("导语\n旧论点一\n旧论点二\n结论", "导语\n新论点一\n结论");
    expect(rows).toEqual([
      { type: "same", text: "导语" },
      { type: "del", text: "旧论点一" },
      { type: "del", text: "旧论点二" },
      { type: "add", text: "新论点一" },
      { type: "same", text: "结论" },
    ]);
  });

  it("空文本 → 全 add；→ 空文本 全 del；空对空无行", () => {
    expect(diffLines("", "新内容")).toEqual([{ type: "add", text: "新内容" }]);
    expect(diffLines("旧内容", "")).toEqual([{ type: "del", text: "旧内容" }]);
    expect(diffLines("", "")).toEqual([]);
  });

  it("相邻两行都改动：连续删除行与新增行成组呈现（最小编辑序）", () => {
    const rows = diffLines(
      "拉康论主体性：镜像阶段。\n参见[[意识形态]]。",
      "拉康论主体性：镜像阶段的误认。\n参见[[意识形态]]与[[异化]]。",
    );
    expect(rows).toEqual([
      { type: "del", text: "拉康论主体性：镜像阶段。" },
      { type: "del", text: "参见[[意识形态]]。" },
      { type: "add", text: "拉康论主体性：镜像阶段的误认。" },
      { type: "add", text: "参见[[意识形态]]与[[异化]]。" },
    ]);
  });
});
