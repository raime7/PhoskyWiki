// 双链语法的文本层工具（ADR-0003 #4：解析发生在保存时，links 落目标 page_id）。
//
// 语法：
//   [[词条名]]              默认链接，落词条枢纽页
//   [[词条名|显示别名]]      带显示别名，落词条枢纽页
//   [[词条名|视角@诠释者]]   显式视角语法，直落「词条 × 诠释者」的视角页——
//                           显示文本取 @ 之前的部分，@ 之后是诠释者名；
//                           perspectives 的（词条 × 诠释者）唯一约束保证
//                           诠释者名即在词条范围内定位唯一视角。

import { markdownParser, visitWikiLinks } from "@/lib/markdown-ast";

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

/**
 * 提取与渲染相同 AST 中的真实双链（按 wikiLinkKey 去重、保序）。
 */
export function parseWikiLinks(source: string): ParsedWikiLink[] {
  const seen = new Set<string>();
  const links: ParsedWikiLink[] = [];
  visitWikiLinks(markdownParser().parse(source), (node) => {
    const parsed = parseWikiLink(node.value, node.data?.alias ?? null);
    if (!parsed) return;
    const key = wikiLinkKey(parsed);
    if (seen.has(key)) return;
    seen.add(key);
    links.push(parsed);
  });
  return links;
}
