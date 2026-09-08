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

/** AST 的 url 已解码，须按原始 Markdown 目的地址边界替换，而非搜索解码后的文字。 */
function destinationRange(raw: string, node: Node, start: number) {
  const lastChildEnd = (node as Parent).children?.at(-1)?.position?.end.offset;
  const definition = /^\[(?:\\.|[^\]\\])*\]:/.exec(raw);
  let from = node.type === "definition" ? definition?.[0].length ?? -1 : raw.indexOf("](", lastChildEnd === undefined ? 0 : lastChildEnd - start) + 2;
  if (from < 2) return null;
  while (/\s/.test(raw[from] ?? "") && from < raw.length) from++;
  const angled = raw[from] === "<";
  let depth = 0;
  for (let end = from + Number(angled); end < raw.length; end++) {
    if (raw[end] === "\\") { end++; continue; }
    if (angled) {
      if (raw[end] === ">") return { from, to: end + 1 };
    } else {
      if ((raw[end] === ")" && depth === 0) || /\s/.test(raw[end])) return { from, to: end };
      if (raw[end] === "(") depth++;
      if (raw[end] === ")") depth--;
    }
  }
  return angled ? null : { from, to: raw.length };
}

/** 在删来源之前按已解析 id 规范化每份正文，避免来源之间的同名键互相抢占。 */
export async function prepareConsolidationLinks(tx: Tx, ids: Map<number, number>, titles: Map<number, string>, names: Map<string, string>, removed: Set<number>, combinedSources: Set<number>) {
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
    const referenceNames = new Map<string, string>();
    const referenceName = (identifier: string) => {
      if (!referenceNames.has(identifier)) referenceNames.set(identifier, `source-${head.pageId}-ref-${referenceNames.size + 1}`);
      return referenceNames.get(identifier)!;
    };
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
      // Markdown 定义的作用域是整篇正文；合并来源必须隔离标记，保留各章原目标。
      if (combinedSources.has(head.pageId) && "identifier" in node && typeof node.identifier === "string") {
        const start = node.position?.start.offset, end = node.position?.end.offset;
        if (start !== undefined && end !== undefined) {
          const raw = head.content.slice(start, end);
          const name = referenceName(node.identifier);
          if (node.type === "definition") {
            const label = /^\[(?:\\.|[^\]\\])*\]:/.exec(raw);
            if (label) replacements.push({ start, end: start + label[0].length - 1, value: `[${name}]` });
          } else if (node.type === "linkReference" || node.type === "imageReference") {
            const label = "referenceType" in node && node.referenceType !== "shortcut" ? /\[(?:\\.|[^\]\\])*\]$/.exec(raw) : null;
            replacements.push({ start: label ? end - label[0].length : end, end, value: `[${name}]` });
          }
        }
      }
      if ((node.type === "link" || node.type === "definition") && "url" in node && typeof node.url === "string") {
        let path = node.url;
        let origin = "";
        if (/^https?:\/\//.test(path) && URL.canParse(path)) {
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
          const range = destinationRange(raw, node, start);
          if (range && url !== node.url) replacements.push({ start: start + range.from, end: start + range.to, value: `<${url.replaceAll("&", "&amp;").replaceAll("<", "%3C").replaceAll(">", "%3E").replaceAll("\\", "%5C")}>` });
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
