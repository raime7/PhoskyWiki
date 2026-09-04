import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Infobox } from "@/components/wiki-content";
import {
  getSchoolDetail,
  listSchoolCoreTerms,
  listSchoolMembers,
} from "@/lib/content";
import { formatYears } from "@/lib/format";
import { pageIdFromKey, pagePath } from "@/lib/slug";
import { resolveLivePage } from "@/lib/resolve-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pageKey: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = pageIdFromKey((await params).pageKey);
  if (!id) return {};
  const school = await getSchoolDetail(id);
  return school ? { title: school.title, description: school.summary } : {};
}

export default async function SchoolPage({ params }: Params) {
  const page = await resolveLivePage("school", (await params).pageKey);
  const [school, members, coreTerms] = await Promise.all([
    getSchoolDetail(page.id),
    listSchoolMembers(page.id),
    listSchoolCoreTerms(page.id),
  ]);
  if (!school) notFound();

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <Link href="/schools" className="hover:text-foreground">
          学派
        </Link>
        <span className="mx-1.5">/</span>
        <span aria-current="page">{school.title}</span>
      </nav>

      <div className="flex flex-col gap-10 lg:flex-row lg:gap-10">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold tracking-tight">{school.title}</h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">
            {school.summary}
          </p>

          <section aria-labelledby="members-heading" className="mt-10">
            <h2 id="members-heading" className="mb-4 text-xl font-semibold">
              成员诠释者（{members.length}）
            </h2>
            {members.length > 0 ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {members.map((member) => (
                  <li key={member.interpreterId} className="px-4 py-3">
                    <Link
                      href={pagePath("interpreter", member.slug, member.interpreterId)}
                      className="font-medium hover:underline"
                    >
                      {member.name}
                    </Link>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {formatYears(member.birthYear, member.deathYear)} ·{" "}
                      {member.perspectiveCount} 个视角
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">该学派暂无成员诠释者。</p>
            )}
          </section>

          <section aria-labelledby="core-terms-heading" className="mt-10">
            <h2 id="core-terms-heading" className="mb-2 text-xl font-semibold">
              学派核心词条（{coreTerms.length}）
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              学派不直接挂载词条——核心词条由成员视角聚合派生，按成员视角数排序。
            </p>
            {coreTerms.length > 0 ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {coreTerms.map((term) => (
                  <li key={term.termId} className="flex items-baseline justify-between gap-3 px-4 py-3">
                    <Link
                      href={pagePath("term", term.slug, term.termId)}
                      className="font-medium hover:underline"
                    >
                      {term.title}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      成员视角 {term.perspectiveCount} 篇
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                成员还没有已收录的视角，暂无法派生核心词条。
              </p>
            )}
          </section>
        </div>

        <div className="shrink-0 lg:w-64">
          <Infobox
            title={school.title}
            rows={[
              { label: "类型", content: "学派（诠释者分组）" },
              { label: "成员", content: `${members.length} 位诠释者` },
              { label: "核心词条", content: `${coreTerms.length} 个（成员视角派生）` },
            ]}
          />
        </div>
      </div>
    </main>
  );
}
