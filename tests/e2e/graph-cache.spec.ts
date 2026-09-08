import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

async function submit(request: APIRequestContext, data: object) {
  const response = await request.post("/api/submissions", { data });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ pageId: number; href: string }>;
}

for (const endpoint of ["site", "local"] as const) {
  test(`${endpoint} 浏览器缓存不能保留删除或恢复前的图谱`, async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    expect((await page.request.post("/api/auth/sign-in/email", { data: {
      email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD,
    } })).ok()).toBe(true);
    const token = randomUUID();
    const term = await submit(page.request, { kind: "new_term", title: `缓存来源 ${token}` });
    const targetTitle = `缓存目标 ${token}`;
    const target = await submit(page.request, { kind: "new_term", title: targetTitle });
    const interpreter = await submit(page.request, { kind: "new_interpreter", title: `缓存诠释者 ${token}` });
    const source = await submit(page.request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: `[[${targetTitle}]]` });
    const readerContext = await browser.newContext({ baseURL });
    const reader = await readerContext.newPage();
    await reader.goto(term.href);
    const url = endpoint === "site" ? "/api/graph/site" : `/api/graph/local?termId=${term.pageId}&hops=1`;
    // Real browser fetch uses its default HTTP cache. No routing mocks, cache busting,
    // request cache directive or navigation between reads can hide a stale response.
    async function graph() {
      return reader.evaluate(async (url) => {
        const response = await fetch(url);
        return { status: response.status, cacheControl: response.headers.get("cache-control"), data: await response.json() };
      }, url);
    }
    async function action(pageId: number, action: "delete" | "restore") {
      expect((await page.request.post(`/api/admin/pages/${pageId}`, { data: { action } })).status()).toBe(200);
    }
    async function expectEdge(visible: boolean) {
      const result = await graph();
      expect(result.status).toBe(200);
      expect(result.data.edges.some((edge: { source: number; target: number }) =>
        [edge.source, edge.target].includes(term.pageId) && [edge.source, edge.target].includes(target.pageId))).toBe(visible);
      return result;
    }
    try {
      await expectEdge(true); // Prime exactly the URL that will be reused below.
      for (const pageId of [source.pageId, interpreter.pageId]) {
        await action(pageId, "delete");
        await expectEdge(false);
        await action(pageId, "restore");
        await expectEdge(true);
      }
      await action(target.pageId, "delete");
      const hidden = await expectEdge(false);
      expect(hidden.data.nodes.some((node: { id: number }) => node.id === target.pageId)).toBe(false);
      await action(target.pageId, "restore");
      const restored = await expectEdge(true);
      expect(restored.data.nodes.some((node: { id: number }) => node.id === target.pageId)).toBe(true);
      expect(restored.cacheControl).toBe("no-store");
      if (endpoint === "local") {
        await action(term.pageId, "delete");
        const deletedRoot = await graph();
        expect(deletedRoot.status).toBe(404);
        expect(deletedRoot.cacheControl).toBe("no-store");
        await action(term.pageId, "restore");
        await expectEdge(true);
      }
    } finally {
      for (const pageId of [source.pageId, interpreter.pageId, target.pageId, term.pageId]) await action(pageId, "restore");
      await readerContext.close();
    }
  });
}
