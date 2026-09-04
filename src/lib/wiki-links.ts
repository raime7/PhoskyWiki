// 双链语法的文本层工具（ADR-0003 #4：解析发生在保存时，links 落目标 page_id）。
//
// 语法：
//   [[词条名]]            默认链接，落词条枢纽页
//   [[词条名|显示别名]]    带显示别名（显式视角语法 `视角@诠释者` 随写路径工单落地）

const WIKI_LINK_PATTERN = /\[\[([^\[\]|\n]+)(?:\|[^\[\]\n]+)?\]\]/g;

/**
 * 提取 Markdown 源文本里的全部双链目标名（去重、保序）。
 *
 * 与渲染器共用同一语法；已知的偏差是代码块内的 `[[..]]` 会被这里计入——
 * 写路径（T03+）落库前如需精确，应改用与渲染一致的 AST 提取。
 */
export function extractWikiLinks(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(WIKI_LINK_PATTERN)) {
    const name = match[1].trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
