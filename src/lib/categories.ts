// 分类树的纯函数层：行集 → 树 / 祖先链。无 IO，spec「Testing Decisions」的纯函数单元层。

export interface CategoryRow {
  id: number;
  name: string;
  slug: string;
  parentId: number | null;
  /** 直接挂载的在线词条数（不含子分类）。 */
  termCount: number;
}

export interface CategoryTreeNode extends CategoryRow {
  children: CategoryTreeNode[];
}

/**
 * 行集建树：parentId 挂到父节点 children 末尾，根（parentId 为空）按行序返回。
 * 数据层保证 parentId 一定指向既有分类（外键），孤儿行不会出现。
 */
export function buildCategoryTree(rows: CategoryRow[]): CategoryTreeNode[] {
  const nodes = new Map<number, CategoryTreeNode>(rows.map((row) => [row.id, { ...row, children: [] }]));
  const roots: CategoryTreeNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id)!;
    if (row.parentId === null) {
      roots.push(node);
    } else {
      nodes.get(row.parentId)!.children.push(node);
    }
  }
  return roots;
}

/**
 * 分类不是页面（ADR-0003 #2），不参与 /<type>/<slug>-<id> 寻址；
 * 功能页地址统一经此构造，避免散落的模板字符串。
 */
export function categoryPath(slug: string): string {
  return `/categories/${slug}`;
}

/**
 * 从根到指定分类的祖先链（不含自身）。外键只保证父行存在、不排除环，
 * seen 截断是防御：树状用法下不触发，坏数据下避免死循环。
 */
export function categoryAncestorPath(rows: CategoryRow[], id: number): CategoryRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const path: CategoryRow[] = [];
  const seen = new Set<number>([id]);
  let current = byId.get(id)?.parentId ?? null;
  while (current !== null) {
    const parent = byId.get(current);
    if (!parent || seen.has(parent.id)) break;
    path.unshift(parent);
    seen.add(parent.id);
    current = parent.parentId;
  }
  return path;
}
