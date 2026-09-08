# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: term-edit.spec.ts >> 词条草稿、独立编辑、两票逐字段审核、旧 URL 与普通及显式双链
- Location: tests\e2e\term-edit.spec.ts:13:5

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
  3   | import { Pool } from "pg";
  4   | import { expect, test, type APIRequestContext } from "@playwright/test";
  5   | 
  6   | const password = process.env.SEED_ADMIN_PASSWORD!;
  7   | async function create(request: APIRequestContext, data: object) {
  8   |   const response = await request.post("/api/submissions", { data });
  9   |   expect(response.status()).toBe(201);
  10  |   return response.json();
  11  | }
  12  | 
  13  | test("词条草稿、独立编辑、两票逐字段审核、旧 URL 与普通及显式双链", async ({ page, browser, baseURL }) => {
  14  |   test.setTimeout(120_000);
  15  |   expect(password, "独立环境必须配置种子管理员").toBeTruthy();
  16  |   const signed = await page.request.post("/api/auth/sign-in/email", { data: { email: process.env.SEED_ADMIN_EMAIL, password } });
> 17  |   expect(signed.ok()).toBe(true);
      |                       ^ Error: expect(received).toBe(expected) // Object.is equality
  18  |   const token = randomUUID();
  19  |   const originalTitle = `Metadata Old ${token}`;
  20  |   const renamedTitle = `Metadata New ${token}`;
  21  |   const term = await create(page.request, { kind: "new_term", title: originalTitle, summary: "原简介", aliases: ["原别名"], content: "通俗视角保持独立。" });
  22  |   const interpreter = await create(page.request, { kind: "new_interpreter", title: `Reader ${token}` });
  23  |   const targetPerspective = await create(page.request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "精确指向的视角。" });
  24  |   const source = await create(page.request, { kind: "new_term", title: `Source ${token}`, content: `普通 [[${originalTitle}]]，显式 [[${originalTitle}|精确链接@Reader ${token}]]，别名 [[新别名]]。` });
  25  |   const historyUrl = `/api/pages/${term.pageId}/history`;
  26  |   const perspectiveHistory = await (await page.request.get(`/api/pages/${targetPerspective.pageId}/history`)).json();
  27  |   const editorContext = await browser.newContext({ baseURL });
  28  |   const reviewerContext = await browser.newContext({ baseURL });
  29  |   const visitorContext = await browser.newContext({ baseURL });
  30  |   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  31  |   let secondAdminId: string | undefined;
  32  |   try {
  33  |     const editor = await editorContext.newPage();
  34  |     expect((await editor.request.post("/api/auth/sign-up/email", { data: { email: `term-editor-${token}@example.com`, password: "password123", name: "词条编者" } })).ok()).toBe(true);
  35  |     const adminSignup = await reviewerContext.request.post("/api/auth/sign-up/email", { data: { email: `term-admin-${token}@example.com`, password: "password123", name: "第二管理员" } });
  36  |     secondAdminId = (await adminSignup.json()).user.id;
  37  |     await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', ["admin", secondAdminId]);
  38  |     const visitor = await visitorContext.newPage();
  39  |     await visitor.goto(term.href);
  40  |     await expect(visitor.getByRole("link", { name: "编辑词条信息", exact: true })).toHaveCount(0);
  41  |     await editor.goto(term.href);
  42  |     await expect(editor.getByRole("link", { name: "编辑通俗视角", exact: true })).toBeVisible();
  43  |     await editor.getByRole("link", { name: "编辑词条信息", exact: true }).click();
  44  |     await expect(editor.getByRole("textbox", { name: "正文（Markdown）" })).toHaveCount(0);
  45  |     await editor.getByLabel("词条标题", { exact: true }).fill(renamedTitle);
  46  |     await editor.getByLabel("一句话简介（信息框用）").fill("新简介");
  47  |     await editor.getByLabel("别名（信息框用，以逗号分隔）").fill("新别名,另一个别名");
  48  |     await expect(editor.getByText(/草稿已自动保存/)).toBeVisible();
  49  |     await editor.reload();
  50  |     await expect(editor.getByLabel("词条标题", { exact: true })).toHaveValue(renamedTitle);
  51  |     await expect(editor.getByLabel("一句话简介（信息框用）")).toHaveValue("新简介");
  52  |     await expect(editor.getByLabel("别名（信息框用，以逗号分隔）")).toHaveValue("新别名,另一个别名");
  53  |     const proposalResponse = editor.waitForResponse((r) => r.url().endsWith("/api/submissions") && r.request().method() === "POST");
  54  |     await editor.getByRole("button", { name: "提交审核", exact: true }).click();
  55  |     const proposal = await (await proposalResponse).json();
  56  |     expect(proposal.quorum).toBe(2);
  57  |     await expect(editor.getByTestId("submit-success")).toBeVisible();
  58  |     expect(await editor.evaluate((id) => localStorage.getItem(`phoskywiki:draft:edit_term:${id}`), term.pageId)).toBeNull();
  59  |     await editor.goto(`/profile/submissions/${proposal.submissionId}`);
  60  |     await expect(editor.getByTestId("term-metadata-diff")).toContainText(renamedTitle);
  61  |     await visitor.reload();
  62  |     await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(originalTitle);
  63  |     await expect(visitor.getByText("原简介", { exact: true }).first()).toBeVisible();
  64  |     await page.goto("/review");
  65  |     const entry = page.locator(`[data-submission-id="${proposal.submissionId}"]`);
  66  |     await expect(entry).toContainText("编辑词条信息");
  67  |     await entry.locator("summary").click();
  68  |     const diff = entry.getByTestId("term-metadata-diff");
  69  |     await expect(diff.locator('[data-changed="true"]')).toHaveCount(3);
  70  |     await expect(diff).toContainText("原简介");
  71  |     await expect(diff).toContainText("新简介");
  72  |     await entry.getByRole("button", { name: "受理", exact: true }).click();
  73  |     await expect(entry).toContainText("批准 1/2");
  74  |     await visitor.reload();
  75  |     await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(originalTitle);
  76  |     const second = await reviewerContext.newPage();
  77  |     await second.goto("/review");
  78  |     await second.locator(`[data-submission-id="${proposal.submissionId}"]`).getByRole("button", { name: "受理", exact: true }).click();
  79  |     await expect(second.locator(`[data-submission-id="${proposal.submissionId}"]`)).toHaveCount(0);
  80  |     await visitor.goto(term.href);
  81  |     await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(renamedTitle);
  82  |     await expect(visitor.getByText("新简介", { exact: true }).first()).toBeVisible();
  83  |     await expect(visitor.getByText("新别名、另一个别名", { exact: true })).toBeVisible();
  84  |     await expect(visitor.getByText("通俗视角保持独立。", { exact: true })).toBeVisible();
  85  |     expect(visitor.url()).not.toContain("metadata-old");
  86  |     const current = await (await page.request.get(historyUrl)).json();
  87  |     expect(current.revisions).toHaveLength(2);
  88  |     expect(current.revisions[0]).toMatchObject({ source: "approval", snapshot: { title: renamedTitle, aliases: ["新别名", "另一个别名"] } });
  89  |     expect(await (await page.request.get(`/api/pages/${targetPerspective.pageId}/history`)).json()).toEqual(perspectiveHistory);
  90  |     await visitor.goto(source.href);
  91  |     await expect(visitor.locator(".wiki-link--red").filter({ hasText: "新别名" })).toBeVisible();
  92  |     await visitor.locator(".wiki-content").getByRole("link", { name: originalTitle, exact: true }).click();
  93  |     await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(renamedTitle);
  94  |     await visitor.goto(source.href);
  95  |     await visitor.locator(".wiki-content").getByRole("link", { name: "精确链接", exact: true }).click();
  96  |     await expect(visitor.getByText("精确指向的视角。", { exact: true })).toBeVisible();
  97  |   } finally {
  98  |     if (secondAdminId) await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', ["editor", secondAdminId]);
  99  |     await pool.end();
  100 |     await Promise.all([editorContext.close(), reviewerContext.close(), visitorContext.close()]);
  101 |   }
  102 | });
  103 | 
  104 | test("旧词条从真实字段建立一次起始快照，草稿过期与存储禁用不覆盖新版", async ({ page }) => {
  105 |   test.setTimeout(90_000);
  106 |   expect((await page.request.post("/api/auth/sign-in/email", { data: { email: process.env.SEED_ADMIN_EMAIL, password } })).ok()).toBe(true);
  107 |   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  108 |   const title = `Legacy ${randomUUID()}`;
  109 |   let pageId: number;
  110 |   try {
  111 |     const result = await pool.query("INSERT INTO pages(type,title,slug) VALUES('term',$1,'legacy') RETURNING id", [title]);
  112 |     pageId = result.rows[0].id;
  113 |     await pool.query("INSERT INTO terms(page_id,summary,aliases) VALUES($1,$2,$3)", [pageId, "当前真实简介", ["真实别名"]]);
  114 |     await pool.query("INSERT INTO revisions(page_id,content) VALUES($1,$2)", [pageId, "旧纯正文，不代表旧信息框"]);
  115 |   } finally { await pool.end(); }
  116 |   const api = `/api/pages/${pageId}/history`;
  117 |   const before = await (await page.request.get(api)).json();
```