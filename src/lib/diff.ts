// 行级 diff（纯函数，无 IO）：审核队列「当前版 vs 提案」的展示期产物（ADR-0004 #1——
// diff 不落库，队列页现算）。任意两修订的对比视图（T08）复用同一实现。

/** 一行 diff：same = 两版共有；del = 仅在旧版（当前版）；add = 仅在新版（提案）。 */
export interface DiffRow {
  type: "same" | "add" | "del";
  text: string;
}

/** 超过此规模（行数乘积）退化为整段替换，避免 LCS 的 O(n·m) 表爆内存。 */
const LCS_LIMIT = 4_000_000;

/**
 * 行级 LCS diff：保持两版文本的公共行序，删除行与新增行按最小编辑呈现。
 * 空行也是一行；文末无换行符与有换行符视为相同（split 的尾空串差异被抹去）。
 */
export function diffLines(oldText: string, newText: string): DiffRow[] {
  // 空文本 = 没有行（而非一个空行）：新增/清空场景不产生幽灵行
  const a = oldText === "" ? [] : oldText.endsWith("\n") ? oldText.slice(0, -1).split("\n") : oldText.split("\n");
  const b = newText === "" ? [] : newText.endsWith("\n") ? newText.slice(0, -1).split("\n") : newText.split("\n");

  if (a.length * b.length > LCS_LIMIT) {
    return [
      ...a.map((text): DiffRow => ({ type: "del", text })),
      ...b.map((text): DiffRow => ({ type: "add", text })),
    ];
  }

  // lcs[i][j] = a[i:] 与 b[j:] 的最长公共子序列长度（逆序填表）
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ type: "del", text: a[i] });
      i++;
    } else {
      rows.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < a.length) {
    rows.push({ type: "del", text: a[i] });
    i++;
  }
  while (j < b.length) {
    rows.push({ type: "add", text: b[j] });
    j++;
  }
  return rows;
}
