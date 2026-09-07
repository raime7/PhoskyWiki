import Link from "next/link";
import { notFound } from "next/navigation";
import { PageAction } from "@/components/page-action";
import { RevisionDiff } from "@/components/revision-diff";
import { Button } from "@/components/ui/button";
import { compareRevisions, getPageHistory, historyId } from "@/lib/history";
import { ReviewError } from "@/lib/review";
import { getSessionUser } from "@/lib/session";
import { pagePath } from "@/lib/slug";

export const dynamic = "force-dynamic";
export const metadata = { title: "修订历史" };

export default async function HistoryPage({ params, searchParams }: {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  const user = await getSessionUser();
  const isAdmin = user?.role === "admin";
  const query = await searchParams;
  let history;
  let comparison;
  try {
    history = await getPageHistory(historyId((await params).pageId), isAdmin);
    comparison = query.from !== undefined || query.to !== undefined
      ? compareRevisions(history, historyId(query.from), historyId(query.to))
      : null;
  } catch (error) {
    if (error instanceof ReviewError) notFound();
    throw error;
  }
  const { page, revisions } = history;
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <nav className="mb-4 text-sm"><Link href="/">首页</Link> / {page.deletedAt
        ? <Link href="/admin/deleted">已删除页面</Link>
        : <Link href={pagePath(page.type, page.slug, page.id)}>{page.title}</Link>}</nav>
      <h1 className="text-3xl font-bold">{page.title} · 修订历史</h1>
      {isAdmin && <div className="my-4 flex flex-wrap items-center gap-3">
        <PageAction pageId={page.id} action={page.deletedAt ? "restore" : "delete"} />
        <p className="text-sm text-muted-foreground">{page.deletedAt ? "页面已删除，读者不可见；内容与历史仍完整保留。" : "回滚会产生新修订；软删除可恢复，并保留全部历史。"}</p>
      </div>}
      {revisions.length ? <>
        <form action={`/history/${page.id}`} method="get" className="my-6 flex flex-wrap items-end gap-4">
          {(["from", "to"] as const).map((side) => <label key={side} className="flex flex-col gap-1 text-sm">
            {side === "from" ? "起始修订" : "目标修订"}
            <select aria-label={side === "from" ? "起始修订" : "目标修订"} name={side} defaultValue={comparison?.[side].id ?? revisions[side === "from" && revisions.length > 1 ? 1 : 0].id} className="max-w-full rounded border border-border bg-background p-2">
              {revisions.map((revision) => <option key={revision.id} value={revision.id}>#{revision.id} · {revision.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</option>)}
            </select>
          </label>)}
          <Button type="submit">对比修订</Button>
        </form>
        {comparison && <section aria-label="修订对比" className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">修订 #{comparison.from.id} → #{comparison.to.id}</h2>
          <RevisionDiff oldText={comparison.from.content} newText={comparison.to.content} />
        </section>}
        <ol aria-label="全部修订" className="divide-y divide-border">
          {revisions.map((revision, index) => <li key={revision.id} className="py-4" data-testid="history-revision">
            <div className="flex flex-wrap items-center gap-3">
              <strong>修订 #{revision.id}</strong>
              <time dateTime={revision.createdAt.toISOString()}>{revision.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</time>
              {index === 0 && <span className="text-sm text-muted-foreground">当前修订</span>}
              {revision.rollbackFromId && <span>回滚自 #{revision.rollbackFromId}</span>}
              {isAdmin && !page.deletedAt && <PageAction pageId={page.id} action="rollback" revisionId={revision.id} />}
            </div>
            <details className="mt-2"><summary className="cursor-pointer text-sm">查看修订正文</summary><pre className="mt-2 whitespace-pre-wrap break-words rounded bg-muted p-3 text-sm">{revision.content}</pre></details>
          </li>)}
        </ol>
      </> : <p className="mt-6 text-muted-foreground">此页面暂无正文修订。</p>}
    </main>
  );
}
