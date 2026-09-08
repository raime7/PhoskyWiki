// Operational CLI: pnpm links:reconcile --database <database-name> --all
import "dotenv/config";
import { parseArgs } from "node:util";
import { asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../src/db";
import { links, pages, revisions } from "../src/db/schema";
import { rebuildPageLinks } from "../src/lib/page-links";
import { isPageVisible } from "../src/lib/page-visibility";
import { queueSearchSync, transactionWithSearchSync } from "../src/lib/search/search-sync";

interface PageResult {
  pageId: number;
  revisionId: number | null;
  visible: boolean;
  references: number;
  unresolvedLinks: number;
}

function failure(error: unknown) {
  // Drizzle's outer error includes SQL and parameters. Report the underlying database
  // message/code instead so operators can locate lock/constraint failures without body dumps.
  let cause = error;
  while (cause instanceof Error && cause.cause) cause = cause.cause;
  return {
    message: cause instanceof Error ? cause.message : "校对失败",
    code: typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : null,
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    database: { type: "string" },
    all: { type: "boolean", default: false },
    "page-id": { type: "string", multiple: true },
  } });
  const requested = [...new Set((values["page-id"] ?? []).map((id) => {
    if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) throw new Error("--page-id 必须是 PostgreSQL 正整数页面 id");
    return Number(id);
  }))].sort((a, b) => a - b);
  if (!values.database || values.all === (requested.length > 0)) {
    throw new Error("用法：pnpm links:reconcile --database <数据库名> (--all | --page-id <id> [--page-id <id> ...])");
  }
  if (!process.env.DATABASE_URL) throw new Error("必须显式配置目标环境的 DATABASE_URL");
  const url = new URL(process.env.DATABASE_URL);
  if (decodeURIComponent(url.pathname.slice(1)) !== values.database) {
    throw new Error("--database 与 DATABASE_URL 的数据库名不一致，未执行校对");
  }
  const db = getDb();
  const identity = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (identity.rows[0]?.name !== values.database) throw new Error("实际连接的数据库名不一致，未执行校对");

  // Snapshot the selected ids. Each page reads its latest head only after acquiring the
  // same row lock used by approval/edit/rollback; concurrent saves cannot be overwritten.
  const pageIds = values.all
    ? (await db.select({ id: pages.id }).from(pages).orderBy(asc(pages.id))).map((page) => page.id)
    : requested;
  const completed: PageResult[] = [];
  const failures: { pageId: number; message: string; code: string | null }[] = [];
  for (const pageId of pageIds) {
    try {
      const result = await transactionWithSearchSync(db, async (tx) => {
        await tx.execute(sql`set local lock_timeout = '5s'`);
        await tx.execute(sql`set local statement_timeout = '60s'`);
        // Include hidden pages: restoration must see corrected relationships and retain
        // hidden targets' existing identities. Public reads continue to filter visibility.
        const [page] = await tx.select({ type: pages.type }).from(pages).where(eq(pages.id, pageId)).for("update");
        if (!page) throw new Error("页面不存在；请核对 pageId");
        const [head] = await tx.select({ id: revisions.id, content: revisions.content }).from(revisions)
          .where(eq(revisions.pageId, pageId)).orderBy(desc(revisions.id)).limit(1);
        // Term metadata is never Markdown body, including legacy pre-snapshot revisions.
        await rebuildPageLinks(tx, pageId, page.type === "term" ? "" : head?.content ?? "");
        queueSearchSync(tx, pageId);
        const [counts] = await tx.select({
          references: sql<number>`count(*)`.mapWith(Number),
          unresolvedLinks: sql<number>`count(*) filter (where ${links.targetPageId} is null)`.mapWith(Number),
        }).from(links).where(eq(links.sourcePageId, pageId));
        const [visibility] = await tx.select({ visible: isPageVisible(pages.id) }).from(pages).where(eq(pages.id, pageId));
        return { pageId, revisionId: head?.id ?? null, visible: visibility.visible, ...counts };
      });
      completed.push(result);
    } catch (error) {
      failures.push({ pageId, ...failure(error) });
    }
  }
  return {
    target: { host: url.hostname, port: url.port || "5432", database: values.database },
    scope: values.all ? "all" : "selected",
    selected: pageIds.length,
    processed: completed.length,
    failed: failures.length,
    // Successful, publicly visible sources only; hidden content is not a public writing gap.
    unresolvedLinks: completed.filter((page) => page.visible).reduce((sum, page) => sum + page.unresolvedLinks, 0),
    searchSync: process.env.MEILI_HOST ? "requested-after-commit; inspect stderr for failures" : "disabled: MEILI_HOST is not configured",
    pages: completed,
    failures,
  };
}

async function run() {
  let report: object;
  let code: number;
  try {
    const result = await main();
    report = result;
    code = result.failed ? 1 : 0;
  } catch (error) {
    report = { error: failure(error) };
    code = 1;
  }
  // All database/search work is awaited; flush the JSON before ending the CLI's idle pools.
  await new Promise<void>((resolve, reject) => process.stdout.write(`${JSON.stringify(report)}\n`, (error) => error ? reject(error) : resolve()));
  process.exit(code);
}
void run();
