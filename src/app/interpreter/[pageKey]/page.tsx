import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Infobox } from "@/components/wiki-content";
import { getInterpreterDetail, listPerspectivesOfInterpreter } from "@/lib/content";
import { decodePageKey, pagePath, parsePageKey } from "@/lib/slug";
import { resolveLivePage } from "@/lib/resolve-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pageKey: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = parsePageKey(decodePageKey((await params).pageKey));
  if (!id) return {};
  const interpreter = await getInterpreterDetail(id);
  return interpreter
    ? { title: interpreter.title, description: interpreter.summary }
    : {};
}

export default async function InterpreterPage({ params }: Params) {
  const page = await resolveLivePage("interpreter", (await params).pageKey);
  const [interpreter, perspectives] = await Promise.all([
    getInterpreterDetail(page.id),
    listPerspectivesOfInterpreter(page.id),
  ]);
  if (!interpreter) notFound();

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <span aria-current="page">{interpreter.title}</span>
      </nav>

      <div className="flex flex-col gap-10 lg:flex-row lg:gap-10">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold tracking-tight">{interpreter.title}</h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">
            {interpreter.summary}
          </p>

          <section aria-labelledby="index-heading" className="mt-10">
            <h2 id="index-heading" className="mb-4 text-xl font-semibold">
              视角索引（{perspectives.length}）
            </h2>
            {perspectives.length > 0 ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {perspectives.map((p) => (
                  <li key={p.pageId} className="px-4 py-3">
                    <Link
                      href={pagePath("perspective", p.slug, p.pageId)}
                      className="font-medium hover:underline"
                    >
                      {p.title}
                    </Link>
                    <span className="ml-2 text-sm text-muted-foreground">
                      词条{" "}
                      <Link
                        href={pagePath("term", p.termSlug, p.termId)}
                        className="hover:text-foreground hover:underline"
                      >
                        {p.termTitle}
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                该诠释者还没有已收录的视角。
              </p>
            )}
          </section>
        </div>

        <div className="shrink-0 lg:w-64">
          <Infobox
            title={interpreter.title}
            rows={[
              {
                label: "类型",
                content: interpreter.isBoard ? "编委会（特殊诠释者）" : "诠释者",
              },
              {
                label: "生卒",
                content: interpreter.isBoard
                  ? "—"
                  : (interpreter.birthYear ?? interpreter.deathYear)
                    ? `${interpreter.birthYear ?? "?"}–${interpreter.deathYear ?? "?"}`
                    : "—",
              },
              { label: "视角", content: `${perspectives.length} 个` },
            ]}
          />
        </div>
      </div>
    </main>
  );
}
