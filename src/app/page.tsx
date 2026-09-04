import Link from "next/link";

import { Button } from "@/components/ui/button";
import { listTerms } from "@/lib/content";
import { pagePath } from "@/lib/slug";

export const dynamic = "force-dynamic";

export default async function Home() {
  const terms = await listTerms();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4">
      <section className="flex flex-col items-center gap-8 px-4 py-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight">PhoskyWiki</h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          每个词条是一个聚合枢纽，其下聚合各诠释者的视角。
          在这里，同一概念的不同立场叙述并列可见。
        </p>
        <div className="flex gap-6 text-sm text-muted-foreground">
          <span>词条 × 视角</span>
          <span>·</span>
          <span>三轴导航</span>
          <span>·</span>
          <span>双链与图谱</span>
        </div>
        <Button asChild size="lg">
          <a href="#terms">开始浏览</a>
        </Button>
      </section>

      <section id="terms" aria-labelledby="terms-heading" className="scroll-mt-20 pb-16">
        <h2 id="terms-heading" className="mb-6 text-xl font-semibold">
          词条
        </h2>
        {terms.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2">
            {terms.map((term) => (
              <li
                key={term.id}
                className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/30"
              >
                <Link
                  href={pagePath("term", term.slug, term.id)}
                  className="text-lg font-semibold underline-offset-4 hover:underline"
                >
                  {term.title}
                </Link>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {term.summary}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {term.perspectiveCount} 个视角
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            暂无词条。本地开发可运行 <code>pnpm db:seed</code> 灌入演示内容。
          </p>
        )}
      </section>
    </main>
  );
}
