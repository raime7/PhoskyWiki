# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: review.spec.ts >> 编者提交 → 管理员受理 → 游客可见新内容
- Location: tests\e2e\review.spec.ts:43:5

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
  - combobox:
    - search:
      - textbox "全站搜索":
        - /placeholder: 搜索词条 / 诠释者 / 视角…
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
    - text: E2E 审核编者
  - text: 邮箱
  - textbox "邮箱": e2e-review-4bda9db1-4712-47ec-8cfc-53cad0237733@example.com
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
  1   | // 审核流全流程（T06 验收）：编者提交 → 管理员在队列看 diff 后受理 → 游客可见新内容。
  2   | // 走种子数据（主体性 词条的编委会通俗视角）；种子管理员登录受理。
  3   | // 本地库只有一名种子管理员，quorum = min(2, 1) = 1——单票即生效（冷启动退化路径）。
  4   | // SEED_ADMIN_PASSWORD 未配置（种子走随机密码）的环境自动跳过。
  5   | 
  6   | import "dotenv/config";
  7   | 
  8   | import { randomUUID } from "node:crypto";
  9   | 
  10  | import { expect, test, type Page } from "@playwright/test";
  11  | 
  12  | const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local";
  13  | const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
  14  | 
  15  | test.skip(!ADMIN_PASSWORD, "需要 .env 配置 SEED_ADMIN_PASSWORD（种子管理员密码）");
  16  | 
  17  | async function openSubjectivityBoard(page: Page): Promise<void> {
  18  |   await page.goto("/");
  19  |   await page.getByRole("link", { name: "主体性", exact: true }).click();
  20  |   await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  21  |   // 词条页内联编委会通俗视角，「查看视角页」进入其视角页
  22  |   await page.getByRole("link", { name: "查看视角页 →" }).click();
  23  |   await expect(page.getByRole("heading", { level: 1, name: "编委会论主体性" })).toBeVisible();
  24  | }
  25  | 
  26  | /** 拉康论主体性视角页（与通俗视角不同目标，两个用例可并行互不干扰）。 */
  27  | async function openLacanPerspective(page: Page): Promise<void> {
  28  |   await page.goto("/");
  29  |   await page.getByRole("link", { name: "主体性", exact: true }).click();
  30  |   await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  31  |   await page.getByRole("link", { name: "拉康论主体性", exact: true }).click();
  32  |   await expect(page.getByRole("heading", { level: 1, name: "拉康论主体性" })).toBeVisible();
  33  | }
  34  | 
  35  | async function login(page: Page, email: string, password: string): Promise<void> {
  36  |   await page.goto("/login");
  37  |   await page.getByLabel("邮箱").fill(email);
  38  |   await page.getByLabel("密码").fill(password);
  39  |   await page.getByRole("button", { name: "登录" }).click();
  40  |   await expect(page.getByRole("heading", { level: 1, name: "PhoskyWiki" })).toBeVisible();
  41  | }
  42  | 
  43  | test("编者提交 → 管理员受理 → 游客可见新内容", async ({ page }) => {
  44  |   const marker = `E2E 受理标记 ${Date.now()}`;
  45  | 
  46  |   // 游客看不到编辑入口
  47  |   await openSubjectivityBoard(page);
  48  |   await expect(page.getByRole("link", { name: "编辑", exact: true })).toHaveCount(0);
  49  | 
  50  |   // 注册新编者并登录
  51  |   const email = `e2e-review-${randomUUID()}@example.com`;
  52  |   await page.goto("/register");
  53  |   await page.getByLabel("名称").fill("E2E 审核编者");
  54  |   await page.getByLabel("邮箱").fill(email);
  55  |   await page.getByLabel("密码（至少 8 位）").fill("password123");
  56  |   await page.getByRole("button", { name: "注册并登录" }).click();
> 57  |   await expect(page.getByTestId("session-user")).toContainText("编者");
      |                                                  ^ Error: expect(locator).toContainText(expected) failed
  58  | 
  59  |   // 编辑通俗视角：追加一段标记文字，提交进审核队列
  60  |   await openSubjectivityBoard(page);
  61  |   await page.getByRole("link", { name: "编辑", exact: true }).click();
  62  |   await expect(
  63  |     page.getByRole("heading", { level: 1, name: "编辑：编委会论主体性" }),
  64  |   ).toBeVisible();
  65  | 
  66  |   const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
  67  |   await editor.press("ControlOrMeta+End");
  68  |   await editor.press("Enter");
  69  |   await editor.pressSequentially(`${marker}。`);
  70  |   await page.getByRole("button", { name: "提交审核" }).click();
  71  |   await expect(page.getByTestId("submit-success")).toContainText("等待审核");
  72  | 
  73  |   // 登出后以游客身份确认新内容尚未生效
  74  |   await page.getByRole("button", { name: "登出" }).click();
  75  |   await expect(page.getByRole("banner")).toContainText("登录");
  76  |   await page.goto("/");
  77  |   await page.getByRole("link", { name: "主体性", exact: true }).click();
  78  |   await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  79  |   await expect(page.getByText(marker)).toHaveCount(0);
  80  | 
  81  |   // 种子管理员在审核队列看「当前版 vs 提案」diff 后受理
  82  |   await login(page, ADMIN_EMAIL, ADMIN_PASSWORD!);
  83  |   await page.getByRole("link", { name: "审核队列" }).click();
  84  |   await expect(page.getByRole("heading", { level: 1, name: /审核队列/ })).toBeVisible();
  85  | 
  86  |   const item = page.locator("[data-submission-id]").filter({ hasText: "编委会论主体性" });
  87  |   await expect(item).toContainText("编辑视角");
  88  |   await item.locator("summary").click();
  89  |   await expect(item.getByTestId("content-diff")).toContainText(marker);
  90  | 
  91  |   await item.getByRole("button", { name: "受理", exact: true }).click();
  92  |   // 受理生效后提交离开队列
  93  |   await expect(item).toHaveCount(0);
  94  | 
  95  |   // 登出后游客读路径立即可见新内容（词条页内联通俗视角）
  96  |   await page.getByRole("button", { name: "登出" }).click();
  97  |   await expect(page.getByRole("banner")).toContainText("登录");
  98  |   await page.goto("/");
  99  |   await page.getByRole("link", { name: "主体性", exact: true }).click();
  100 |   await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  101 |   await expect(page.getByText(marker)).toBeVisible();
  102 | });
  103 | 
  104 | test("驳回必填理由：不填无法提交驳回", async ({ page }) => {
  105 |   // 用一个新编者对拉康视角提交，管理员尝试无理由驳回
  106 |   const email = `e2e-reject-${randomUUID()}@example.com`;
  107 |   await page.goto("/register");
  108 |   await page.getByLabel("名称").fill("E2E 驳回编者");
  109 |   await page.getByLabel("邮箱").fill(email);
  110 |   await page.getByLabel("密码（至少 8 位）").fill("password123");
  111 |   await page.getByRole("button", { name: "注册并登录" }).click();
  112 |   await expect(page.getByTestId("session-user")).toContainText("编者");
  113 | 
  114 |   const marker = `待驳回标记 ${Date.now()}`;
  115 |   await openLacanPerspective(page);
  116 |   await page.getByRole("link", { name: "编辑", exact: true }).click();
  117 |   const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
  118 |   await editor.press("ControlOrMeta+End");
  119 |   await editor.press("Enter");
  120 |   await editor.pressSequentially(`${marker}。`);
  121 |   await page.getByRole("button", { name: "提交审核" }).click();
  122 |   await expect(page.getByTestId("submit-success")).toContainText("等待审核");
  123 | 
  124 |   await login(page, ADMIN_EMAIL, ADMIN_PASSWORD!);
  125 |   await page.getByRole("link", { name: "审核队列" }).click();
  126 |   const item = page.locator("[data-submission-id]").filter({ hasText: "拉康论主体性" });
  127 |   await item.getByRole("button", { name: "驳回…" }).click();
  128 |   // 理由为空时确认驳回不可点
  129 |   await expect(item.getByRole("button", { name: "确认驳回" })).toBeDisabled();
  130 | 
  131 |   // 填理由驳回 → 队列移除该提交，内容未生效
  132 |   await item.getByLabel(/驳回理由/).fill("测试驳回：理由必填。");
  133 |   await item.getByRole("button", { name: "确认驳回" }).click();
  134 |   await expect(item).toHaveCount(0);
  135 | 
  136 |   await page.getByRole("button", { name: "登出" }).click();
  137 |   await openLacanPerspective(page);
  138 |   await expect(page.getByText(marker)).toHaveCount(0);
  139 | });
  140 | 
```