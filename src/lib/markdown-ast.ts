// 保存提取与渲染共同使用的 Markdown 语法入口；代码、转义由 remark 统一处理。
import remarkParse from "remark-parse";
import remarkWikiLink from "remark-wiki-link";
import { unified } from "unified";
import type { Node, Parent } from "unist";

export interface WikiLinkNode extends Node {
  type: "wikiLink";
  value: string;
  data?: {
    alias?: string | null;
    hName?: string;
    hProperties?: Record<string, unknown>;
    hChildren?: { type: string; value: string }[];
  };
}

export function markdownParser() {
  return unified().use(remarkParse).use(remarkWikiLink, { aliasDivider: "|" });
}

export function visitWikiLinks(tree: Node, visit: (node: WikiLinkNode) => void): void {
  if (tree.type === "wikiLink") visit(tree as WikiLinkNode);
  for (const child of (tree as Parent).children ?? []) visitWikiLinks(child, visit);
}
