# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: spec18-combined.spec.ts >> 组合：游客兴趣推荐过滤 perspective 删除形成的不可见视角，恢复后重新出现
- Location: tests\e2e\spec18-combined.spec.ts:78:7

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
  3   | import { expect, test, type APIRequestContext } from "@playwright/test";
  4   | 
  5   | async function submit(request: APIRequestContext, data: object) {
  6   |   const response = await request.post("/api/submissions", { data });
  7   |   expect(response.status()).toBe(201);
  8   |   return response.json();
  9   | }
  10  | async function signIn(request: APIRequestContext) {
  11  |   expect((await request.post("/api/auth/sign-in/email", { data: {
  12  |     email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD,
> 13  |   } })).ok()).toBe(true);
      |               ^ Error: expect(received).toBe(expected) // Object.is equality
  14  | }
  15  | async function manage(request: APIRequestContext, pageId: number, action: "delete" | "restore") {
  16  |   expect((await request.post(`/api/admin/pages/${pageId}`, { data: { action } })).status()).toBe(200);
  17  | }
  18  | 
  19  | for (const parent of ["term", "interpreter"] as const) {
  20  |   test(`组合：${parent} 删除→系统驳回→恢复→从详情 UI 重提→公开阅读`, async ({ page, request }) => {
  21  |     test.setTimeout(120_000);
  22  |     await signIn(request);
  23  |     const token = randomUUID();
  24  |     expect((await page.request.post("/api/auth/sign-up/email", { data: {
  25  |       email: `combined-${token}@example.com`, name: "组合验收编者", password: "password123",
  26  |     } })).ok()).toBe(true);
  27  |     const term = await submit(request, { kind: "new_term", title: `组合父词条 ${token}`, content: "入门正文" });
  28  |     const interpreter = await submit(request, { kind: "new_interpreter", title: `组合诠释者 ${token}` });
  29  |     const content = `恢复后保留的完整提案 ${token}`;
  30  |     const old = await submit(page.request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content });
  31  |     const parentId = parent === "term" ? term.pageId : interpreter.pageId;
  32  |     try {
  33  |       await manage(request, parentId, "delete");
  34  |       const decision = await request.post(`/api/admin/submissions/${old.submissionId}/review`, { data: { action: "approve" } });
  35  |       expect(decision.status()).toBe(200);
  36  |       const { outcome, message } = await decision.json();
  37  |       expect(outcome).toBe("rejected");
  38  |       expect(message).toContain("系统驳回");
  39  |       await page.goto(`/profile/submissions/${old.submissionId}`);
  40  |       await expect(page.getByText(message, { exact: true })).toBeVisible();
  41  |       const oldReview = await page.getByRole("region", { name: "审核记录" }).innerText();
  42  |       await page.getByRole("link", { name: "修改后重新提交", exact: true }).click();
  43  |       await page.waitForURL(`**/profile/submissions/${old.submissionId}/resubmit`);
  44  |       await expect(page.getByRole("textbox", { name: "正文（Markdown）" })).toContainText(content);
  45  |       await expect(page.getByRole("alert").filter({ hasText: "不可用" })).toBeVisible();
  46  |       await expect(page.getByLabel("所属词条")).toHaveValue(String(term.pageId));
  47  |       await expect(page.getByRole("combobox", { name: "诠释者", exact: true })).toHaveValue(String(interpreter.pageId));
  48  |       await page.getByRole("textbox", { name: "正文（Markdown）" }).fill(`${content}\n补充来源后重提`);
  49  |       await expect(page.getByText(/草稿已自动保存/)).toBeVisible();
  50  |       await manage(request, parentId, "restore");
  51  |       await page.reload();
  52  |       await expect(page.getByRole("textbox", { name: "正文（Markdown）" })).toContainText("补充来源后重提");
  53  |       const response = page.waitForResponse(r => r.url().endsWith("/api/submissions") && r.request().method() === "POST");
  54  |       await page.getByRole("button", { name: "提交审核", exact: true }).click();
  55  |       const posted = await response;
  56  |       expect(posted.status()).toBe(201);
  57  |       const next = await posted.json();
  58  |       expect(next.submissionId).not.toBe(old.submissionId);
  59  |       await expect(page.getByTestId("submit-success")).toBeVisible();
  60  |       await page.goto(`/profile/submissions/${next.submissionId}`);
  61  |       await expect(page.getByRole("link", { name: `原驳回提交 #${old.submissionId}` })).toBeVisible();
  62  |       await expect(page.getByTestId("content-diff")).toContainText("补充来源后重提");
  63  |       const approved = await request.post(`/api/admin/submissions/${next.submissionId}/review`, { data: { action: "approve" } });
  64  |       expect(await approved.json()).toMatchObject({ outcome: "approved" });
  65  |       await page.goto(term.href);
  66  |       await page.getByRole("link", { name: `组合诠释者 ${token}论组合父词条 ${token}`, exact: true }).click();
  67  |       await expect(page.locator(".wiki-content")).toContainText(content);
  68  |       await expect(page.locator(".wiki-content")).toContainText("补充来源后重提");
  69  |       await page.goto(`/profile/submissions/${old.submissionId}`);
  70  |       await expect(page.getByText("已驳回", { exact: true })).toBeVisible();
  71  |       expect(await page.getByRole("region", { name: "审核记录" }).innerText()).toBe(oldReview);
  72  |       expect((await request.post(`/api/admin/submissions/${old.submissionId}/review`, { data: { action: "approve" } })).status()).toBe(409);
  73  |     } finally { await manage(request, parentId, "restore"); }
  74  |   });
  75  | }
  76  | 
  77  | for (const hidden of ["perspective", "term", "interpreter"] as const) {
  78  |   test(`组合：游客兴趣推荐过滤 ${hidden} 删除形成的不可见视角，恢复后重新出现`, async ({ page, request }) => {
  79  |     test.setTimeout(90_000);
  80  |     await signIn(request);
  81  |     const token = randomUUID();
  82  |     const title = `兴趣目标 ${token}`;
  83  |     const name = `兴趣诠释者 ${token}`;
  84  |     const target = await submit(request, { kind: "new_term", title });
  85  |     const interpreter = await submit(request, { kind: "new_interpreter", title: name });
  86  |     const perspective = await submit(request, { kind: "new_perspective", termId: target.pageId, interpreterId: interpreter.pageId, content: "兴趣匹配正文" });
  87  |     const source = await submit(request, { kind: "new_term", title: `兴趣起点 ${token}`, content: `[[${title}|兴趣目标@${name}]]` });
  88  |     const hiddenId = { perspective: perspective.pageId, term: target.pageId, interpreter: interpreter.pageId }[hidden];
  89  |     await page.goto("/interests");
  90  |     await page.getByLabel(name, { exact: true }).check();
  91  |     const discovery = `/api/terms/${source.pageId}/discovery?interests=${encodeURIComponent(JSON.stringify({ interpreters: [interpreter.pageId] }))}`;
  92  |     const related = page.getByTestId("related-terms");
  93  |     try {
  94  |       await page.goto(source.href);
  95  |       await expect(page.getByTestId("session-user")).toHaveCount(0);
  96  |       await expect(related.getByRole("link", { name: title, exact: true })).toBeVisible();
  97  |       expect((await (await page.request.get(discovery)).json()).relatedTerms).toEqual([
  98  |         expect.objectContaining({ id: target.pageId, interestMatchCount: 1 }),
  99  |       ]);
  100 |       await manage(request, hiddenId, "delete");
  101 |       await page.reload();
  102 |       await expect(related.getByRole("link", { name: title, exact: true })).toHaveCount(0);
  103 |       await expect(page.locator(".wiki-content .wiki-link--unavailable")).toHaveText("兴趣目标");
  104 |       expect((await (await page.request.get(discovery)).json()).relatedTerms).toEqual([]);
  105 |       await manage(request, hiddenId, "restore");
  106 |       await page.reload();
  107 |       await expect(related.getByRole("link", { name: title, exact: true })).toBeVisible();
  108 |       await expect(page.locator(".wiki-content a.wiki-link")).toHaveAttribute("href", perspective.href);
  109 |       expect((await (await page.request.get(discovery)).json()).relatedTerms).toEqual([
  110 |         expect.objectContaining({ id: target.pageId, interestMatchCount: 1 }),
  111 |       ]);
  112 |     } finally { await manage(request, hiddenId, "restore"); }
  113 |   });
```