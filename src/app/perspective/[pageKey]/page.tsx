import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Infobox, WikiContent } from "@/components/wiki-content";
import {
  getHeadContent,
  getPerspectiveDetail,
  getWikiLinkTargets,
} from "@/lib/content";
import { renderMarkdown } from "@/lib/markdown";
import { decodePageKey, pagePath, parsePageKey } from "@/lib/slug";
import { resolveLivePage } from "@/lib/resolve-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pageKey: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = parsePageKey(decodePageKey((await params).pageKey));
  if (!id) return {};
  const detail = await getPerspectiveDetail(id);
  return detail
    ? {
        title: detail.title,
        description: `${detail.interpreterName}对「${detail.termTitle}」的诠释视角 · PhoskyWiki`,
      }
    : {};
}

function years(birth?: number | null, death?: number | null): string {
  if (birth && death) return `${birth}–${death}`;
  if (birth) return `${birth}–`;
  return "—";
}

export default async function PerspectivePage({ params }: Params) {
  const page = await resolveLivePage("perspective", (await params).pageKey);
  const detail = await getPerspectiveDetail(page.id);
  if (!detail) notFound();

  const content = await getHeadContent(page.id);
  if (content === null) notFound();

  const targets = await getWikiLinkTargets(page.id);
  const html = renderMarkdown(content, (name) =>
    targets.get(name) ?? { href: "", exists: false },
  );

  const termHref = pagePath("term", detail.termSlug, detail.termId);
  const interpreterHref = pagePath(
    "interpreter",
    detail.interpreterSlug,
    detail.interpreterId,
  );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={termHref} className="hover:text-foreground">
          {detail.termTitle}
        </Link>
        <span className="mx-1.5">/</span>
        <span aria-current="page">{detail.title}</span>
      </nav>

      <div className="flex flex-col gap-10 lg:flex-row lg:gap-10">
        <article className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold tracking-tight">{detail.title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            <Link href={interpreterHref} className="underline-offset-4 hover:underline">
              {detail.interpreterName}
            </Link>
            <span className="mx-1.5">·</span>
            属于词条{" "}
            <Link href={termHref} className="underline-offset-4 hover:underline">
              {detail.termTitle}
            </Link>
            {detail.isBoard && (
              <span className="ml-2 rounded bg-secondary px-1.5 py-0.5">通俗视角</span>
            )}
          </p>

          <div className="mt-8">
            <WikiContent html={html} />
          </div>
        </article>

        <div className="shrink-0 lg:w-64">
          <Infobox
            title={detail.title}
            rows={[
              {
                label: "类型",
                content: "视角（原子知识单位）",
              },
              {
                label: "所属词条",
                content: <Link href={termHref}>{detail.termTitle}</Link>,
              },
              {
                label: "诠释者",
                content: <Link href={interpreterHref}>{detail.interpreterName}</Link>,
              },
              {
                label: "生卒",
                content: detail.isBoard
                  ? "—（站方集体）"
                  : years(detail.interpreterBirthYear, detail.interpreterDeathYear),
              },
              { label: "站内引用", content: `${targets.size} 条双链来源` },
            ]}
          />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            红色虚线标记的词条尚未创建——那是留给写作者的缺口。
          </p>
        </div>
      </div>
    </main>
  );
}
