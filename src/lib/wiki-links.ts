// 双链语法的文本层工具（ADR-0003 #4：解析发生在保存时，links 落目标 page_id）。
//
// 语法：
//   [[词条名]]              默认链接，落词条枢纽页
//   [[词条名|显示别名]]      带显示别名，落词条枢纽页
//   [[词条名|视角@诠释者]]   显式视角语法，直落「词条 × 诠释者」的视角页——
//                           显示文本取 @ 之前的部分，@ 之后是诠释者名；
//                           perspectives 的（词条 × 诠释者）唯一约束保证
//                           诠释者名即在词条范围内定位唯一视角。

/** 一条双链的寻址目标：词条名，可选显式视角语法指定的诠释者。 */
export interface WikiLinkRef {
  /** 目标词条名（| 之前） */
  term: string;
  /** 显式视角语法的诠释者名；默认链接与普通别名链接为 null */
  interpreter: string | null;
}

/** 解析后的双链：寻址目标 + 渲染显示文本。 */
export interface ParsedWikiLink extends WikiLinkRef {
  /** 渲染显示文本 */
  display: string;
}

/** links.target_name 的规范键：默认链接 = 词条名；显式视角链接 = 词条@诠释者。 */
export function wikiLinkKey(ref: WikiLinkRef): string {
  return ref.interpreter === null ? ref.term : `${ref.term}@${ref.interpreter}`;
}

/**
 * 解析单条双链的目标与别名（渲染器与文本提取共用同一规则）。
 * 目标名为空白返回 null；别名规则见文件头注释。
 */
export function parseWikiLink(target: string, alias: string | null): ParsedWikiLink | null {
  const term = target.trim();
  if (!term) return null;
  if (alias === null) {
    return { term, interpreter: null, display: term };
  }
  const at = alias.lastIndexOf("@");
  if (at === -1) {
    return { term, interpreter: null, display: alias.trim() || term };
  }
  const interpreter = alias.slice(at + 1).trim();
  if (!interpreter) {
    return { term, interpreter: null, display: alias.trim() || term };
  }
  const display = alias.slice(0, at).trim();
  return { term, interpreter, display: display || alias };
}

const WIKI_LINK_PATTERN = /\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]+))?\]\]/g;

/**
 * 提取 Markdown 源文本里的全部双链（按 wikiLinkKey 去重、保序）。
 *
 * 与渲染器共用同一语法；已知的偏差是代码块内的 `[[..]]` 会被这里计入——
 * 写路径（T06）落库前如需精确，应改用与渲染一致的 AST 提取。
 */
export function parseWikiLinks(source: string): ParsedWikiLink[] {
  const seen = new Set<string>();
  const links: ParsedWikiLink[] = [];
  for (const match of source.matchAll(WIKI_LINK_PATTERN)) {
    const parsed = parseWikiLink(match[1], match[2] ?? null);
    if (!parsed) continue;
    const key = wikiLinkKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(parsed);
  }
  return links;
}
