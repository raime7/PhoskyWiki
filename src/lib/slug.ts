// URL 寻址的纯函数（ADR-0003）：
//   /<type>/<slug>-<id> —— id 永不改变、是唯一权威；slug 只是可读装饰，改名只换 slug。
//   中文名 slug 生成失败（清洗后为空）时退化为纯 id。

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
export function pagePath(type: string, slug: string, id: number): string {
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
