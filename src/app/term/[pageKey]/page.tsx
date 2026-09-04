import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Infobox, WikiContent } from "@/components/wiki-content";
import { PerspectiveList } from "@/components/perspective-list";
import {
  getTermDetail,
  getHeadContent,
  getWikiLinkTargets,
  listPerspectivesOfTerm,
} from "@/lib/content";
import { renderMarkdown } from "@/lib/markdown";
import { pageIdFromKey, pagePath } from "@/lib/slug";
import { resolveLivePage } from "@/lib/resolve-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pageKey: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = pageIdFromKey((await params).pageKey);
  if (!id) return {};
  const term = await getTermDetail(id);
  return term ? { title: term.title, description: term.summary } : {};
}

export default async function TermPage({ params }: Params) {
  const page = await resolveLivePage("term", (await params).pageKey);
  const term = await getTermDetail(page.id);
  if (!term) notFound();

  const perspectives = await listPerspectivesOfTerm(page.id);
  const board = perspectives.find((p) => p.isBoard);
  const others = perspectives.filter((p) => !p.isBoard);
  const [boardContent, boardTargets] = board
    ? await Promise.all([getHeadContent(board.pageId), getWikiLinkTargets(board.pageId)])
    : [null, null];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <span aria-current="page">{term.title}</span>
      </nav>

      <div className="flex flex-col gap-10 lg:flex-row lg:gap-10">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold tracking-tight">{term.title}</h1>
          <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
            {term.summary}
          </p>

          {board && boardContent !== null && (
            <section aria-labelledby="board-heading" className="mt-10 scroll-mt-20">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 id="board-heading" className="text-xl font-semibold">
                  编委会 · 通俗视角
                </h2>
                <Link
                  href={pagePath("perspective", board.slug, board.pageId)}
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  查看视角页 →
                </Link>
              </div>
              <WikiContent
                html={renderMarkdown(boardContent, (name) =>
                  boardTargets?.get(name) ?? { href: "", exists: false },
                )}
              />
            </section>
          )}

          <section aria-labelledby="perspectives-heading" className="mt-12">
            <h2 id="perspectives-heading" className="mb-4 text-xl font-semibold">
              诠释者视角（{others.length}）
            </h2>
            {others.length > 0 ? (
              <PerspectiveList
                items={others.map((p) => ({
                  pageId: p.pageId,
                  title: p.title,
                  href: pagePath("perspective", p.slug, p.pageId),
                  interpreterName: p.interpreterName,
                  interpreterHref: pagePath(
                    "interpreter",
                    p.interpreterSlug,
                    p.interpreterId,
                  ),
                  linkCount: p.linkCount,
                }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                该词条暂无其他诠释者的视角。
              </p>
            )}
          </section>
        </div>

        <div className="shrink-0 lg:w-64">
          <Infobox
            title={term.title}
            rows={[
              { label: "类型", content: "词条（聚合枢纽）" },
              {
                label: "别名",
                content: term.aliases.length > 0 ? term.aliases.join("、") : "—",
              },
              { label: "视角", content: `${perspectives.length} 个（含通俗视角）` },
              {
                label: "通俗视角",
                content: board ? "已发布" : "暂缺",
              },
            ]}
          />
        </div>
      </div>
    </main>
  );
}
