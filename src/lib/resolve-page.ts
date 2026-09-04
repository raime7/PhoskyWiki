// 路由共享的页面解析（ADR-0003）：URL key 只认尾随 id，slug 是装饰；
// 旧 slug / 纯 id 访问一律 307 到规范路径 /<type>/<slug>-<id>，改名不断链。

import { notFound, redirect } from "next/navigation";

import type { PageType } from "@/db/schema";
import { getLivePage, type LivePage } from "@/lib/content";
import { decodePageKey, pageIdFromKey, pageKey, pagePath } from "@/lib/slug";

export async function resolveLivePage(
  type: PageType,
  rawKey: string,
): Promise<LivePage> {
  const id = pageIdFromKey(rawKey);
  if (!id) notFound();

  const page = await getLivePage(id);
  // 类型不匹配（拿词条 id 访问 /interpreter/...）视作 404
  if (!page || page.type !== type) notFound();

  const key = decodePageKey(rawKey);
  if (key !== pageKey(page.slug, page.id)) {
    // Location 头不接受非 ASCII，中文 slug 需要百分号编码
    redirect(encodeURI(pagePath(page.type, page.slug, page.id)));
  }
  return page;
}
