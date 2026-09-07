// 全站搜索页（T10/ADR-0002）：服务端直查 SearchIndex 端口，
// 按类型分面过滤（词条/诠释者/视角 + 讨论预留维度，讨论区落地前恒为空）。
// 请求期执行（q 每次不同），结果高亮片段已按 highlightHtml 转义。

import Link from "next/link";

import { SearchBox } from "@/components/search-box";
import { getSearchIndex } from "@/lib/search/search-service";
import {
  SEARCH_TYPES,
  SEARCH_TYPE_LABELS,
  highlightHtml,
  parseSearchParams,
  searchHitHref,
  type ParsedSearchParams,
  type SearchFacets,
  type SearchHit,
} from "@/lib/search/search-types";

export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const parsed = parseSearchParams(await searchParams);
  const result = parsed.q ? await runSearch(parsed) : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">全站搜索</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        覆盖词条名、诠释者名与视角正文；支持即打即搜联想。
      </p>
      <div className="mt-6">
        <SearchBox initialQuery={parsed.q} autoFocus size="lg" />
      </div>

      {result?.error && (
        <p role="alert" className="mt-8 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          搜索服务暂时不可用，请稍后重试。
        </p>
      )}

      {result && !result.error && (
        <>
          <nav aria-label="类型分面" className="mt-8 flex flex-wrap items-center gap-2 border-b border-border pb-3">
            {/* 全部 = 各类型计数之和（分面计数不受当前 type 过滤约束，端口契约） */}
            <FacetTab
              label="全部"
              count={Object.values(result.facets).reduce<number>((sum, count) => sum + (count ?? 0), 0)}
              href={facetHref(parsed.q, null)}
              active={parsed.type === null}
            />
            {SEARCH_TYPES.map((type) => (
              <FacetTab
                key={type}
                label={SEARCH_TYPE_LABELS[type]}
                count={result.facets[type] ?? 0}
                href={facetHref(parsed.q, type)}
                active={parsed.type === type}
              />
            ))}
          </nav>

          {result.hits.length === 0 ? (
            <p className="mt-8 text-sm text-muted-foreground">
              没有与「{parsed.q}」匹配的内容。
            </p>
          ) : (
            <>
              <ul className="mt-6 flex flex-col gap-5" data-testid="search-results">
                {result.hits.map((hit) => (
                  <li key={`${hit.type}-${hit.pageId}`}>
                    <Link
                      href={searchHitHref(hit)}
                      className="text-lg font-medium underline-offset-4 hover:underline"
                      dangerouslySetInnerHTML={{ __html: highlightHtml(hit.title) }}
                    />
                    <span className="ml-2 align-middle rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {SEARCH_TYPE_LABELS[hit.type]}
                    </span>
                    {hit.snippet && (
                      <p
                        className="mt-1 line-clamp-3 text-sm text-muted-foreground [&_mark]:bg-primary/15 [&_mark]:text-foreground"
                        dangerouslySetInnerHTML={{ __html: hit.snippet }}
                      />
                    )}
                  </li>
                ))}
              </ul>
              <Pagination parsed={parsed} total={result.total} />
            </>
          )}
        </>
      )}
    </main>
  );
}

async function runSearch(parsed: ParsedSearchParams): Promise<
  { error: false; hits: SearchHit[]; total: number; facets: SearchFacets } | { error: true }
> {
  try {
    const result = await getSearchIndex().search(parsed.q, {
      type: parsed.type,
      limit: parsed.limit,
      offset: parsed.offset,
    });
    return { error: false, ...result };
  } catch (err) {
    console.error("搜索页查询失败：", err);
    return { error: true };
  }
}

/** 分面 tab 与分页共用的 /search 查询串。 */
function facetHref(q: string, type: ParsedSearchParams["type"], offset = 0): string {
  const params = new URLSearchParams({ q });
  if (type) params.set("type", type);
  if (offset > 0) params.set("offset", String(offset));
  return `/search?${params.toString()}`;
}

function FacetTab({
  label,
  count,
  href,
  active,
}: {
  label: string;
  count: number;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1 text-sm transition-colors ${
        active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {label}
      <span className="ml-1 text-xs opacity-70">{count}</span>
    </Link>
  );
}

function Pagination({ parsed, total }: { parsed: ParsedSearchParams; total: number }) {
  const prevOffset = Math.max(0, parsed.offset - parsed.limit);
  const nextOffset = parsed.offset + parsed.limit;
  return (
    <nav aria-label="分页" className="mt-8 flex items-center justify-between text-sm">
      {parsed.offset > 0 ? (
        <Link href={facetHref(parsed.q, parsed.type, prevOffset)} className="text-muted-foreground hover:text-foreground">上一页</Link>
      ) : (
        <span />
      )}
      {nextOffset < total && (
        <Link href={facetHref(parsed.q, parsed.type, nextOffset)} className="text-muted-foreground hover:text-foreground">下一页</Link>
      )}
    </nav>
  );
}
