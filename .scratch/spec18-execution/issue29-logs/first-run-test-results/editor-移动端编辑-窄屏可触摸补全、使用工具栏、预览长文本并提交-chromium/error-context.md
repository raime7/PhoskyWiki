# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor.spec.ts >> 移动端编辑 >> 窄屏可触摸补全、使用工具栏、预览长文本并提交
- Location: tests\e2e\editor.spec.ts:78:7

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('session-user')
Expected substring: "编者"
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
  - link "登录":
    - /url: /login
  - link "注册":
    - /url: /register
- main:
  - heading "注册成为编者" [level=1]
  - paragraph: 注册后可提交词条与视角的编辑，经审核受理后生效。
  - text: 名称
  - textbox "名称":
    - /placeholder: 站内展示的编者名称
    - text: 编辑器测试编者
  - text: 邮箱
  - textbox "邮箱": t07-abaebf48-b9a4-46a6-823d-207f79fabc55@example.com
  - text: 密码（至少 8 位）
  - textbox "密码（至少 8 位）": password123
  - alert: Too many requests. Please try again later.
  - button "注册并登录"
  - paragraph:
    - text: 已有账号？
    - link "登录":
      - /url: /login
- contentinfo: PhoskyWiki · 词条 × 视角的原子笔记 WIKI
- alert
```

# Test source

```ts
  1  | import { randomUUID } from "node:crypto";
  2  | import { expect, test, type Page } from "@playwright/test";
  3  | 
  4  | async function openNewPerspective(page: Page) {
  5  |   await page.goto("/register");
  6  |   await page.getByLabel("名称").fill("编辑器测试编者");
  7  |   await page.getByLabel("邮箱").fill(`t07-${randomUUID()}@example.com`);
  8  |   await page.getByLabel("密码（至少 8 位）").fill("password123");
  9  |   await page.getByRole("button", { name: "注册并登录" }).click();
> 10 |   await expect(page.getByTestId("session-user")).toContainText("编者");
     |                                                  ^ Error: expect(locator).toContainText(expected) failed
  11 |   await page.goto("/new/perspective");
  12 | }
  13 | 
  14 | test("正文工具栏、实时预览与本地草稿", async ({ page }) => {
  15 |   await openNewPerspective(page);
  16 |   const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
  17 |   await expect(editor).toHaveAttribute("contenteditable", "true");
  18 |   await editor.fill("预览文字");
  19 |   await editor.press("ControlOrMeta+a");
  20 |   await page.getByRole("button", { name: "粗体", exact: true }).click();
  21 |   const preview = page.getByRole("region", { name: "实时预览" });
  22 |   await expect(preview.locator("strong")).toHaveText("预览文字");
  23 |   await page.getByRole("button", { name: "撤销", exact: true }).click();
  24 |   await expect(preview.locator("strong")).toHaveCount(0);
  25 |   await expect(page.getByText(/草稿已自动保存/)).toBeVisible();
  26 |   await page.reload();
  27 |   await expect(editor).toHaveText("预览文字");
  28 |   await expect(preview).toContainText("预览文字");
  29 | });
  30 | 
  31 | test("[[ 补全已有词条与红链，预览精确视角并过滤不安全 HTML", async ({ page }) => {
  32 |   await openNewPerspective(page);
  33 |   const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
  34 |   await editor.pressSequentially("[[主体");
  35 |   await page.getByRole("listbox").getByRole("option", { name: "主体性", exact: true }).click();
  36 |   await expect(editor).toHaveText("[[主体性]]");
  37 |   const preview = page.getByRole("region", { name: "实时预览" });
  38 |   await expect(preview.getByRole("link", { name: "主体性", exact: true })).toHaveAttribute("href", /^\/term\//);
  39 |   await editor.fill("");
  40 |   await editor.pressSequentially("[[未创建的词条T07");
  41 |   await page.getByRole("listbox").getByRole("option", { name: /未创建的词条T07.*将创建红链/ }).click();
  42 |   await expect(editor).toHaveText("[[未创建的词条T07]]");
  43 |   await expect(preview.getByText("未创建的词条T07", { exact: true })).toHaveAttribute("title", "词条尚未创建");
  44 |   await editor.fill('[[主体性|视角@拉康]] <script>alert(1)</script> [危险](javascript:alert)');
  45 |   await expect(preview.getByRole("link", { name: "视角", exact: true })).toHaveAttribute("href", /^\/perspective\//);
  46 |   await expect(preview.locator("script, [href^='javascript:']")).toHaveCount(0);
  47 | });
  48 | 
  49 | test("新建视角即时拒绝重复组合，换选后仍可提交审核", async ({ page }) => {
  50 |   await openNewPerspective(page);
  51 |   await page.getByLabel("所属词条").selectOption({ label: "主体性" });
  52 |   await page.getByRole("combobox", { name: /^诠释者/ }).selectOption({ label: "拉康" });
  53 |   await expect(page.locator("form").getByRole("alert")).toContainText("该诠释者在此词条下已有视角");
  54 |   await expect(page.getByRole("button", { name: "提交审核", exact: true })).toBeDisabled();
  55 |   await page.getByLabel("所属词条").selectOption({ label: "剩余价值" });
  56 |   await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
  57 |   await page.getByRole("textbox", { name: "正文（Markdown）" }).fill("新视角的提议正文。");
  58 |   await page.getByRole("button", { name: "提交审核", exact: true }).click();
  59 |   await expect(page.getByTestId("submit-success")).toContainText("等待审核");
  60 | });
  61 | 
  62 | test("补全闭合新双链并保留后续普通竖线文本", async ({ page }) => {
  63 |   await openNewPerspective(page);
  64 |   const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
  65 |   await editor.fill("| [[主体 | 后续说明 |");
  66 |   await editor.press("ControlOrMeta+Home");
  67 |   for (let i = 0; i < 6; i++) await editor.press("ArrowRight");
  68 |   await editor.press("Control+Space");
  69 |   await page.getByRole("listbox").getByRole("option", { name: "主体性", exact: true }).click();
  70 |   await expect(editor).toHaveText("| [[主体性]] | 后续说明 |");
  71 |   await expect(page.getByRole("region", { name: "实时预览" }).getByRole("link", { name: "主体性" }))
  72 |     .toHaveAttribute("href", /^\/term\//);
  73 | });
  74 | 
  75 | test.describe("移动端编辑", () => {
  76 |   test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  77 | 
  78 |   test("窄屏可触摸补全、使用工具栏、预览长文本并提交", async ({ page }, testInfo) => {
  79 |     await openNewPerspective(page);
  80 |     await page.getByLabel("所属词条").selectOption({ label: "剩余价值" });
  81 |     await page.getByRole("combobox", { name: /^诠释者/ }).selectOption({ label: "黑格尔" });
  82 |     const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
  83 |     await editor.tap();
  84 |     await editor.pressSequentially("[[主体");
  85 |     await page.getByRole("listbox").getByRole("option", { name: "主体性", exact: true }).tap();
  86 |     await expect(editor).toHaveText("[[主体性]]");
  87 |     await editor.fill("很长的原文术语 " + "LongUnbrokenWord".repeat(20));
  88 |     await editor.press("ControlOrMeta+a");
  89 |     await page.getByRole("button", { name: "粗体", exact: true }).tap();
  90 |     await expect(page.getByRole("region", { name: "实时预览" }).locator("strong")).toContainText("很长的原文术语");
  91 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  92 |     await page.screenshot({ path: testInfo.outputPath("mobile-editor.png"), fullPage: true });
  93 |     await page.getByRole("button", { name: "提交审核", exact: true }).tap();
  94 |     await expect(page.getByTestId("submit-success")).toContainText("等待审核");
  95 |   });
  96 | });
  97 | 
```