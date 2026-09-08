# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: wiki-link-semantics.spec.ts >> 混合正文的预览、受理、直编与回滚只为真实双链生成导航关系
- Location: tests\e2e\wiki-link-semantics.spec.ts:26:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  1   | import "dotenv/config";
  2   | import { randomUUID } from "node:crypto";
  3   | import { eq } from "drizzle-orm";
  4   | import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";
  5   | import { getDb } from "../../src/db";
  6   | import { pages } from "../../src/db/schema";
  7   | 
  8   | test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要独立数据库的种子管理员");
  9   | 
  10  | async function submit(request: APIRequestContext, data: Record<string, unknown>) {
  11  |   const response = await request.post("/api/submissions", { data });
  12  |   expect(response.status()).toBe(201);
  13  |   return response.json() as Promise<{ pageId: number; href: string; submissionId: number }>;
  14  | }
  15  | async function head(request: APIRequestContext, pageId: number) {
  16  |   const response = await request.get(`/api/pages/${pageId}/history`);
  17  |   expect(response.status()).toBe(200);
  18  |   return (await response.json()).revisions[0] as { id: number; content: string };
  19  | }
  20  | async function login(request: APIRequestContext) {
  21  |   expect((await request.post("/api/auth/sign-in/email", { data: {
  22  |     email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD,
> 23  |   } })).ok()).toBe(true);
      |               ^ Error: expect(received).toBe(expected) // Object.is equality
  24  | }
  25  | 
  26  | test("混合正文的预览、受理、直编与回滚只为真实双链生成导航关系", async ({ page, request }) => {
  27  |   test.setTimeout(180_000);
  28  |   await login(request);
  29  |   const suffix = randomUUID();
  30  |   const title = `真实目标 ${suffix}`;
  31  |   const interpreterTitle = `诠释者 ${suffix}`;
  32  |   const term = await submit(request, { kind: "new_term", title });
  33  |   const interpreter = await submit(request, { kind: "new_interpreter", title: interpreterTitle });
  34  |   const target = await submit(request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "目标正文" });
  35  |   const exampleTitle = `代码示例 ${suffix}`;
  36  |   const example = await submit(request, { kind: "new_term", title: exampleTitle });
  37  |   const sourceTerm = await submit(request, { kind: "new_term", title: `来源 ${suffix}` });
  38  |   const source = await submit(request, { kind: "new_perspective", termId: sourceTerm.pageId, interpreterId: interpreter.pageId, content: "初始正文" });
  39  |   const gap = `真实缺口 ${suffix}`;
  40  |   const examples = [
  41  |     "```md", `[[${exampleTitle}]] [[围栏缺口]]`, "```", "",
  42  |     `    [[${exampleTitle}]] [[缩进缺口]]`, "", `\`[[${exampleTitle}]] [[行内缺口]]\``, "",
  43  |     `\\[[${exampleTitle}]] \\[[转义缺口]]`,
  44  |   ].join("\n");
  45  |   const mixed = `[[${title}]] [[${title}|别名]] [[${title}|特定视角@${interpreterTitle}]] [[${gap}]]\n\n${examples}`;
  46  |   async function bodyAssertions(body: Locator) {
  47  |     await expect(body.locator("a.wiki-link")).toHaveCount(3);
  48  |     await expect(body.getByRole("link", { name: "别名", exact: true })).toHaveAttribute("href", term.href);
  49  |     await expect(body.getByRole("link", { name: "特定视角", exact: true })).toHaveAttribute("href", target.href);
  50  |     await expect(body.locator(".wiki-link--red")).toHaveText(gap);
  51  |     await expect(body.locator("pre")).toHaveCount(2);
  52  |   }
  53  |   async function relations(present: boolean) {
  54  |     const graph = await (await page.request.get("/api/graph/site")).json();
  55  |     const adjacent = graph.edges.filter((edge: { source: number; target: number }) => edge.source === sourceTerm.pageId || edge.target === sourceTerm.pageId);
  56  |     expect(adjacent).toEqual(present ? [{ source: term.pageId, target: sourceTerm.pageId, weight: 2 }] : []);
  57  |     await page.goto(target.href);
  58  |     await expect(page.getByRole("region", { name: /^反链/ }).locator(`a[href="${source.href}"]`)).toHaveCount(present ? 1 : 0);
  59  |     await page.goto(example.href);
  60  |     await expect(page.getByRole("region", { name: /^反链/ }).locator(`a[href="${source.href}"]`)).toHaveCount(0);
  61  |     await page.goto(term.href);
  62  |     await expect(page.locator("li").filter({ has: page.locator(`a[href="${target.href}"]`) })).toContainText(`${present ? 1 : 0} 次引用`);
  63  |   }
  64  |   // 普通编者的真实预览与审核发布。
  65  |   expect((await page.request.post("/api/auth/sign-up/email", { data: {
  66  |     email: `wiki-${suffix}@example.com`, password: "wiki-semantics-password", name: "双链编者",
  67  |   } })).ok()).toBe(true);
  68  |   await page.goto(`/edit/${source.pageId}`);
  69  |   await page.getByRole("textbox", { name: "正文（Markdown）" }).fill(mixed);
  70  |   await bodyAssertions(page.getByRole("region", { name: "实时预览" }));
  71  |   const proposal = await submit(page.request, { kind: "edit", pageId: source.pageId, baseRevisionId: (await head(request, source.pageId)).id, content: mixed });
  72  |   expect((await request.post(`/api/admin/submissions/${proposal.submissionId}/review`, { data: { action: "approve" } })).status()).toBe(200);
  73  |   const mixedRevision = await head(request, source.pageId);
  74  |   await page.goto(source.href);
  75  |   await bodyAssertions(page.locator(".wiki-content"));
  76  |   await relations(true);
  77  |   // 管理员直编去除真实引用后，示例不能维持反链、热度或图谱边。
  78  |   await submit(request, { kind: "edit", pageId: source.pageId, baseRevisionId: mixedRevision.id, content: examples });
  79  |   await page.goto(source.href);
  80  |   await expect(page.locator(".wiki-content .wiki-link")).toHaveCount(0);
  81  |   await relations(false);
  82  |   expect((await request.post(`/api/admin/pages/${source.pageId}`, { data: { action: "rollback", revisionId: mixedRevision.id } })).status()).toBe(200);
  83  |   await page.goto(source.href);
  84  |   await bodyAssertions(page.locator(".wiki-content"));
  85  |   await relations(true);
  86  | });
  87  | 
  88  | for (const explicit of [false, true]) {
  89  | test(`${explicit ? "显式视角" : "普通双链"}源文仍用旧名时，预览、保存与回滚保留目标身份，隐藏目标恢复后仍可达`, async ({ page, request }) => {
  90  |   test.setTimeout(120_000);
  91  |   await login(request);
  92  |   await login(page.request);
  93  |   const suffix = randomUUID();
  94  |   const title = `旧名 ${suffix}`;
  95  |   const term = await submit(request, { kind: "new_term", title });
  96  |   const interpreterTitle = `解释 ${suffix}`;
  97  |   const interpreter = await submit(request, { kind: "new_interpreter", title: interpreterTitle });
  98  |   const target = await submit(request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "目标正文" });
  99  |   const sourceTerm = await submit(request, { kind: "new_term", title: `身份来源 ${suffix}` });
  100 |   const gap = `待创建 ${suffix}`;
  101 |   const content = `[[${title}|原目标${explicit ? `@${interpreterTitle}` : ""}]] [[${gap}]]`;
  102 |   const source = await submit(request, { kind: "new_perspective", termId: sourceTerm.pageId, interpreterId: interpreter.pageId, content });
  103 |   const original = await head(request, source.pageId);
  104 |   // 此工单的前置夹具：已改名页面；实际改名工作流由 #24 验证。
  105 |   await getDb().update(pages).set({ title: `新名 ${suffix}`, slug: `renamed-${suffix}` }).where(eq(pages.id, term.pageId));
  106 |   const replacement = await submit(request, { kind: "new_term", title }); // 旧名被另一个新页面使用
  107 |   await submit(request, { kind: "new_perspective", termId: replacement.pageId, interpreterId: interpreter.pageId, content: "同名替代视角" });
  108 |   const newTarget = await submit(request, { kind: "new_term", title: gap });
  109 |   const targetHref = explicit ? target.href : `/term/renamed-${suffix}-${term.pageId}`;
  110 |   await page.goto(`/edit/${source.pageId}`);
  111 |   await expect(page.getByRole("region", { name: "实时预览" }).getByRole("link", { name: "原目标" })).toHaveAttribute("href", targetHref);
  112 |   async function edit() {
  113 |     await submit(request, { kind: "edit", pageId: source.pageId, baseRevisionId: (await head(request, source.pageId)).id, content: `${content}\n\n补充解释` });
  114 |   }
  115 |   await edit();
  116 |   await page.goto(source.href);
  117 |   await expect(page.locator(".wiki-content").getByRole("link", { name: "原目标" })).toHaveAttribute("href", targetHref);
  118 |   await expect(page.locator(".wiki-content").getByRole("link", { name: gap })).toHaveAttribute("href", newTarget.href);
  119 |   expect((await request.post(`/api/admin/pages/${term.pageId}`, { data: { action: "delete" } })).status()).toBe(200);
  120 |   await page.goto(`/edit/${source.pageId}`);
  121 |   await expect(page.getByRole("region", { name: "实时预览" }).getByText("原目标", { exact: true })).toHaveAttribute("title", "页面暂不可用");
  122 |   await edit();
  123 |   expect((await request.post(`/api/admin/pages/${source.pageId}`, { data: { action: "rollback", revisionId: original.id } })).status()).toBe(200);
```