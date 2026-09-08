import "dotenv/config";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";
import { expect, test, type APIRequestContext } from "@playwright/test";

const execute = promisify(execFile);
const database = decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1));
async function reconcile(...args: string[]) {
  try {
    const result = await execute(process.execPath, ["--conditions", "react-server", "--import", "tsx", "scripts/reconcile-links.ts", "--database", database, ...args]);
    return { code: 0, report: JSON.parse(result.stdout) };
  } catch (error) {
    const result = error as { code: number; stdout: string; stderr: string };
    // Keep CLI startup errors readable during the red phase.
    if (!result.stdout) throw new Error(result.stderr);
    return { code: result.code, report: JSON.parse(result.stdout) };
  }
}
async function submit(request: APIRequestContext, data: object) {
  const response = await request.post("/api/submissions", { data });
  expect(response.status()).toBe(201);
  return response.json();
}
async function history(request: APIRequestContext, id: number) {
  const response = await request.get(`/api/pages/${id}/history`);
  expect(response.status()).toBe(200);
  return response.json();
}

test("存量校对保留真实改名前目标、清除代码假链，公开历史与重复报告稳定", async ({ page }) => {
  test.setTimeout(180_000);
  expect((await page.request.post("/api/auth/sign-in/email", { data: {
    email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD,
  } })).ok()).toBe(true);
  const token = randomUUID();
  const oldName = `Reconcile Old ${token}`;
  const newName = `Reconcile New ${token}`;
  const interpreterName = `Reconcile Reader ${token}`;
  const term = await submit(page.request, { kind: "new_term", title: oldName });
  const interpreter = await submit(page.request, { kind: "new_interpreter", title: interpreterName });
  const target = await submit(page.request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "身份保持的目标正文" });
  const exampleName = `Code Example ${token}`;
  const example = await submit(page.request, { kind: "new_term", title: exampleName });
  const examplePerspective = await submit(page.request, { kind: "new_perspective", termId: example.pageId, interpreterId: interpreter.pageId, content: "代码中提及的视角" });
  const sourceTerm = await submit(page.request, { kind: "new_term", title: `Reconcile Source ${token}` });
  const gap = `Real Gap ${token}`;
  const falseGap = `Code Gap ${token}`;
  const laterName = `Created Later ${token}`;
  const content = `[[${oldName}|原词条]] [[${oldName}|原视角@${interpreterName}]] [[${gap}]] [[${laterName}]]\n\n\`[[${exampleName}]]\`\n\n\`\`\`md\n[[${exampleName}|示例@${interpreterName}]] [[${falseGap}]]\n\`\`\``;
  const source = await submit(page.request, { kind: "new_perspective", termId: sourceTerm.pageId, interpreterId: interpreter.pageId, content: "旧版仅有历史正文" });
  await submit(page.request, { kind: "edit", pageId: source.pageId, baseRevisionId: (await history(page.request, source.pageId)).revisions[0].id, content });
  // Rename through the real #24 public workflow; reusing the old name must not capture existing links.
  const renamed = await submit(page.request, { kind: "edit", pageId: term.pageId, baseRevisionId: (await history(page.request, term.pageId)).revisions[0].id, title: newName, summary: "改名后的简介", aliases: [] });
  await submit(page.request, { kind: "new_term", title: oldName });
  const later = await submit(page.request, { kind: "new_term", title: laterName });
  const beforeSource = await history(page.request, source.pageId);
  const beforeTerm = await history(page.request, term.pageId);
  // Only historical pollution is prepared below; all observations use CLI, HTTP and DOM.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query("INSERT INTO links(source_page_id,target_page_id,target_name) VALUES($1,$2,$3),($1,$4,$5),($1,NULL,$6)", [source.pageId, example.pageId, exampleName, examplePerspective.pageId, `${exampleName}@${interpreterName}`, falseGap]);
  } finally { await pool.end(); }
  async function publicRelations(polluted: boolean) {
    await page.goto(source.href);
    // Prime and reuse the same URLs in the browser's real HTTP cache across the CLI run.
    const [graph, site] = await page.evaluate(async (termId) => Promise.all([
      fetch(`/api/graph/local?termId=${termId}`).then((response) => response.json()),
      fetch("/api/graph/site").then((response) => response.json()),
    ]), sourceTerm.pageId);
    expect(graph.nodes.some((node: { id: number }) => node.id === example.pageId)).toBe(polluted);
    expect(graph.edges).toContainEqual({ source: term.pageId, target: sourceTerm.pageId, weight: 2 });
    expect(site.edges.some((edge: { source: number; target: number }) =>
      [edge.source, edge.target].includes(example.pageId) && [edge.source, edge.target].includes(sourceTerm.pageId))).toBe(polluted);
    const discovery = await (await page.request.get(`/api/terms/${sourceTerm.pageId}/discovery`)).json();
    expect(discovery.relatedTerms.some((row: { id: number }) => row.id === example.pageId)).toBe(polluted);
    await page.goto(examplePerspective.href);
    await expect(page.getByRole("region", { name: /^反链/ }).locator(`a[href="${source.href}"]`)).toHaveCount(polluted ? 1 : 0);
    await page.goto(example.href);
    await expect(page.locator("li").filter({ has: page.locator(`a[href="${examplePerspective.href}"]`) })).toContainText(`${polluted ? 1 : 0} 次引用`);
    await page.goto(target.href);
    await expect(page.getByRole("region", { name: /^反链/ }).locator(`a[href="${source.href}"]`)).toHaveCount(1);
  }
  await publicRelations(true);
  await page.goto(source.href);
  await expect(page.locator(".wiki-content").getByRole("link", { name: "原词条", exact: true })).toHaveAttribute("href", renamed.href);
  const first = await reconcile("--page-id", String(source.pageId));
  expect(first.code).toBe(0);
  expect(first.report).toMatchObject({ processed: 1, failed: 0, unresolvedLinks: 1, failures: [], pages: [{ pageId: source.pageId, references: 4, unresolvedLinks: 1 }] });
  expect(await reconcile("--page-id", String(source.pageId))).toEqual(first);
  expect(await history(page.request, source.pageId)).toEqual(beforeSource);
  expect(await history(page.request, term.pageId)).toEqual(beforeTerm);
  await publicRelations(false);
  await page.goto(source.href);
  const body = page.locator(".wiki-content");
  await expect(body.locator("a.wiki-link")).toHaveCount(3);
  await expect(body.locator(".wiki-link--red")).toHaveText(gap);
  await expect(body.getByRole("link", { name: laterName, exact: true })).toHaveAttribute("href", later.href);
  await expect(body.getByRole("link", { name: "原视角", exact: true })).toHaveAttribute("href", target.href);
  await body.getByRole("link", { name: "原词条", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(newName);
  await page.goto(`/history/${source.pageId}`);
  await expect(page.getByRole("heading", { name: /修订历史/ })).toBeVisible();
});

test("校对逐页报告锁冲突和不存在的页面，成功项继续处理，故障解除后可按 id 重试", async ({ request }) => {
  test.setTimeout(60_000);
  expect((await request.post("/api/auth/sign-in/email", { data: {
    email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD,
  } })).ok()).toBe(true);
  const locked = await submit(request, { kind: "new_term", title: `Locked Reconcile ${randomUUID()}` });
  const available = await submit(request, { kind: "new_term", title: `Available Reconcile ${randomUUID()}` });
  const original = await history(request, locked.pageId);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT id FROM pages WHERE id=$1 FOR UPDATE", [locked.pageId]);
    const partial = await reconcile("--page-id", String(locked.pageId), "--page-id", String(available.pageId), "--page-id", "2147483647");
    expect(partial.code).toBe(1);
    expect(partial.report).toMatchObject({ selected: 3, processed: 1, failed: 2, pages: [{ pageId: available.pageId }], failures: [
      { pageId: locked.pageId, code: "55P03" },
      { pageId: 2147483647, message: "页面不存在；请核对 pageId" },
    ] });
  } finally {
    await connection.query("ROLLBACK");
    connection.release();
    await pool.end();
  }
  const retry = await reconcile("--page-id", String(locked.pageId));
  expect(retry.code).toBe(0);
  expect(retry.report).toMatchObject({ processed: 1, failed: 0, failures: [], pages: [{ pageId: locked.pageId }] });
  expect(await history(request, locked.pageId)).toEqual(original);
});
