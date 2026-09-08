import Link from "next/link";
import { AgentPanel } from "@/components/agent-panel";
import { HistoryLink } from "@/components/history-link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { BacklinkPanel } from "@/components/backlink-panel";
import { Infobox, InfoboxLinks, WikiContent } from "@/components/wiki-content";
import { LocalGraph } from "@/components/local-graph";
import { PerspectiveList } from "@/components/perspective-list";
import { RelatedTermsPanel } from "@/components/related-terms";
import {
  getTermDetail,
  getTermDisambiguation,
  getHeadContent,
  getWikiLinkTargets,
  listBacklinks,
  listCategoriesOfTerm,
  listPerspectivesOfTerm,
} from "@/lib/content";
import { categoryPath } from "@/lib/categories";
import { countDiscussionPosts } from "@/lib/discussion";
import { getLocalGraph } from "@/lib/graph";
import { getInterestTags, expandInterestedInterpreters } from "@/lib/interests";
import { hasAnyInterest, reorderPerspectivesByInterest } from "@/lib/interest-tags";
import { renderMarkdown, wikiLinkResolver } from "@/lib/markdown";
import { listRelatedTerms } from "@/lib/recommend";
import { pageIdFromKey, pageKey, pagePath } from "@/lib/slug";
import { resolveLivePage } from "@/lib/resolve-page";
import { getSessionUser } from "@/lib/session";

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

  const [perspectives, categories, backlinks, disambiguation, sessionUser, localGraph, discussionCount] =
    await Promise.all([
      listPerspectivesOfTerm(page.id),
      listCategoriesOfTerm(page.id),
      listBacklinks(page.id),
      getTermDisambiguation(term.title),
      getSessionUser(),
      getLocalGraph(page.id, 1),
      countDiscussionPosts(page.id),
    ]);
  const board = perspectives.find((p) => p.isBoard);
  const others = perspectives.filter((p) => !p.isBoard);

  // 兴趣个性化（T12）：登录用户读账号兴趣（游客无服务端兴趣，客户端读 localStorage）。
  // 相关词条与视角重排共用同一份展开，不重复查询。
  const interests = sessionUser ? await getInterestTags(sessionUser.id) : null;
  const interestedInterpreterIds =
    interests && hasAnyInterest(interests)
      ? await expandInterestedInterpreters(interests)
      : new Set<number>();
  const relatedTerms = localGraph
    ? await listRelatedTerms(localGraph, interests, interestedInterpreterIds)
    : [];
  // 服务端预排（登录态 SSR 即个性化）；游客保持默认序，水合后客户端再排
  const orderedOthers =
    interestedInterpreterIds.size > 0
      ? reorderPerspectivesByInterest(others, interestedInterpreterIds)
      : others;

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
      <HistoryLink pageId={page.id} />

      <div className="flex flex-col gap-10 lg:flex-row lg:gap-10">
        <div className="min-w-0 flex-1">
          {disambiguation && (
            <p className="mb-3 rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
              「{disambiguation.title}」是同名多义概念：本页指{term.title}；其他含义见{" "}
              <Link
                href={pagePath("disambiguation", disambiguation.slug, disambiguation.id)}
                className="text-foreground underline-offset-4 hover:underline"
              >
                {disambiguation.title}（消歧义）
              </Link>
              。
            </p>
          )}

          <h1 className="text-3xl font-bold tracking-tight">{term.title}</h1>
          <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
            {term.summary}
          </p>
          <p className="mt-2 text-sm">
            <Link
              href={`/term/${pageKey(page.slug, page.id)}/discussion`}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              讨论区（{discussionCount} 楼）→
            </Link>
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
                html={renderMarkdown(
                  boardContent,
                  wikiLinkResolver(boardTargets ?? new Map()),
                )}
              />
            </section>
          )}

          <section aria-labelledby="perspectives-heading" className="mt-12">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="perspectives-heading" className="text-xl font-semibold">
                诠释者视角（{others.length}）
              </h2>
              {sessionUser && (
                <Link
                  href={`/new/perspective?term=${page.id}`}
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  撰写视角 +
                </Link>
              )}
            </div>
            {others.length > 0 ? (
              <PerspectiveList
                isAdmin={sessionUser?.role === "admin"}
                interestInterpreterIds={sessionUser ? [...interestedInterpreterIds] : null}
                items={orderedOthers.map((p) => ({
                  pageId: p.pageId,
                  title: p.title,
                  href: pagePath("perspective", p.slug, p.pageId),
                  interpreterId: p.interpreterId,
                  interpreterName: p.interpreterName,
                  interpreterHref: pagePath(
                    "interpreter",
                    p.interpreterSlug,
                    p.interpreterId,
                  ),
                  pinned: p.pinned,
                  linkCount: p.linkCount,
                }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                该词条暂无其他诠释者的视角。
              </p>
            )}
          </section>

          <RelatedTermsPanel items={relatedTerms} />

          <BacklinkPanel items={backlinks} />

          {localGraph && (
            <LocalGraph termId={page.id} termTitle={term.title} initialData={localGraph} />
          )}
        </div>

        <div className="shrink-0 lg:w-64">
          <AgentPanel key={page.id} termId={page.id} />
          <Infobox
            title={term.title}
            rows={[
              { label: "类型", content: "词条（聚合枢纽）" },
              {
                label: "别名",
                content: term.aliases.length > 0 ? term.aliases.join("、") : "—",
              },
              {
                label: "分类",
                content: (
                  <InfoboxLinks
                    items={categories.map((category) => ({
                      key: String(category.id),
                      label: category.name,
                      href: categoryPath(category.slug),
                    }))}
                  />
                ),
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
