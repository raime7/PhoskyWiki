import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { getCategoryDetailBySlug } from "@/lib/content";
import { categoryPath } from "@/lib/categories";
import { decodePageKey, pagePath } from "@/lib/slug";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const category = await getCategoryDetailBySlug(decodePageKey((await params).slug));
  return category ? { title: `分类：${category.name} · PhoskyWiki` } : {};
}

export default async function CategoryPage({ params }: Params) {
  const category = await getCategoryDetailBySlug(decodePageKey((await params).slug));
  if (!category) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <Link href="/categories" className="hover:text-foreground">
          分类
        </Link>
        {category.path.map((ancestor) => (
          <span key={ancestor.id} className="flex items-center">
            <span className="mx-1.5">/</span>
            <Link href={categoryPath(ancestor.slug)} className="hover:text-foreground">
              {ancestor.name}
            </Link>
          </span>
        ))}
        <span className="mx-1.5">/</span>
        <span aria-current="page">{category.name}</span>
      </nav>

      <h1 className="text-3xl font-bold tracking-tight">{category.name}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        分类 · {category.terms.length} 个词条
        {category.children.length > 0 && ` · ${category.children.length} 个子分类`}
      </p>

      {category.children.length > 0 && (
        <section aria-labelledby="children-heading" className="mt-8">
          <h2 id="children-heading" className="mb-3 text-lg font-semibold">
            子分类
          </h2>
          <ul className="flex flex-wrap gap-2">
            {category.children.map((child) => (
              <li key={child.id}>
                <Link
                  href={categoryPath(child.slug)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm hover:border-foreground/40"
                >
                  {child.name}
                  <span className="text-xs text-muted-foreground">{child.termCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="terms-heading" className="mt-10">
        <h2 id="terms-heading" className="mb-4 text-xl font-semibold">
          词条（{category.terms.length}）
        </h2>
        {category.terms.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {category.terms.map((term) => (
              <li key={term.id} className="px-4 py-3">
                <Link
                  href={pagePath("term", term.slug, term.id)}
                  className="font-medium hover:underline"
                >
                  {term.title}
                </Link>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {term.summary}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">该分类下暂无词条。</p>
        )}
      </section>
    </main>
  );
}
