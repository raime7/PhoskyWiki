import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import type { Node, Parent } from "unist";
import type { Db } from "@/db";
import { links, pages, perspectives, revisions } from "@/db/schema";
import { markdownParser, visitWikiLinks } from "@/lib/markdown-ast";
import { parseWikiLink, wikiLinkKey, type WikiLinkRef } from "@/lib/wiki-links";
import { pageIdFromKey, pagePath, slugify } from "@/lib/slug";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export interface PreparedContent {
  original: string;
  content: string;
  targets: Map<string, number | null>;
}

/** 在删来源之前按已解析 id 规范化每份正文，避免来源之间的同名键互相抢占。 */
export async function prepareConsolidationLinks(tx: Tx, ids: Map<number, number>, titles: Map<number, string>, names: Map<string, string>, removed: Set<number>) {
  const inventory = await tx.select().from(pages);
  const byId = new Map(inventory.map(page => [page.id, page]));
  const memberships = new Map((await tx.select().from(perspectives)).map(p => [p.pageId, p]));
  const existing = new Map<number, Map<string, number | null>>();
  for (const link of await tx.select().from(links)) {
    if (!existing.has(link.sourcePageId)) existing.set(link.sourcePageId, new Map());
    existing.get(link.sourcePageId)!.set(link.targetName, link.targetPageId);
  }
  const finalTitle = (id: number) => titles.get(id) ?? byId.get(id)!.title;
  const finalRef = (id: number): WikiLinkRef | null => {
    const page = byId.get(id);
    if (page?.type === "term") return { term: finalTitle(id), interpreter: null };
    if (page?.type !== "perspective") return null;
    const perspective = memberships.get(id)!;
    return { term: finalTitle(ids.get(perspective.termId) ?? perspective.termId), interpreter: finalTitle(perspective.interpreterId) };
  };
  const result = new Map<number, PreparedContent>();
  const heads = await tx.select().from(revisions).where(sql`${revisions.id} in (select max(id) from revisions group by page_id)`).orderBy(asc(revisions.id));
  for (const head of heads) {
    if (removed.has(head.pageId) && !ids.has(head.pageId)) continue;
    if (byId.get(head.pageId)?.type !== "perspective") continue;
    const tree = markdownParser().parse(head.content);
    const replacements: { start: number; end: number; value: string }[] = [];
    const targets = new Map<string, number | null>();
    visitWikiLinks(tree, node => {
      const ref = parseWikiLink(node.value, node.data?.alias ?? null);
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (!ref || start === undefined || end === undefined) return;
      const originalId = existing.get(head.pageId)?.get(wikiLinkKey(ref));
      const targetId = originalId == null ? null : ids.get(originalId) ?? originalId;
      const visibleTarget = targetId !== null && !removed.has(targetId);
      const target = visibleTarget ? finalRef(targetId) : originalId == null ? { ...ref, term: names.get(ref.term) ?? ref.term } : ref;
      if (!target) return;
      const explicitAlias = head.content.slice(start, end).includes("|");
      const alias = target.interpreter !== null ? `${ref.display}@${target.interpreter}`
        : explicitAlias ? node.data?.alias : target.term !== ref.term ? ref.display : undefined;
      const value = `[[${target.term}${alias ? `|${alias}` : ""}]]`;
      targets.set(wikiLinkKey(target), visibleTarget ? targetId : null);
      if (value !== head.content.slice(start, end)) replacements.push({ start, end, value });
    });
    const visit = (node: Node) => {
      if ((node.type === "link" || node.type === "definition") && "url" in node && typeof node.url === "string") {
        let path = node.url;
        let origin = "";
        if (/^https?:\/\//.test(path)) {
          const url = new URL(path);
          if (url.origin === new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin) {
            origin = url.origin;
            path = url.pathname + url.search + url.hash;
          }
        }
        const match = /^\/(term|perspective|interpreter|school|disambiguation)\/([^/?#]+)(.*)$/.exec(path);
        const oldId = match ? pageIdFromKey(match[2]) : null;
        const targetId = oldId === null ? undefined : ids.get(oldId);
        const page = targetId === undefined ? undefined : byId.get(targetId);
        const start = node.position?.start.offset, end = node.position?.end.offset;
        if (page && match && start !== undefined && end !== undefined) {
          const title = titles.get(page.id);
          const url = origin + pagePath(page.type, title ? slugify(title) : page.slug, page.id) + match[3];
          const raw = head.content.slice(start, end);
          const delimiter = node.type === "definition" ? raw.indexOf("]:") : raw.indexOf("](");
          const offset = raw.indexOf(node.url, delimiter + 2);
          if (offset >= 0 && url !== node.url) replacements.push({ start: start + offset, end: start + offset + node.url.length, value: url });
        }
      }
      for (const child of (node as Parent).children ?? []) visit(child);
    };
    visit(tree);
    let content = head.content;
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) content = content.slice(0, replacement.start) + replacement.value + content.slice(replacement.end);
    result.set(head.pageId, { original: head.content, content, targets });
  }
  return result;
}

export async function preserveConsolidatedTargets(tx: Tx, pageId: number, targets: Map<string, number | null>) {
  await tx.delete(links).where(eq(links.sourcePageId, pageId));
  if (targets.size) await tx.insert(links).values([...targets].map(([targetName, targetPageId]) => ({ sourcePageId: pageId, targetName, targetPageId })));
}
