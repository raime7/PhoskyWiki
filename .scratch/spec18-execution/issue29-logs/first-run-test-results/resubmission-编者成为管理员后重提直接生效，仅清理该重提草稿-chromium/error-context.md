# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: resubmission.spec.ts >> 编者成为管理员后重提直接生效，仅清理该重提草稿
- Location: tests\e2e\resubmission.spec.ts:187:5

# Error details

```
TypeError: Cannot read properties of undefined (reading 'id')
```

# Test source

```ts
  96  |       const { submissionId } = await (await editor.request.post("/api/submissions", { data: payload })).json();
  97  |       await page.request.post(`/api/admin/submissions/${submissionId}/review`, { data: { action: "reject", reason: "重新整理" } });
  98  |       await create(type === "term" ? { ...payload, summary: "最新版简介" } : { ...payload, content: "最新版正文" });
  99  |       expect((await outsider.request.get(`/profile/submissions/${submissionId}/resubmit`)).status()).toBe(404);
  100 |       expect((await outsider.request.post("/api/submissions", { data: { ...payload, supersedes: submissionId } })).status()).toBe(403);
  101 |       await editor.goto(`/profile/submissions/${submissionId}/resubmit`);
  102 |       await expect(editor.getByRole("region", { name: "最新版与原提案" })).toContainText(type === "term" ? "最新版简介" : "最新版正文");
  103 |       await expect(editor.getByRole("region", { name: "最新版与原提案" })).toContainText(type === "term" ? "原提案简介" : "原提案正文");
  104 |       await expect(editor.getByRole("button", { name: "提交审核", exact: true })).toBeDisabled();
  105 |       const input = type === "term" ? editor.getByLabel("一句话简介（信息框用）") : editor.getByRole("textbox", { name: "正文（Markdown）" });
  106 |       await input.fill(type === "term" ? "人工整理简介" : "人工整理正文");
  107 |       await editor.getByRole("checkbox", { name: /人工整理并确认/ }).check();
  108 |       if (type === "term") {
  109 |         await editor.getByLabel("词条标题", { exact: true }).fill("");
  110 |         await editor.getByRole("button", { name: "提交审核", exact: true }).click();
  111 |         await expect(editor.getByTestId("form-error")).toContainText("标题不能为空");
  112 |         await editor.reload();
  113 |         await expect(input).toHaveValue("人工整理简介");
  114 |         await editor.getByLabel("词条标题", { exact: true }).fill(head.snapshot.title);
  115 |         await editor.getByRole("checkbox", { name: /人工整理并确认/ }).check();
  116 |       }
  117 |       const submitted = editor.waitForResponse(r => r.url().endsWith("/api/submissions") && r.request().method() === "POST");
  118 |       await editor.getByRole("button", { name: "提交审核", exact: true }).click();
  119 |       const next = await (await submitted).json();
  120 |       await expect(editor.getByTestId("submit-success")).toBeVisible();
  121 |       expect((await page.request.post(`/api/admin/submissions/${next.submissionId}/review`, { data: { action: "approve" } })).ok()).toBe(true);
  122 |       await editor.goto(target.href);
  123 |       await expect(editor.getByText(type === "term" ? "人工整理简介" : "人工整理正文", { exact: true }).first()).toBeVisible();
  124 |       await editor.goto(`/profile/submissions/${submissionId}/resubmit`);
  125 |       await input.fill("删除后仍需保留的草稿");
  126 |       await expect(editor.getByText(/草稿已自动保存/)).toBeVisible();
  127 |       await page.request.post(`/api/admin/pages/${target.pageId}`, { data: { action: "delete" } });
  128 |       await editor.reload();
  129 |       await expect(editor.getByRole("alert").filter({ hasText: "目标页面" })).toBeVisible();
  130 |       await expect(editor.getByRole("button", { name: "提交审核", exact: true })).toBeDisabled();
  131 |       if (type === "term") await expect(input).toHaveValue("删除后仍需保留的草稿");
  132 |       else await expect(input).toContainText("删除后仍需保留的草稿");
  133 |       await page.request.post(`/api/admin/pages/${target.pageId}`, { data: { action: "restore" } });
  134 |     }
  135 |   } finally { await Promise.all([context.close(), outsider.close()]); }
  136 | });
  137 | 
  138 | test("新诠释者与新视角完整恢复，父页失效保留选择且可以调整目标重提", async ({ page, browser, baseURL }) => {
  139 |   test.setTimeout(120_000);
  140 |   await page.request.post("/api/auth/sign-in/email", { data: { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD } });
  141 |   const context = await browser.newContext({ baseURL });
  142 |   const editor = await context.newPage();
  143 |   const create = async (data: object) => { const r = await page.request.post("/api/submissions", { data }); expect(r.status()).toBe(201); return r.json(); };
  144 |   try {
  145 |     await editor.request.post("/api/auth/sign-up/email", { data: { email: `${randomUUID()}@example.com`, password: "password123", name: "视角编者" } });
  146 |     const title = `Interpreter retry ${randomUUID()}`;
  147 |     const { submissionId } = await (await editor.request.post("/api/submissions", { data: { kind: "new_interpreter", title, summary: "诠释者完整简介" } })).json();
  148 |     await page.request.post(`/api/admin/submissions/${submissionId}/review`, { data: { action: "reject", reason: "补充人物资料" } });
  149 |     await editor.goto(`/profile/submissions/${submissionId}/resubmit`);
  150 |     await expect(editor.getByLabel("诠释者名称")).toHaveValue(title);
  151 |     await expect(editor.getByLabel("一句话简介（信息框用）")).toHaveValue("诠释者完整简介");
  152 |     await editor.getByLabel("一句话简介（信息框用）").fill("补充后的资料");
  153 |     await expect(editor.getByText(/草稿已自动保存/)).toBeVisible();
  154 |     await editor.reload();
  155 |     await expect(editor.getByLabel("一句话简介（信息框用）")).toHaveValue("补充后的资料");
  156 |     const response = editor.waitForResponse(r => r.url().endsWith("/api/submissions") && r.request().method() === "POST");
  157 |     await editor.getByRole("button", { name: "提交审核", exact: true }).click();
  158 |     const next = await (await response).json();
  159 |     expect((await page.request.post(`/api/admin/submissions/${next.submissionId}/review`, { data: { action: "approve" } })).ok()).toBe(true);
  160 |     const interpreter = await create({ kind: "new_interpreter", title: `Perspective retry ${randomUUID()}` });
  161 |     const term = await create({ kind: "new_term", title: `Unavailable ${randomUUID()}` });
  162 |     const replacement = await create({ kind: "new_term", title: `Replacement ${randomUUID()}` });
  163 |     const { submissionId: perspectiveId } = await (await editor.request.post("/api/submissions", { data: { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "完整视角提案" } })).json();
  164 |     await page.request.post(`/api/admin/submissions/${perspectiveId}/review`, { data: { action: "reject", reason: "调整目标" } });
  165 |     await editor.goto(`/profile/submissions/${perspectiveId}/resubmit`);
  166 |     await expect(editor.getByLabel("所属词条")).toHaveValue(String(term.pageId));
  167 |     await expect(editor.getByRole("combobox", { name: "诠释者", exact: true })).toHaveValue(String(interpreter.pageId));
  168 |     await expect(editor.getByRole("textbox", { name: "正文（Markdown）" })).toContainText("完整视角提案");
  169 |     await page.request.post(`/api/admin/pages/${term.pageId}`, { data: { action: "delete" } });
  170 |     await editor.getByRole("button", { name: "提交审核", exact: true }).click();
  171 |     await expect(editor.getByTestId("form-error")).toContainText("已删除");
  172 |     await editor.reload();
  173 |     await expect(editor.getByRole("alert").filter({ hasText: "原所属词条不可用" })).toBeVisible();
  174 |     await expect(editor.getByLabel("所属词条")).toHaveValue(String(term.pageId));
  175 |     await editor.getByLabel("所属词条").selectOption(String(replacement.pageId));
  176 |     const resubmitted = editor.waitForResponse(r => r.url().endsWith("/api/submissions") && r.request().method() === "POST");
  177 |     await editor.getByRole("button", { name: "提交审核", exact: true }).click();
  178 |     const moved = await (await resubmitted).json();
  179 |     expect((await page.request.post(`/api/admin/submissions/${moved.submissionId}/review`, { data: { action: "approve" } })).ok()).toBe(true);
  180 |     await editor.goto(replacement.href);
  181 |     await editor.getByRole("link", { name: /Perspective retry.*论Replacement/ }).click();
  182 |     await expect(editor.getByText("完整视角提案", { exact: true })).toBeVisible();
  183 |   } finally { await context.close(); }
  184 | });
  185 | 
  186 | 
  187 | test("编者成为管理员后重提直接生效，仅清理该重提草稿", async ({ page, browser, baseURL }) => {
  188 |   test.setTimeout(90_000);
  189 |   await page.request.post("/api/auth/sign-in/email", { data: { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD } });
  190 |   const context = await browser.newContext({ baseURL });
  191 |   const editor = await context.newPage();
  192 |   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  193 |   let editorId: string | undefined;
  194 |   try {
  195 |     const account = await editor.request.post("/api/auth/sign-up/email", { data: { email: `${randomUUID()}@example.com`, password: "password123", name: "晋升编者" } });
> 196 |     editorId = (await account.json()).user.id;
      |                                            ^ TypeError: Cannot read properties of undefined (reading 'id')
  197 |     const title = `Promoted ${randomUUID()}`;
  198 |     const { submissionId } = await (await editor.request.post("/api/submissions", { data: { kind: "new_interpreter", title, summary: "原资料" } })).json();
  199 |     await page.request.post(`/api/admin/submissions/${submissionId}/review`, { data: { action: "reject", reason: "补全后重提" } });
  200 |     await editor.goto(`/profile/submissions/${submissionId}/resubmit`);
  201 |     await editor.getByLabel("一句话简介（信息框用）").fill("晋升后的完整资料");
  202 |     await expect(editor.getByText(/草稿已自动保存/)).toBeVisible();
  203 |     await editor.evaluate(() => localStorage.setItem("phoskywiki:draft:new-term", "unrelated draft"));
  204 |     await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', ["admin", editorId]);
  205 |     await editor.reload();
  206 |     await editor.getByRole("button", { name: "提交（直接生效）" }).click();
  207 |     await expect(editor.getByTestId("submit-success")).toContainText("已直接生效");
  208 |     expect(await editor.evaluate(() => Object.keys(localStorage).filter(key => key.includes(":resubmit:")))).toEqual([]);
  209 |     expect(await editor.evaluate(() => localStorage.getItem("phoskywiki:draft:new-term"))).toBe("unrelated draft");
  210 |     await editor.getByRole("link", { name: "查看页面 →" }).click();
  211 |     await editor.waitForURL("**/interpreter/**");
  212 |     await expect(editor.getByText("晋升后的完整资料", { exact: true })).toBeVisible();
  213 |     await editor.goto(`/profile/submissions/${submissionId}`);
  214 |     await expect(editor.getByText("已驳回", { exact: true })).toBeVisible();
  215 |   } finally {
  216 |     if (editorId) await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', ["editor", editorId]);
  217 |     await pool.end();
  218 |     await context.close();
  219 |   }
  220 | });
  221 | 
```