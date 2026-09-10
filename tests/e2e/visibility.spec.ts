import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "./fixtures";

async function submit(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.post("/api/submissions", { data });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ pageId: number; href: string }>;
}

for (const deletedKind of ["perspective", "term", "interpreter"] as const) {
  test(`${deletedKind} 删除与恢复保持显式双链、反链和图谱一致`, async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要 SEED_ADMIN_PASSWORD");
    expect((await page.request.post("/api/auth/sign-in/email", { data: {
      email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD,
    } })).ok()).toBe(true);
    const suffix = randomUUID();
    const title = `可见词条 ${suffix}`;
    const name = `可见诠释者 ${suffix}`;
    const term = await submit(page.request, { kind: "new_term", title });
    const interpreter = await submit(page.request, { kind: "new_interpreter", title: name });
    const target = await submit(page.request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "目标正文" });
    const sourceTerm = await submit(page.request, { kind: "new_term", title: `引用词条 ${suffix}` });
    const sourceInterpreter = await submit(page.request, { kind: "new_interpreter", title: `引用诠释者 ${suffix}` });
    const source = await submit(page.request, { kind: "new_perspective", termId: sourceTerm.pageId, interpreterId: sourceInterpreter.pageId, content: `[[${title}|视角@${name}]]` });
    const readerContext = await browser.newContext({ baseURL });
    const reader = await readerContext.newPage();
    const deletedId = { perspective: target.pageId, term: term.pageId, interpreter: interpreter.pageId }[deletedKind];
    async function action(id: number, action: "delete" | "restore") {
      expect((await page.request.post(`/api/admin/pages/${id}`, { data: { action } })).status()).toBe(200);
    }
    async function edgeCount() {
      const graph = await (await reader.request.get("/api/graph/site")).json();
      return graph.edges.filter((edge: { source: number; target: number }) =>
        [edge.source, edge.target].includes(term.pageId) && [edge.source, edge.target].includes(sourceTerm.pageId)).length;
    }
    try {
      await reader.goto(source.href);
      await expect(reader.locator(".wiki-content a.wiki-link")).toHaveAttribute("href", target.href);
      expect(await edgeCount()).toBe(1);
      await action(deletedId, "delete");
      await reader.reload();
      await expect(reader.locator(".wiki-content a.wiki-link")).toHaveCount(0);
      await expect(reader.locator(".wiki-content span.wiki-link")).toHaveAttribute("title", "页面暂不可用");
      await reader.goto(target.href);
      await expect(reader.getByRole("heading", { name: "404", exact: true })).toBeVisible();
      expect((await reader.request.get(`/api/pages/${target.pageId}/history`)).status()).toBe(404);
      expect(await edgeCount()).toBe(0);
      await reader.goto(sourceTerm.href);
      await expect(reader.getByTestId("related-terms").locator(`a[href="${term.href}"]`)).toHaveCount(0);
      // 引用方自身删除/恢复不能重解析已保存的目标；目标还隐藏时也要保留 id。
      await action(source.pageId, "delete");
      await action(source.pageId, "restore");
      await reader.goto(source.href);
      await expect(reader.locator(".wiki-content span.wiki-link")).toHaveAttribute("title", "页面暂不可用");
      await action(deletedId, "restore");
      await reader.goto(source.href);
      await expect(reader.locator(".wiki-content a.wiki-link")).toHaveAttribute("href", target.href);
      expect(await edgeCount()).toBe(1);
      await reader.goto(sourceTerm.href);
      await expect(reader.getByTestId("related-terms").locator(`a[href="${term.href}"]`)).toBeVisible();
      await reader.goto(target.href);
      await expect(reader.getByRole("link", { name: new RegExp(`引用诠释者 ${suffix}论`) })).toBeVisible();
      await reader.goto(term.href);
      await expect(reader.locator("li").filter({ has: reader.locator(`a[href="${target.href}"]`) })).toContainText("1 次引用");
      await reader.goto(target.href);
      // 同一视角作为引用来源时，父页面删除也必须移除反链与推荐边。
      await action(sourceInterpreter.pageId, "delete");
      await reader.reload();
      await expect(reader.getByRole("link", { name: new RegExp(`引用诠释者 ${suffix}论`) })).toHaveCount(0);
      expect(await edgeCount()).toBe(0);
      await reader.goto(term.href);
      await expect(reader.locator("li").filter({ has: reader.locator(`a[href="${target.href}"]`) })).toContainText("0 次引用");
      await action(sourceInterpreter.pageId, "restore");
      await reader.goto(target.href);
      await expect(reader.getByRole("link", { name: new RegExp(`引用诠释者 ${suffix}论`) })).toBeVisible();
      if (deletedKind !== "perspective") {
        await action(target.pageId, "delete");
        await action(deletedId, "delete");
        await action(deletedId, "restore");
        expect((await reader.request.get(`/api/pages/${target.pageId}/history`)).status()).toBe(404);
        await reader.goto(source.href);
        await expect(reader.locator(".wiki-content a.wiki-link")).toHaveCount(0);
        await action(target.pageId, "restore");
      }
    } finally {
      await action(deletedId, "restore");
      await action(sourceInterpreter.pageId, "restore");
      await readerContext.close();
    }
  });
}
