// jsdiff 是展示期的纯函数计算，不落库（ADR-0004，TECH-STACK）。
import { diffArrays, diffChars, type Change } from "diff";

export interface DiffRow {
  type: "same" | "add" | "del";
  text: string;
}

// 限制差异极大的文本的计算成本；长文本中的小改动仍可精确对比。
const MAX_EDIT_LENGTH = 2000;

function changeType(change: Pick<Change, "added" | "removed">): DiffRow["type"] {
  return change.added ? "add" : change.removed ? "del" : "same";
}

function lines(text: string): string[] {
  // 延续审核队列语义：空文本没有行，忽略文末一个换行符。
  return text === "" ? [] : (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
}

export function diffLines(oldText: string, newText: string): DiffRow[] {
  const before = lines(oldText);
  const after = lines(newText);
  const changes = diffArrays(before, after, { maxEditLength: MAX_EDIT_LENGTH });
  return changes
    ? changes.flatMap((change) => change.value.map((text) => ({ type: changeType(change), text })))
    : [...before.map((text): DiffRow => ({ type: "del", text })), ...after.map((text): DiffRow => ({ type: "add", text }))];
}

/** 按 Unicode 码点比较改动行，中文与 emoji 不拆代理对。 */
export function diffInline(oldText: string, newText: string): DiffRow[] {
  const changes = diffChars(oldText, newText, { maxEditLength: MAX_EDIT_LENGTH });
  return changes
    ? changes.map((change) => ({ type: changeType(change), text: change.value }))
    : [{ type: "del", text: oldText }, { type: "add", text: newText }];
}
