import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Node, Parent } from "unist";

export class ImageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function imageIdFromUrl(url: string): string | null {
  const id = url.startsWith("/api/images/") ? url.slice(12) : "";
  return IMAGE_ID.test(id) ? id : null;
}
interface MarkdownNode extends Node { url?: string; identifier?: string; value?: string }
function walk(node: Node, visit: (node: MarkdownNode) => void) {
  visit(node);
  for (const child of (node as Parent).children ?? []) walk(child, visit);
}
/** 解析语法树，代码示例不算图片；引用式图片同样必须指向站内。 */
export function imageReferences(content: string): string[] {
  const tree = unified().use(remarkParse).parse(content);
  const definitions = new Map<string, string>();
  walk(tree, (node) => { if (node.type === "definition" && !definitions.has(node.identifier!)) definitions.set(node.identifier!, node.url!); });
  const ids = new Set<string>();
  walk(tree, (node) => {
    if (node.type === "html" && /<\s*(?:img|picture|source)\b/i.test(node.value ?? "")) throw new ImageError(400, "请使用站内图片 Markdown，不能嵌入 HTML 图片");
    if (node.type !== "image" && node.type !== "imageReference") return;
    const url = node.type === "image" ? node.url : definitions.get(node.identifier!);
    // 未定义的引用会按普通文字渲染。
    if (!url && node.type === "imageReference") return;
    const id = imageIdFromUrl(url ?? "");
    if (!id) throw new ImageError(400, "禁止外链图片；请先上传并插入站内图片");
    ids.add(id);
  });
  return [...ids];
}

/** 读路径与实时预览也过滤旧内容中的外链图，避免浏览器请求第三方。 */
export function filterRenderedImages() {
  return (tree: Node) => {
    function filter(parent: Parent) {
      if (!parent.children) return;
      parent.children = parent.children.filter((child) => {
        const element = child as Node & { tagName?: string; properties?: { src?: string } };
        return element.tagName !== "img" || imageIdFromUrl(element.properties?.src ?? "") !== null;
      });
      for (const child of parent.children) filter(child as Parent);
    }
    filter(tree as Parent);
  };
}
