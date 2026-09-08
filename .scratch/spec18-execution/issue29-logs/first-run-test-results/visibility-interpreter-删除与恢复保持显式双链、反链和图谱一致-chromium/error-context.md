# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: visibility.spec.ts >> interpreter 删除与恢复保持显式双链、反链和图谱一致
- Location: tests\e2e\visibility.spec.ts:12:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  1  | import "dotenv/config";
  2  | import { randomUUID } from "node:crypto";
  3  | import { expect, test, type APIRequestContext } from "@playwright/test";
  4  | 
  5  | async function submit(request: APIRequestContext, data: Record<string, unknown>) {
  6  |   const response = await request.post("/api/submissions", { data });
  7  |   expect(response.status()).toBe(201);
  8  |   return response.json() as Promise<{ pageId: number; href: string }>;
  9  | }
  10 | 
  11 | for (const deletedKind of ["perspective", "term", "interpreter"] as const) {
  12 |   test(`${deletedKind} 删除与恢复保持显式双链、反链和图谱一致`, async ({ page, browser, baseURL }) => {
  13 |     test.setTimeout(120_000);
  14 |     test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要 SEED_ADMIN_PASSWORD");
  15 |     expect((await page.request.post("/api/auth/sign-in/email", { data: {
  16 |       email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD,
> 17 |     } })).ok()).toBe(true);
     |                 ^ Error: expect(received).toBe(expected) // Object.is equality
  18 |     const suffix = randomUUID();
  19 |     const title = `可见词条 ${suffix}`;
  20 |     const name = `可见诠释者 ${suffix}`;
  21 |     const term = await submit(page.request, { kind: "new_term", title });
  22 |     const interpreter = await submit(page.request, { kind: "new_interpreter", title: name });
  23 |     const target = await submit(page.request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "目标正文" });
  24 |     const sourceTerm = await submit(page.request, { kind: "new_term", title: `引用词条 ${suffix}` });
  25 |     const sourceInterpreter = await submit(page.request, { kind: "new_interpreter", title: `引用诠释者 ${suffix}` });
  26 |     const source = await submit(page.request, { kind: "new_perspective", termId: sourceTerm.pageId, interpreterId: sourceInterpreter.pageId, content: `[[${title}|视角@${name}]]` });
  27 |     const readerContext = await browser.newContext({ baseURL });
  28 |     const reader = await readerContext.newPage();
  29 |     const deletedId = { perspective: target.pageId, term: term.pageId, interpreter: interpreter.pageId }[deletedKind];
  30 |     async function action(id: number, action: "delete" | "restore") {
  31 |       expect((await page.request.post(`/api/admin/pages/${id}`, { data: { action } })).status()).toBe(200);
  32 |     }
  33 |     async function edgeCount() {
  34 |       const graph = await (await reader.request.get("/api/graph/site")).json();
  35 |       return graph.edges.filter((edge: { source: number; target: number }) =>
  36 |         [edge.source, edge.target].includes(term.pageId) && [edge.source, edge.target].includes(sourceTerm.pageId)).length;
  37 |     }
  38 |     try {
  39 |       await reader.goto(source.href);
  40 |       await expect(reader.locator(".wiki-content a.wiki-link")).toHaveAttribute("href", target.href);
  41 |       expect(await edgeCount()).toBe(1);
  42 |       await action(deletedId, "delete");
  43 |       await reader.reload();
  44 |       await expect(reader.locator(".wiki-content a.wiki-link")).toHaveCount(0);
  45 |       await expect(reader.locator(".wiki-content span.wiki-link")).toHaveAttribute("title", "页面暂不可用");
  46 |       await reader.goto(target.href);
  47 |       await expect(reader.getByRole("heading", { name: "404", exact: true })).toBeVisible();
  48 |       expect((await reader.request.get(`/api/pages/${target.pageId}/history`)).status()).toBe(404);
  49 |       expect(await edgeCount()).toBe(0);
  50 |       await reader.goto(sourceTerm.href);
  51 |       await expect(reader.getByTestId("related-terms").locator(`a[href="${term.href}"]`)).toHaveCount(0);
  52 |       // 引用方自身删除/恢复不能重解析已保存的目标；目标还隐藏时也要保留 id。
  53 |       await action(source.pageId, "delete");
  54 |       await action(source.pageId, "restore");
  55 |       await reader.goto(source.href);
  56 |       await expect(reader.locator(".wiki-content span.wiki-link")).toHaveAttribute("title", "页面暂不可用");
  57 |       await action(deletedId, "restore");
  58 |       await reader.goto(source.href);
  59 |       await expect(reader.locator(".wiki-content a.wiki-link")).toHaveAttribute("href", target.href);
  60 |       expect(await edgeCount()).toBe(1);
  61 |       await reader.goto(sourceTerm.href);
  62 |       await expect(reader.getByTestId("related-terms").locator(`a[href="${term.href}"]`)).toBeVisible();
  63 |       await reader.goto(target.href);
  64 |       await expect(reader.getByRole("link", { name: new RegExp(`引用诠释者 ${suffix}论`) })).toBeVisible();
  65 |       await reader.goto(term.href);
  66 |       await expect(reader.locator("li").filter({ has: reader.locator(`a[href="${target.href}"]`) })).toContainText("1 次引用");
  67 |       await reader.goto(target.href);
  68 |       // 同一视角作为引用来源时，父页面删除也必须移除反链与推荐边。
  69 |       await action(sourceInterpreter.pageId, "delete");
  70 |       await reader.reload();
  71 |       await expect(reader.getByRole("link", { name: new RegExp(`引用诠释者 ${suffix}论`) })).toHaveCount(0);
  72 |       expect(await edgeCount()).toBe(0);
  73 |       await reader.goto(term.href);
  74 |       await expect(reader.locator("li").filter({ has: reader.locator(`a[href="${target.href}"]`) })).toContainText("0 次引用");
  75 |       await action(sourceInterpreter.pageId, "restore");
  76 |       await reader.goto(target.href);
  77 |       await expect(reader.getByRole("link", { name: new RegExp(`引用诠释者 ${suffix}论`) })).toBeVisible();
  78 |       if (deletedKind !== "perspective") {
  79 |         await action(target.pageId, "delete");
  80 |         await action(deletedId, "delete");
  81 |         await action(deletedId, "restore");
  82 |         expect((await reader.request.get(`/api/pages/${target.pageId}/history`)).status()).toBe(404);
  83 |         await reader.goto(source.href);
  84 |         await expect(reader.locator(".wiki-content a.wiki-link")).toHaveCount(0);
  85 |         await action(target.pageId, "restore");
  86 |       }
  87 |     } finally {
  88 |       await action(deletedId, "restore");
  89 |       await action(sourceInterpreter.pageId, "restore");
  90 |       await readerContext.close();
  91 |     }
  92 |   });
  93 | }
  94 | 
```