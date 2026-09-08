# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: review-behavior.spec.ts >> 队列显示票数、批准者、过期基准与两侧 diff；提交详情保留终态及理由，重提创建新提交
- Location: tests\e2e\review-behavior.spec.ts:88:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  1   | // R02：只能从页面观察的审核结果。HTTP 状态机回归留在 integration/review.test.ts。
  2   | // 每个用例通过公开提交入口创建独立页面；数据库仅准备历史 quorum 夹具，不读取结果。
  3   | import "dotenv/config";
  4   | import { randomUUID } from "node:crypto";
  5   | import { eq } from "drizzle-orm";
  6   | import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
  7   | import { getDb } from "../../src/db";
  8   | import { submissions } from "../../src/db/schema";
  9   | 
  10  | const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local";
  11  | const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
  12  | test.skip(!ADMIN_PASSWORD, "需要 SEED_ADMIN_PASSWORD");
  13  | 
  14  | async function loginAdmin(request: APIRequestContext) {
  15  |   const response = await request.post("/api/auth/sign-in/email", {
  16  |     headers: { origin: process.env.BETTER_AUTH_URL ?? "http://localhost:3000" },
  17  |     data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  18  |   });
> 19  |   expect(response.ok()).toBe(true);
      |                         ^ Error: expect(received).toBe(expected) // Object.is equality
  20  |   const result = await response.json();
  21  |   expect(result.user.role).toBe("admin");
  22  |   return result.user.name as string;
  23  | }
  24  | 
  25  | async function register(request: APIRequestContext) {
  26  |   const credentials = { email: `review-behavior-${randomUUID()}@example.com`, password: "review-behavior-pass123" };
  27  |   const response = await request.post("/api/auth/sign-up/email", {
  28  |     headers: { origin: process.env.BETTER_AUTH_URL ?? "http://localhost:3000" },
  29  |     data: { ...credentials, name: "审核行为编者" },
  30  |   });
  31  |   expect(response.ok()).toBe(true);
  32  |   return credentials;
  33  | }
  34  | 
  35  | async function submit(request: APIRequestContext, data: Record<string, unknown>) {
  36  |   const response = await request.post("/api/submissions", { data });
  37  |   expect(response.status()).toBe(201);
  38  |   return response.json() as Promise<{ submissionId: number; pageId: number; href: string; outcome: string }>;
  39  | }
  40  | 
  41  | async function review(request: APIRequestContext, id: number, action: "approve" | "reject", reason?: string) {
  42  |   const response = await request.post(`/api/admin/submissions/${id}/review`, { data: { action, reason } });
  43  |   expect(response.status()).toBe(200);
  44  |   return response.json();
  45  | }
  46  | 
  47  | async function history(request: APIRequestContext, pageId: number) {
  48  |   const response = await request.get(`/api/pages/${pageId}/history`);
  49  |   expect(response.status()).toBe(200);
  50  |   return response.json() as Promise<{ revisions: { id: number; content: string }[] }>;
  51  | }
  52  | 
  53  | async function edit(request: APIRequestContext, pageId: number, content: string, supersedes?: number) {
  54  |   const base = (await history(request, pageId)).revisions[0].id;
  55  |   return submit(request, { kind: "edit", pageId, content, baseRevisionId: base, supersedes });
  56  | }
  57  | 
  58  | async function fixture(request: APIRequestContext) {
  59  |   const suffix = randomUUID();
  60  |   const title = `审核词条 ${suffix}`;
  61  |   const name = `审核诠释者 ${suffix}`;
  62  |   const term = await submit(request, { kind: "new_term", title });
  63  |   const interpreter = await submit(request, { kind: "new_interpreter", title: name });
  64  |   const perspective = await submit(request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "原始正文。" });
  65  |   return { term, interpreter, perspective, title, name, perspectiveTitle: `${name}论${title}` };
  66  | }
  67  | 
  68  | async function detail(page: Page, id: number, state: string) {
  69  |   await page.goto(`/profile/submissions/${id}`);
  70  |   await expect(page.getByRole("heading", { level: 1, name: "提交详情" })).toBeVisible();
  71  |   await expect(page.locator("main")).toContainText(state);
  72  | }
  73  | 
  74  | async function listedPage(page: Page, listPath: string, title: string) {
  75  |   await page.goto(listPath);
  76  |   const link = page.getByRole("link", { name: title, exact: true });
  77  |   await expect(link).toBeVisible();
  78  |   await link.click();
  79  |   await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
  80  |   const href = new URL(page.url()).pathname;
  81  |   const id = Number(href.match(/-(\d+)$/)?.[1]);
  82  |   expect(Number.isSafeInteger(id) && id > 0).toBe(true);
  83  |   return { href, pageId: id };
  84  | }
  85  | 
  86  | const backlinks = (page: Page) => page.getByRole("region", { name: /^反链/ });
  87  | 
  88  | test("队列显示票数、批准者、过期基准与两侧 diff；提交详情保留终态及理由，重提创建新提交", async ({ page, request }) => {
  89  |   const adminName = await loginAdmin(request);
  90  |   const author = await register(page.request);
  91  |   const source = await fixture(request);
  92  |   const proposal = "队列展示用的提案内容。";
  93  |   const created = await edit(page.request, source.perspective.pageId, proposal);
  94  |   await detail(page, created.submissionId, "待审核");
  95  |   await expect(page.getByTestId("content-diff")).toContainText("原始正文。");
  96  | 
  97  |   // 准备「两管理员时期创建、现剩一管理员」的历史快照；不改变全站角色或并发用例。
  98  |   // quorum 的实际创建规则由 HTTP 集成测试覆盖，此处只观察队列呈现。
  99  |   await getDb().update(submissions).set({ quorum: 2 }).where(eq(submissions.id, created.submissionId));
  100 |   expect(await review(request, created.submissionId, "approve")).toEqual({ outcome: "pending", approveCount: 1, quorum: 2 });
  101 |   await edit(request, source.perspective.pageId, "直编推进 head。");
  102 |   const fresh = await edit(page.request, source.perspective.pageId, "第二条待审提交。");
  103 |   const staleProposal = await edit(page.request, source.perspective.pageId, "等待旧基准受理的提案。");
  104 | 
  105 |   await loginAdmin(page.request);
  106 |   await page.goto("/review");
  107 |   const item = page.locator(`[data-submission-id="${created.submissionId}"]`);
  108 |   await expect(item).toContainText("编辑视角");
  109 |   await expect(item).toContainText(source.perspectiveTitle);
  110 |   await expect(item).toContainText(`批准 1/2（${adminName}）`);
  111 |   await expect(item.getByTestId("stale-badge")).toBeVisible();
  112 |   await item.getByText("对比当前版与提案", { exact: true }).click();
  113 |   await expect(item.getByTestId("content-diff")).toContainText("直编推进 head。");
  114 |   await expect(item.getByTestId("content-diff")).toContainText(proposal);
  115 |   const freshItem = page.locator(`[data-submission-id="${fresh.submissionId}"]`);
  116 |   await expect(freshItem.getByTestId("stale-badge")).toHaveCount(0);
  117 |   await expect(freshItem).toContainText("批准 0/");
  118 |   const queueIds = await page.locator("[data-submission-id]").filter({ hasText: source.perspectiveTitle }).evaluateAll((items) => items.map((entry) => entry.getAttribute("data-submission-id")));
  119 |   await edit(request, source.perspective.pageId, "再次直编，不进入审核队列。");
```