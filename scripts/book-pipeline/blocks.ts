// Markdown 顶层块切分（validate 的锁定检查与 incremental 的锁定生成共用，#110/#111）。
// 约定：块 = remark 解析出的顶层节点在源文本中的原样切片（首尾空白已去）；块哈希 = sha256(块文本)。
// `LockedBlock.index` / `.sha256` / `.text` 都按这里的切法计算。

import { markdownParser } from "@/lib/markdown-ast";

export function topLevelBlocks(markdown: string): string[] {
  const tree = markdownParser().parse(markdown) as { children?: { position?: { start: { offset?: number }; end: { offset?: number } } }[] };
  return (tree.children ?? []).map((node) => markdown.slice(node.position!.start.offset!, node.position!.end.offset!).trim());
}
