# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: term-history.spec.ts >> 词条两次编辑、非相邻字段比较、带来源回滚、id链接与撞名失败
- Location: tests\e2e\term-history.spec.ts:15:5

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
  6   | async function submit(request: APIRequestContext, data: object) {
  7   |   const response = await request.post("/api/submissions", { data });
  8   |   expect(response.status()).toBe(201);
  9   |   return response.json();
  10  | }
  11  | async function signIn(request: APIRequestContext) {
> 12  |   expect((await request.post("/api/auth/sign-in/email", { data: { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD } })).ok()).toBe(true);
      |                                                                                                                                                              ^ Error: expect(received).toBe(expected) // Object.is equality
  13  | }
  14  | 
  15  | test("词条两次编辑、非相邻字段比较、带来源回滚、id链接与撞名失败", async ({ page, browser, baseURL }) => {
  16  |   test.setTimeout(120_000);
  17  |   await signIn(page.request);
  18  |   const token = randomUUID();
  19  |   const title = `History Original ${token}`;
  20  |   const newestTitle = `History Latest ${token}`;
  21  |   const term = await submit(page.request, { kind: "new_term", title, summary: "原始简介", aliases: ["原始别名"], content: "独立通俗视角" });
  22  |   const source = await submit(page.request, { kind: "new_term", title: `Linked ${token}`, content: `参见 [[${title}]]。` });
  23  |   const api = `/api/pages/${term.pageId}/history`;
  24  |   const first = (await (await page.request.get(api)).json()).revisions[0].id;
  25  |   await page.goto(`/edit/${term.pageId}`);
  26  |   await page.getByLabel("词条标题", { exact: true }).fill(`History Middle ${token}`);
  27  |   await page.getByLabel("一句话简介（信息框用）").fill("中间简介");
  28  |   await page.getByLabel("别名（信息框用，以逗号分隔）").fill("中间别名");
  29  |   await page.getByRole("button", { name: "提交（直接生效）", exact: true }).click();
  30  |   await expect(page.getByTestId("submit-success")).toBeVisible();
  31  |   const middle = (await (await page.request.get(api)).json()).revisions[0].id;
  32  |   const editorContext = await browser.newContext({ baseURL });
  33  |   try {
  34  |     expect((await editorContext.request.post("/api/auth/sign-up/email", { data: { email: `history-editor-${token}@example.com`, password: "password123", name: "历史编者" } })).ok()).toBe(true);
  35  |     const proposal = await submit(editorContext.request, { kind: "edit", pageId: term.pageId, baseRevisionId: middle, title: newestTitle, summary: "最新简介", aliases: ["最新别名", "另一别名"] });
  36  |     expect(proposal.quorum).toBe(1);
  37  |     const approved = await page.request.post(`/api/admin/submissions/${proposal.submissionId}/review`, { data: { action: "approve" } });
  38  |     expect(await approved.json()).toMatchObject({ outcome: "approved" });
  39  |     const before = await (await page.request.get(api)).json();
  40  |     const last = before.revisions[0].id;
  41  |     await page.goto(`/history/${term.pageId}`);
  42  |     await expect(page.getByTestId("history-revision").nth(0)).toContainText("普通受理");
  43  |     await expect(page.getByTestId("history-revision").nth(1)).toContainText("管理员直编");
  44  |     await expect(page.getByTestId("history-revision").nth(2)).toContainText("新建");
  45  |     await page.getByLabel("起始修订", { exact: true }).selectOption(String(first));
  46  |     await page.getByLabel("目标修订", { exact: true }).selectOption(String(last));
  47  |     await page.getByRole("button", { name: "对比修订", exact: true }).click();
  48  |     const diff = page.getByTestId("term-metadata-diff");
  49  |     await expect(diff.locator('[data-changed="true"]')).toHaveCount(3);
  50  |     await expect(diff).toContainText(title);
  51  |     await expect(diff).toContainText(newestTitle);
  52  |     await expect(diff).toContainText("原始简介");
  53  |     await expect(diff).toContainText("最新简介");
  54  |     await expect(diff).toContainText("原始别名");
  55  |     await expect(diff).toContainText('"最新别名"、"另一别名"');
  56  |     await expect(diff).toContainText("起始修订");
  57  |     await page.getByRole("button", { name: `回滚到修订 #${first}`, exact: true }).click();
  58  |     await expect(page.getByTestId("history-revision")).toHaveCount(4);
  59  |     await expect(page.getByTestId("history-revision").first()).toContainText(`回滚自 #${first}`);
  60  |     const after = await (await page.request.get(api)).json();
  61  |     expect(after.revisions.slice(1)).toEqual(before.revisions);
  62  |     await page.goto(`/term/${before.page.slug}-${term.pageId}`);
  63  |     await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  64  |     await expect(page).toHaveURL(new RegExp(`/term/history-original-.*-${term.pageId}$`));
  65  |     await expect(page.getByText("原始简介", { exact: true }).first()).toBeVisible();
  66  |     await expect(page.getByText("原始别名", { exact: true })).toBeVisible();
  67  |     await expect(page.getByText("独立通俗视角", { exact: true })).toBeVisible();
  68  |     await page.goto(source.href);
  69  |     await page.locator(".wiki-content").getByRole("link", { name: title, exact: true }).click();
  70  |     await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  71  |     await submit(page.request, { kind: "new_term", title: newestTitle });
  72  |     await page.goto(`/history/${term.pageId}`);
  73  |     await page.getByRole("button", { name: `回滚到修订 #${last}`, exact: true }).click();
  74  |     await expect(page.getByTestId("history-revision").getByRole("alert")).toContainText("回滚失败：历史标题已存在");
  75  |     await expect(page.getByTestId("history-revision")).toHaveCount(4);
  76  |     expect(await (await page.request.get(api)).json()).toEqual(after);
  77  |     await page.goto(term.href);
  78  |     await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  79  |     await expect(page.getByText("原始简介", { exact: true }).first()).toBeVisible();
  80  |   } finally { await editorContext.close(); }
  81  | });
  82  | 
  83  | test("旧词条正文保留可读，不能猜测字段或回滚；起始快照可比较并恢复", async ({ page }) => {
  84  |   test.setTimeout(90_000);
  85  |   await signIn(page.request);
  86  |   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  87  |   let pageId: number;
  88  |   const title = `History Legacy ${randomUUID()}`;
  89  |   const legacyContent = '```json\n{"title":"不能猜测的标题","summary":"不能猜测的简介","aliases":["不能猜测的别名"]}\n```';
  90  |   try {
  91  |     const result = await pool.query("INSERT INTO pages(type,title,slug) VALUES('term',$1,'legacy') RETURNING id", [title]);
  92  |     pageId = result.rows[0].id;
  93  |     await pool.query("INSERT INTO terms(page_id,summary,aliases) VALUES($1,$2,$3)", [pageId, "真实起始简介", ["真实起始别名"]]);
  94  |     await pool.query("INSERT INTO revisions(page_id,content) VALUES($1,$2)", [pageId, legacyContent]);
  95  |   } finally { await pool.end(); }
  96  |   const api = `/api/pages/${pageId}/history`;
  97  |   const original = await (await page.request.get(api)).json();
  98  |   const legacy = original.revisions[0].id;
  99  |   await page.goto(`/history/${pageId}`);
  100 |   await expect(page.getByText(/未保存词条信息快照/)).toBeVisible();
  101 |   await expect(page.getByRole("button", { name: `回滚到修订 #${legacy}`, exact: true })).toHaveCount(0);
  102 |   await page.getByText("查看修订正文", { exact: true }).click();
  103 |   await expect(page.locator("pre")).toHaveText(legacyContent);
  104 |   expect((await page.request.post(`/api/admin/pages/${pageId}`, { data: { action: "rollback", revisionId: legacy } })).status()).toBe(409);
  105 |   expect(await (await page.request.get(api)).json()).toEqual(original);
  106 |   await page.goto(`/edit/${pageId}`);
  107 |   const baseline = (await (await page.request.get(api)).json()).revisions[0].id;
  108 |   await page.getByLabel("词条标题", { exact: true }).fill(`${title} Renamed`);
  109 |   await page.getByLabel("一句话简介（信息框用）").fill("新简介");
  110 |   await page.getByLabel("别名（信息框用，以逗号分隔）").fill("新别名");
  111 |   await page.getByRole("button", { name: "提交（直接生效）", exact: true }).click();
  112 |   await expect(page.getByTestId("submit-success")).toBeVisible();
```