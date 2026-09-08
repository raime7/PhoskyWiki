import Link from "next/link";

import { SearchBox } from "@/components/search-box";
import { listRecentPerspectives, listSchools, listTerms } from "@/lib/content";
import { getSessionUser } from "@/lib/session";
import { getInterestTags } from "@/lib/interests";
import { hasAnyInterest } from "@/lib/interest-tags";
import { listHomeRecommendations } from "@/lib/recommend";
import { pagePath } from "@/lib/slug";

export const dynamic = "force-dynamic";

const entrances = [
  { href: "/terms", title: "词条索引", description: "从概念进入" },
  { href: "/interpreters", title: "诠释者索引", description: "沿思想家阅读" },
  { href: "/schools", title: "学派入口", description: "在思想谱系中漫游" },
];

export default async function Home() {
  const [terms, recent, schools, user] = await Promise.all([
    listTerms(), listRecentPerspectives(), listSchools(), getSessionUser(),
  ]);
  const interests = user ? await getInterestTags(user.id) : null;
  const recommendations = interests ? await listHomeRecommendations(interests) : [];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16">
      <section className="border-b border-border py-14 sm:py-20" aria-label="探索知识">
        <p className="text-xs font-medium tracking-[0.22em] text-muted-foreground">哲学 / 政治经济学 / 历史</p>
        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">PhoskyWiki</h1>
        <p className="mt-5 max-w-2xl font-serif text-2xl leading-relaxed sm:text-3xl">一个概念，多种思想的交汇。</p>
        <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">从问题开始，在不同诠释者的视角之间阅读、比较与追问。</p>
        <div className="mt-8 max-w-3xl">
          <SearchBox size="lg" />
          <p className="mt-3 text-xs text-muted-foreground">试着搜索「主体性」「剩余价值」，或一位思想家的名字。</p>
        </div>
        <nav aria-label="三轴入口" className="mt-10 grid gap-3 sm:grid-cols-3">
          {entrances.map((entrance, index) => (
            <Link key={entrance.href} href={entrance.href} className="rounded-lg border border-border p-4 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-4">
              <span className="text-xs text-muted-foreground">0{index + 1} / {entrance.description}</span>
              <span className="mt-3 flex items-center justify-between font-semibold">{entrance.title}<span aria-hidden="true">↗</span></span>
            </Link>
          ))}
        </nav>
      </section>

      {user && <section className="mt-10 rounded-lg border border-border bg-muted/40 p-6" aria-labelledby="for-you-heading">
        <h2 id="for-you-heading" className="text-xl font-semibold">为你发现</h2>
        <p className="mt-3 text-sm text-muted-foreground">{recommendations.length > 0
          ? "根据你关注的诠释者、学派与主题，继续探索这些词条。"
          : interests && hasAnyInterest(interests)
            ? "暂时没有匹配你兴趣的词条，可以调整兴趣或浏览本周概念。"
            : "选择感兴趣的诠释者、学派与主题，找到下一步的阅读方向。"}</p>
        {recommendations.length > 0 && <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {recommendations.map((term) => <li key={term.id} className="min-w-0">
            <Link href={pagePath("term", term.slug, term.id)} className="flex h-full flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background p-4 hover:border-foreground/40">
              <span className="break-words font-medium">{term.title}</span>
              <span className="text-xs text-muted-foreground">{term.interestMatchCount} 项兴趣匹配</span>
            </Link>
          </li>)}
        </ul>}
        <Link href="/interests" className="mt-4 inline-block text-sm underline underline-offset-4">{interests && hasAnyInterest(interests) ? "调整兴趣标签" : "设置兴趣标签"}</Link>
      </section>}

      <section id="terms" aria-labelledby="terms-heading" className="scroll-mt-32 py-12">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div><p className="mb-2 text-xs tracking-widest text-muted-foreground">THE CONCEPTS</p><h2 id="terms-heading" className="text-2xl font-semibold">本周概念</h2></div>
          <Link href="/terms" className="text-sm underline underline-offset-4">浏览全部 {terms.length} 个词条</Link>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {terms.slice(0, 6).map((term, index) => (
            <li key={term.id} className={`min-w-0 rounded-lg border p-6 ${index === 0 ? "border-stone-800 bg-stone-900 text-stone-50" : "border-border bg-card"}`}>
              <p className={`mb-6 text-xs ${index === 0 ? "text-stone-300" : "text-muted-foreground"}`}>0{index + 1} / {term.perspectiveCount} 个视角</p>
              <Link href={pagePath("term", term.slug, term.id)} className="break-words font-serif text-2xl font-semibold underline-offset-4 hover:underline">{term.title}</Link>
              <p className={`mt-4 break-words text-sm leading-7 ${index === 0 ? "text-stone-300" : "text-muted-foreground"}`}>{term.summary}</p>
            </li>
          ))}
        </ul>
        {terms.length === 0 && <p className="text-muted-foreground">本周概念正在准备中。欢迎参与共建。</p>}
      </section>

      <section aria-labelledby="recent-heading" className="border-t border-border py-12">
        <p className="mb-2 text-xs tracking-widest text-muted-foreground">NEW PERSPECTIVES</p>
        <h2 id="recent-heading" className="text-2xl font-semibold">新视角</h2>
        <p className="mt-3 text-sm text-muted-foreground">最近发布的诠释，为熟悉的问题打开另一扇窗。</p>
        <ul className="mt-6 grid gap-x-8 sm:grid-cols-2">
          {recent.map((perspective) => (
            <li key={perspective.id} className="min-w-0 border-b border-border py-5">
              <p className="mb-2 text-xs text-muted-foreground">{perspective.interpreterName} / {perspective.termTitle}</p>
              <Link href={pagePath("perspective", perspective.slug, perspective.id)} className="break-words text-lg font-medium underline-offset-4 hover:underline">{perspective.title}</Link>
            </li>
          ))}
        </ul>
        {recent.length === 0 && <p className="mt-6 text-muted-foreground">还没有发布的视角。</p>}
      </section>

      <section aria-labelledby="schools-heading" className="border-t border-border pt-12">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div><p className="mb-2 text-xs tracking-widest text-muted-foreground">SCHOOLS OF THOUGHT</p><h2 id="schools-heading" className="text-2xl font-semibold">学派巡礼</h2></div>
          <Link href="/schools" className="text-sm underline underline-offset-4">探索全部学派</Link>
        </div>
        <ul className="grid gap-4 sm:grid-cols-3">
          {schools.slice(0, 3).map((school) => (
            <li key={school.id} className="min-w-0 rounded-lg border border-border bg-muted/40 p-6">
              <p className="mb-5 text-xs text-muted-foreground">{school.memberCount} 位诠释者 · {school.coreTermCount} 个核心词条</p>
              <Link href={pagePath("school", school.slug, school.id)} className="break-words font-serif text-xl font-semibold underline-offset-4 hover:underline">{school.title}</Link>
              <p className="mt-3 break-words text-sm leading-7 text-muted-foreground">{school.summary}</p>
            </li>
          ))}
        </ul>
        {schools.length === 0 && <p className="text-muted-foreground">学派巡礼正在准备中。</p>}
      </section>
    </main>
  );
}
