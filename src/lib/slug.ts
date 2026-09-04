// URL 寻址与标题命名的纯函数（ADR-0003）：
//   /<type>/<slug>-<id> —— id 永不改变、是唯一权威；slug 只是可读装饰，改名只换 slug。
//   中文名 slug 生成失败（清洗后为空）时退化为纯 id。
//   括号限定标题（消歧义的命名约定）→ 基准名的剥取也在这里。

import type { PageType } from "@/db/schema";

/**
 * 括号限定标题的基准名（ADR-0003 #5）：「价值（政治经济学）」→「价值」。
 * 只剥结尾的全角括号限定段（同名多义词条的命名约定）；无限定段返回原题。
 * 消歧义页以基准名为标题，聚合同基准名的全部词条。
 */
export function baseTermTitle(title: string): string {
  const match = /^(.+)\uff08[^\uff09]*\uff09$/.exec(title.trim());
  return match ? match[1] : title.trim();
}

/** 由标题生成 slug：保留字母/数字/CJK，空格转连字符，其余标点删除。 */
export function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    // \p{L}\p{N} 覆盖 CJK；全角括号等标点在此被剔除
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 页面 URL 的 key 段：`<slug>-<id>`；slug 为空时退化为 `<id>`。 */
export function pageKey(slug: string, id: number): string {
  return slug ? `${slug}-${id}` : String(id);
}

/** 规范路径：`/<type>/<slug>-<id>`。 */
export function pagePath(type: PageType, slug: string, id: number): string {
  return `/${type}/${pageKey(slug, id)}`;
}

/**
 * 从 URL key 段解析页面 id：接受 `<slug>-<id>` 与纯 `<id>` 两种形态。
 * id 是唯一权威——slug 部分无论如何（改名后的旧 slug、乱码、手滑）都只看尾随数字。
 */
export function parsePageKey(key: string): number | null {
  const match = /^(?:.*-)?(\d+)$/.exec(key);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** 路由参数可能以百分号编码到达；slug 清洗后不含 '%'，解码是安全的。 */
export function decodePageKey(rawKey: string): string {
  try {
    return decodeURIComponent(rawKey);
  } catch {
    return rawKey;
  }
}

/** 路由参数（可能编码）→ 页面 id；非法返回 null。generateMetadata / 页面组件共用。 */
export function pageIdFromKey(rawKey: string): number | null {
  return parsePageKey(decodePageKey(rawKey));
}
