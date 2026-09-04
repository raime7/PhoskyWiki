import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { WikiContent } from "@/components/wiki-content";
import { getDisambiguationDetail, getHeadContent, getWikiLinkTargets } from "@/lib/content";
import { renderMarkdown, wikiLinkResolver } from "@/lib/markdown";
import { pageIdFromKey, pagePath } from "@/lib/slug";
import { resolveLivePage } from "@/lib/resolve-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pageKey: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = pageIdFromKey((await params).pageKey);
  if (!id) return {};
  const detail = await getDisambiguationDetail(id);
  return detail
    ? {
        title: `${detail.title}（消歧义）`,
        description: `「${detail.title}」的同名多义词条分流 · PhoskyWiki`,
      }
    : {};
}

export default async function DisambiguationPage({ params }: Params) {
  const page = await resolveLivePage("disambiguation", (await params).pageKey);
  const detail = await getDisambiguationDetail(page.id);
  if (!detail) notFound();

  const content = await getHeadContent(page.id);
  const targets = content !== null ? await getWikiLinkTargets(page.id) : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <span aria-current="page">{detail.title}（消歧义）</span>
      </nav>

      <article>
        <h1 className="text-3xl font-bold tracking-tight">{detail.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          同名多义词条分流页——「{detail.title}」在站内有以下含义：
        </p>

        {content !== null && targets !== null && (
          <div className="mt-6">
            <WikiContent html={renderMarkdown(content, wikiLinkResolver(targets))} />
          </div>
        )}

        <ul className="mt-6 divide-y divide-border rounded-lg border border-border">
          {detail.members.map((member) => (
            <li key={member.id} className="px-4 py-3">
              <Link
                href={pagePath("term", member.slug, member.id)}
                className="font-medium underline-offset-4 hover:underline"
              >
                {member.title}
              </Link>
              <span className="ml-2 text-xs text-muted-foreground">
                {member.perspectiveCount} 个视角
              </span>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {member.summary}
              </p>
            </li>
          ))}
        </ul>
        {detail.members.length === 0 && (
          <p className="mt-6 text-sm text-muted-foreground">
            尚无以「{detail.title}」为名的词条。
          </p>
        )}
      </article>
    </main>
  );
}
