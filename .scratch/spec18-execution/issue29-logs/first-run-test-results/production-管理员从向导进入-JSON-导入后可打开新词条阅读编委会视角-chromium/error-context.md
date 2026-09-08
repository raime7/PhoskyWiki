# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: production.spec.ts >> 管理员从向导进入 JSON 导入后可打开新词条阅读编委会视角
- Location: tests\e2e\production.spec.ts:35:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('session-user')
Expected substring: "管理员"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for getByTestId('session-user')

```

```yaml
- banner:
  - link "PhoskyWiki":
    - /url: /
  - navigation "主导航":
    - link "词条":
      - /url: /terms
    - link "诠释者":
      - /url: /interpreters
    - link "学派":
      - /url: /schools
    - link "分类":
      - /url: /categories
    - link "图谱":
      - /url: /graph
    - link "搜索":
      - /url: /search
    - link "兴趣":
      - /url: /interests
  - combobox:
    - search:
      - textbox "全站搜索":
        - /placeholder: 搜索词条 / 诠释者 / 视角…
  - link "登录":
    - /url: /login
  - link "注册":
    - /url: /register
- main:
  - heading "登录" [level=1]
  - paragraph: 未登录也可以浏览全站内容；登录后才能提交编辑。
  - text: 邮箱
  - textbox "邮箱": admin@phoskywiki.local
  - text: 密码
  - textbox "密码": Spec18-local-test-password-2026
  - alert: Too many requests. Please try again later.
  - button "登录"
  - paragraph:
    - text: 还没有账号？
    - link "注册":
      - /url: /register
- contentinfo: PhoskyWiki · 词条 × 视角的原子笔记 WIKI
- alert
```

# Test source

```ts
  1  | import "dotenv/config";
  2  | import { randomUUID } from "node:crypto";
  3  | import { expect, test } from "@playwright/test";
  4  | 
  5  | test("编者用词条骨架向导填写信息框与通俗解读并提交审核", async ({ page }) => {
  6  |   await page.goto("/register");
  7  |   await page.getByLabel("名称").fill("T15向导编者");
  8  |   await page.getByLabel("邮箱").fill(`t15-wizard-${randomUUID()}@example.com`);
  9  |   await page.getByLabel("密码（至少 8 位）").fill("password123");
  10 |   await page.getByRole("button", { name: "注册并登录" }).click();
  11 |   await expect(page.getByTestId("session-user")).toContainText("编者");
  12 |   await page.goto("/new/term");
  13 |   await page.getByLabel("词条标题").fill(`向导词条-${randomUUID()}`);
  14 |   await page.getByLabel("一句话简介（信息框用）").fill("向导填写的简介");
  15 |   await page.getByLabel("别名（信息框用，以逗号分隔）").fill("别名一,别名二");
  16 |   const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
  17 |   await expect(editor).toContainText("## 通俗解读");
  18 |   await expect(editor).toContainText("其他视角（待补充）");
  19 |   await expect(editor).toContainText("引用与延伸阅读");
  20 |   await editor.fill("## 通俗解读\n向导正文标记\n\n## 引用\n测试出处");
  21 |   await expect(page.getByRole("region", { name: "实时预览" })).toContainText("向导正文标记");
  22 |   await expect(page.getByText(/草稿已自动保存/)).toBeVisible();
  23 |   await page.reload();
  24 |   await expect(editor).toContainText("向导正文标记");
  25 |   await expect(page.getByLabel("一句话简介（信息框用）")).toHaveValue("向导填写的简介");
  26 |   await expect(page.getByLabel("别名（信息框用，以逗号分隔）")).toHaveValue("别名一,别名二");
  27 |   await page.getByRole("button", { name: "提交审核" }).click();
  28 |   await expect(page.getByTestId("submit-success")).toContainText("等待审核");
  29 |   await page.getByRole("link", { name: "查看提交历史 →" }).click();
  30 |   await page.getByRole("link", { name: /查看差异|查看详情|提交详情/ }).first().click();
  31 |   await expect(page.getByTestId("content-diff")).toContainText("向导正文标记");
  32 |   await expect(page.getByTestId("content-diff")).toContainText("别名一");
  33 | });
  34 | 
  35 | test("管理员从向导进入 JSON 导入后可打开新词条阅读编委会视角", async ({ page }) => {
  36 |   test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  37 |   await page.goto("/login");
  38 |   await page.getByLabel("邮箱").fill(process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local");
  39 |   await page.getByLabel("密码").fill(process.env.SEED_ADMIN_PASSWORD!);
  40 |   await page.getByRole("button", { name: "登录" }).click();
> 41 |   await expect(page.getByTestId("session-user")).toContainText("管理员");
     |                                                  ^ Error: expect(locator).toContainText(expected) failed
  42 |   await page.goto("/new/term");
  43 |   await page.getByRole("link", { name: "批量导入 JSON →" }).click();
  44 |   const title = `导入词条-${randomUUID()}`;
  45 |   await page.getByLabel("导入 JSON").fill(JSON.stringify({ interpreters: [{ title: `导入诠释者-${randomUUID()}` }], terms: [{ title, aliases: ["导入别名"], content: "## 通俗解读\n浏览器导入正文" }] }));
  46 |   await page.getByRole("button", { name: "导入并直接发布" }).click();
  47 |   await expect(page.getByRole("status")).toContainText("已导入 2 个");
  48 |   await page.getByRole("link", { name: new RegExp(title) }).click();
  49 |   await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  50 |   await expect(page.getByText("浏览器导入正文")).toBeVisible();
  51 |   await expect(page.getByText("导入别名", { exact: true })).toBeVisible();
  52 | });
  53 | 
```