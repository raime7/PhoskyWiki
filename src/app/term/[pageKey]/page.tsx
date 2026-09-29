import { hasAdminRole } from "@/lib/roles";
import { PageContainer } from "@/components/page-container";
import { PageAction } from "@/components/page-action";
import { PageComments } from "@/components/page-comments";
import { KeyTexts } from "@/components/key-texts";
import Link from "next/link";
import { AgentPanel } from "@/components/agent-panel";
import { HistoryLink } from "@/components/history-link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { BacklinkPanel } from "@/components/backlink-panel";
import { Infobox, InfoboxLinks } from "@/components/wiki-content";
import { LocalGraph } from "@/components/local-graph";
import { TermDiscoveryPanel } from "@/components/term-discovery";
import {
  getTermDetail,
  listBacklinks,
  listCategoriesOfTerm,
  listPerspectivesOfTerm,
} from "@/lib/content";
import { categoryPath } from "@/lib/categories";

import { getLocalGraph } from "@/lib/graph";
import { getInterestTags } from "@/lib/interests";
import { getTermDiscovery } from "@/lib/term-discovery";
import { pageIdFromKey, pageKey } from "@/lib/slug";
import { resolveLivePage } from "@/lib/resolve-page";
import { getSessionUser } from "@/lib/session";
import { TermHubHeader } from "@/components/term-hub-header";
import { listPerspectiveExcerpts } from "@/lib/perspective-excerpt";

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

  const [perspectives, categories, backlinks, sessionUser, localGraph] =
    await Promise.all([
      listPerspectivesOfTerm(page.id),
      listCategoriesOfTerm(page.id),
      listBacklinks(page.id),
      getSessionUser(),
      getLocalGraph(page.id, 1),
    ]);

  const interests = sessionUser ? await getInterestTags(sessionUser.id) : null;
  const discovery = await getTermDiscovery(page.id, interests);
  if (!discovery) notFound();
  const excerpts = await listPerspectiveExcerpts(discovery.perspectives.map(p => p.pageId));
  const actions = (
    <>
      <HistoryLink pageId={page.id} />
      {sessionUser && <Link href={`/edit/${pageKey(page.slug, page.id)}`}>编辑词条信息</Link>}
      {hasAdminRole(sessionUser?.role) && (
        <PageAction pageId={page.id} action="delete" deleteTerm={{ title: term.title, perspectiveCount: perspectives.length }} />
      )}
    </>
  );

  // 继续探索索引（#97）：只链接真实存在的区块。
  const exploreNav = (
    <nav aria-label="继续探索索引" className="flex flex-wrap gap-x-5 gap-y-1 pb-1 text-sm">
      {discovery.relatedTerms.length > 0 && <a href="#related-terms-heading" className="py-1">相关词条</a>}
      <a href="#backlinks-heading" className="py-1">反链</a>
      {localGraph && <a href="#local-graph-heading" className="py-1">局部图谱</a>}
    </nav>
  );

  return (
    <PageContainer className="max-w-[1408px] [overflow-wrap:anywhere]">
      <TermHubHeader title={term.title} summary={term.summary} perspectiveCount={discovery.perspectives.length} actions={actions} />

      <TermDiscoveryPanel
        excerpts={excerpts}
        termId={page.id}
        initial={discovery}
        guest={!sessionUser}
        resources={
          <section aria-labelledby="term-resources-heading" className="mt-12 border-t-(length:--rule) border-foreground pt-8">
            <h2 id="term-resources-heading" className="text-2xl font-black">词条资料</h2>
            <p className="mt-2 text-sm text-muted-foreground">概念的别名、分类与已有参考作品。</p>
            <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-2">
              <Infobox
                title={term.title}
                rows={[
                  { label: "类型", content: "词条（聚合枢纽）" },
                  { label: "别名", content: term.aliases.length > 0 ? term.aliases.join("、") : "暂无别名" },
                  {
                    label: "分类",
                    content: (
                      <InfoboxLinks
                        empty="暂无分类"
                        items={categories.map((category) => ({
                          key: String(category.id), label: category.name, href: categoryPath(category.slug),
                        }))}
                      />
                    ),
                  },
                  { label: "视角", content: `${perspectives.length} 个` },
                  ...(term.keyTexts.length ? [{ label: "关键文本", content: <KeyTexts items={term.keyTexts} /> }] : []),
                ]}
              />
              <div id="term-agent" className="min-w-0">
                <AgentPanel key={page.id} termId={page.id} />
              </div>
            </div>
          </section>
        }
        exploreNav={exploreNav}
      >
        <BacklinkPanel items={backlinks} />
        {localGraph && <LocalGraph termId={page.id} termTitle={term.title} initialData={localGraph} />}
      </TermDiscoveryPanel>
      <PageComments pageId={page.id} href={`/term/${pageKey(page.slug, page.id)}`} title="词条总评论" user={sessionUser} />
    </PageContainer>
  );
}
