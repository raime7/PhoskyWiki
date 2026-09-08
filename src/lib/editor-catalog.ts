import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { pages, perspectives } from "@/db/schema";
import { pagePath } from "@/lib/slug";
import { wikiLinkKey } from "@/lib/wiki-links";

export interface EditorCatalog {
  terms: { title: string }[];
  targets: { key: string; href: string }[];
}

/** 一期编辑器加载公开页面的名称与落点；正文预览和补全均在本地进行。 */
export async function getEditorCatalog(): Promise<EditorCatalog> {
  const db = getDb();
  const term = alias(pages, "editor_term");
  const interpreter = alias(pages, "editor_interpreter");
  const [hubs, viewpoints] = await Promise.all([
    db.select({ id: pages.id, title: pages.title, slug: pages.slug, type: pages.type })
      .from(pages)
      .where(and(eq(pages.type, "term"), isNull(pages.deletedAt)))
      .orderBy(asc(pages.type), asc(pages.title)),
    db.select({ id: pages.id, slug: pages.slug, term: term.title, interpreter: interpreter.title })
      .from(perspectives)
      .innerJoin(pages, eq(pages.id, perspectives.pageId))
      .innerJoin(term, eq(term.id, perspectives.termId))
      .innerJoin(interpreter, eq(interpreter.id, perspectives.interpreterId))
      .where(and(isNull(pages.deletedAt), isNull(term.deletedAt), isNull(interpreter.deletedAt))),
  ]);
  // 与保存时的解析保持一致：默认链接落词条。
  const targets = new Map<string, string>();
  for (const hub of hubs) {
    const key = wikiLinkKey({ term: hub.title, interpreter: null });
    targets.set(key, pagePath(hub.type, hub.slug, hub.id));
  }
  for (const viewpoint of viewpoints) {
    targets.set(wikiLinkKey(viewpoint), pagePath("perspective", viewpoint.slug, viewpoint.id));
  }
  return {
    terms: [...new Set(hubs.map((hub) => hub.title))].map((title) => ({ title })),
    targets: [...targets].map(([key, href]) => ({ key, href })),
  };
}
