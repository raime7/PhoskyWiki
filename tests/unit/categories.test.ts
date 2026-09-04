import { describe, expect, it } from "vitest";

import {
  buildCategoryTree,
  categoryAncestorPath,
  type CategoryRow,
} from "@/lib/categories";

function row(overrides: Partial<CategoryRow> & Pick<CategoryRow, "id" | "name">): CategoryRow {
  return { slug: overrides.name, parentId: null, termCount: 0, ...overrides };
}

describe("buildCategoryTree", () => {
  it("把行集挂成树，根按行序返回、子分类按行序挂在父下", () => {
    const rows = [
      row({ id: 1, name: "哲学" }),
      row({ id: 2, name: "主体理论", parentId: 1 }),
      row({ id: 3, name: "马克思主义" }),
      row({ id: 4, name: "意识形态批判", parentId: 3 }),
      row({ id: 5, name: "异化理论", parentId: 3 }),
    ];

    const tree = buildCategoryTree(rows);
    expect(tree.map((n) => n.name)).toEqual(["哲学", "马克思主义"]);
    expect(tree[0].children.map((n) => n.name)).toEqual(["主体理论"]);
    expect(tree[1].children.map((n) => n.name)).toEqual(["意识形态批判", "异化理论"]);
    // 节点保留词条计数等行数据
    const withCount = buildCategoryTree([row({ id: 9, name: "政治经济学", termCount: 2 })]);
    expect(withCount[0].termCount).toBe(2);
  });

  it("多级嵌套时孙分类挂在子分类下而非根下", () => {
    const tree = buildCategoryTree([
      row({ id: 1, name: "A" }),
      row({ id: 2, name: "B", parentId: 1 }),
      row({ id: 3, name: "C", parentId: 2 }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].children.map((n) => n.name)).toEqual(["C"]);
  });
});

describe("categoryAncestorPath", () => {
  const rows = [
    row({ id: 1, name: "哲学" }),
    row({ id: 2, name: "主体理论", parentId: 1 }),
    row({ id: 3, name: "现象学", parentId: 2 }),
  ];

  it("返回从根到父的祖先链，不含自身", () => {
    expect(categoryAncestorPath(rows, 3).map((r) => r.name)).toEqual(["哲学", "主体理论"]);
    expect(categoryAncestorPath(rows, 1)).toEqual([]);
  });

  it("未知 id 返回空链（视作根）", () => {
    expect(categoryAncestorPath(rows, 99)).toEqual([]);
  });
});
