import { expect, it } from "vitest";
import { compareTermMetadata, termSnapshot } from "@/lib/revision-snapshot";

it("别名边界变化也属于字段差异，不能被相同显示分隔符掩盖", () => {
  const from = termSnapshot({ title: "词条", summary: "简介", aliases: ["甲", "乙"] });
  const to = termSnapshot({ title: "词条", summary: "简介", aliases: ["甲、乙"] });
  expect(compareTermMetadata(from, to).map((row) => row.changed)).toEqual([false, false, false, true]);
});
