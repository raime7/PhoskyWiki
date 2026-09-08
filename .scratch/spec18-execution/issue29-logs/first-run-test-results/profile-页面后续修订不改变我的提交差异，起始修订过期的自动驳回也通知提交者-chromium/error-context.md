# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: profile.spec.ts >> 页面后续修订不改变我的提交差异，起始修订过期的自动驳回也通知提交者
- Location: tests\e2e\profile.spec.ts:160:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  1   | // T09：个人主页的提交历史、审核通知与私有差异，走真实 HTTP + SSR/浏览器主缝。
  2   | // 每个用例创建独立编者和新页面，不依赖既有提交，也不改变种子内容。
  3   | 
  4   | import "dotenv/config";
  5   | 
  6   | import { randomUUID } from "node:crypto";
  7   | 
  8   | import { expect, test, type APIRequestContext } from "@playwright/test";
  9   | 
  10  | const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local";
  11  | const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
  12  | 
  13  | async function loginAdmin(request: APIRequestContext) {
  14  |   const response = await request.post("/api/auth/sign-in/email", {
  15  |     data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  16  |   });
  17  |   expect(response.ok()).toBe(true);
  18  |   expect(await response.json()).toMatchObject({ user: { role: "admin" } });
  19  | }
  20  | 
  21  | async function register(request: APIRequestContext, name = "T09 个人主页编者") {
  22  |   const email = `e2e-profile-${randomUUID()}@example.com`;
  23  |   const password = "profile-password123";
  24  |   const response = await request.post("/api/auth/sign-up/email", {
  25  |     data: { name, email, password },
  26  |   });
> 27  |   expect(response.ok()).toBe(true);
      |                         ^ Error: expect(received).toBe(expected) // Object.is equality
  28  |   const { user } = await response.json();
  29  |   return { id: user.id as string, email, password, name };
  30  | }
  31  | 
  32  | async function submit(request: APIRequestContext, data: Record<string, unknown>) {
  33  |   const response = await request.post("/api/submissions", { data });
  34  |   expect(response.status()).toBe(201);
  35  |   return response.json() as Promise<{
  36  |     submissionId: number;
  37  |     quorum?: number;
  38  |     pageId?: number;
  39  |     href?: string;
  40  |   }>;
  41  | }
  42  | 
  43  | test("游客访问个人主页先登录", async ({ page }) => {
  44  |   await page.goto("/profile");
  45  |   await expect(page).toHaveURL(/\/login(?:\?|$)/);
  46  |   await expect(page.getByRole("heading", { level: 1, name: "登录" })).toBeVisible();
  47  | });
  48  | 
  49  | test("个人主页只显示自己的提交，新词条差异含标题与简介且不向其他编者公开", async ({ page, browser, baseURL }) => {
  50  |   const author = await register(page.request);
  51  |   const title = `个人提交词条 ${randomUUID()}`;
  52  |   const summary = "这是一条尚待审核的新词条简介。";
  53  |   const created = await submit(page.request, { kind: "new_term", title, summary });
  54  | 
  55  |   await page.goto("/profile");
  56  |   await expect(page.getByRole("heading", { level: 1, name: "个人主页" })).toBeVisible();
  57  |   await expect(page.getByRole("banner").getByRole("link", { name: new RegExp(author.name) }))
  58  |     .toHaveAttribute("href", "/profile");
  59  | 
  60  |   const item = page.locator(`[data-submission-id="${created.submissionId}"]`);
  61  |   await expect(item).toContainText(title);
  62  |   await expect(item).toContainText("待审核");
  63  |   await page.getByRole("link", { name: "待审核", exact: true }).click();
  64  |   await expect(page).toHaveURL(/\/profile\?status=pending$/);
  65  |   await expect(item).toBeVisible();
  66  | 
  67  |   await item.getByRole("link", { name: "查看差异", exact: true }).click();
  68  |   await expect(page).toHaveURL(new RegExp(`/profile/submissions/${created.submissionId}$`));
  69  |   const diff = page.getByTestId("content-diff");
  70  |   await expect(diff).toContainText(title);
  71  |   await expect(diff).toContainText(summary);
  72  | 
  73  |   const otherContext = await browser.newContext({ baseURL });
  74  |   try {
  75  |     await register(otherContext.request, "T09 另一位编者");
  76  |     const otherTitle = `其他编者的词条 ${randomUUID()}`;
  77  |     const other = await submit(otherContext.request, { kind: "new_term", title: otherTitle });
  78  |     const otherPage = await otherContext.newPage();
  79  |     await otherPage.goto("/profile");
  80  |     await expect(otherPage.locator(`[data-submission-id="${other.submissionId}"]`)).toContainText(otherTitle);
  81  |     await expect(otherPage.locator(`[data-submission-id="${created.submissionId}"]`)).toHaveCount(0);
  82  |     await expect(otherPage.getByText(summary, { exact: true })).toHaveCount(0);
  83  | 
  84  |     await otherPage.goto(`/profile/submissions/${created.submissionId}`);
  85  |     await expect(otherPage.getByRole("heading", { level: 1, name: "404", exact: true })).toBeVisible();
  86  |     await expect(otherPage.getByTestId("content-diff")).toHaveCount(0);
  87  |     await expect(otherPage.getByText(summary, { exact: true })).toHaveCount(0);
  88  |   } finally {
  89  |     await otherContext.close();
  90  |   }
  91  | });
  92  | 
  93  | test("受理与驳回通知保留理由原文，未读数与已读状态持久，提交历史可按状态筛选", async ({ page, request }) => {
  94  |   test.skip(!ADMIN_PASSWORD, "需要 SEED_ADMIN_PASSWORD（与既有审核浏览器用例相同）");
  95  |   await register(page.request);
  96  |   await loginAdmin(request);
  97  | 
  98  |   const approved = await submit(page.request, { kind: "new_term", title: `通知受理词条 ${randomUUID()}` });
  99  |   const rejected = await submit(page.request, { kind: "new_interpreter", title: `通知驳回诠释者 ${randomUUID()}` });
  100 |   const pending = await submit(page.request, { kind: "new_term", title: `通知待审核词条 ${randomUUID()}` });
  101 |   await page.goto("/profile");
  102 |   const banner = page.getByRole("banner");
  103 |   await expect(banner.getByRole("link", { name: "通知", exact: true })).toBeVisible();
  104 |   await expect(page.locator("[data-notification-id]")).toHaveCount(0);
  105 |   await banner.getByRole("link", { name: "PhoskyWiki", exact: true }).click();
  106 |   await expect(page.getByRole("heading", { level: 1, name: "PhoskyWiki", exact: true })).toBeVisible();
  107 | 
  108 |   const approveResponse = await request.post(`/api/admin/submissions/${approved.submissionId}/review`, {
  109 |     data: { action: "approve" },
  110 |   });
  111 |   expect(approveResponse.ok()).toBe(true);
  112 |   expect(await approveResponse.json()).toMatchObject({ outcome: "approved" });
  113 |   const reason = "  请补充 <em>原文出处</em>。\n\n保留这一行的  两个空格。  ";
  114 |   const rejectResponse = await request.post(`/api/admin/submissions/${rejected.submissionId}/review`, {
  115 |     data: { action: "reject", reason },
  116 |   });
  117 |   expect(rejectResponse.ok()).toBe(true);
  118 | 
  119 |   // 审核来自另一个会话；普通站内导航也应更新页头，不能依赖整页刷新。
  120 |   await banner.getByTestId("session-user").click();
  121 |   await expect(page.getByRole("heading", { level: 1, name: "个人主页", exact: true })).toBeVisible();
  122 |   await expect(banner.getByRole("link", { name: "通知（2 条未读）", exact: true })).toBeVisible();
  123 |   await expect(page.getByRole("heading", { level: 2, name: "通知", exact: true })).toBeVisible();
  124 |   const approvedNotice = page.locator(`[data-notification-id="${approved.submissionId}"]`);
  125 |   const rejectedNotice = page.locator(`[data-notification-id="${rejected.submissionId}"]`);
  126 |   await expect(approvedNotice).toContainText("已受理");
  127 |   await expect(rejectedNotice).toContainText("已驳回");
```