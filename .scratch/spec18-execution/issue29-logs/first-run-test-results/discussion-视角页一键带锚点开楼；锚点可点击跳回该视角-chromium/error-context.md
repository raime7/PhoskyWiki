# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: discussion.spec.ts >> 视角页一键带锚点开楼；锚点可点击跳回该视角
- Location: tests\e2e\discussion.spec.ts:92:5

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
  1   | // 讨论区端到端（T13）：词条讨论区开楼与一层回复、游客只读、视角锚点一键开楼、
  2   | // 版务软删与锁定。种子管理员登录走 /login（角色徽标「管理员」出现在页头）。
  3   | // SEED_ADMIN_PASSWORD 未配置（种子走随机密码）的环境自动跳过。
  4   | 
  5   | import "dotenv/config";
  6   | 
  7   | import { expect, test, type Page } from "@playwright/test";
  8   | 
  9   | const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local";
  10  | const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
  11  | 
  12  | test.skip(!ADMIN_PASSWORD, "需要 .env 配置 SEED_ADMIN_PASSWORD（种子管理员密码）");
  13  | 
  14  | /** 打开 主体性 词条页并进入其讨论区（返回讨论区 URL 断言用）。 */
  15  | async function openDiscussion(page: Page): Promise<void> {
  16  |   await page.goto("/");
  17  |   await page.getByRole("link", { name: "主体性", exact: true }).click();
  18  |   await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  19  |   await page.getByRole("link", { name: /讨论区（\d+ 楼）→/ }).click();
  20  |   await expect(
  21  |     page.getByRole("heading", { level: 1, name: "「主体性」的讨论区" }),
  22  |   ).toBeVisible();
  23  | }
  24  | 
  25  | async function loginAdmin(page: Page): Promise<void> {
  26  |   await page.goto("/login");
  27  |   await page.getByLabel("邮箱").fill(ADMIN_EMAIL);
  28  |   await page.getByLabel("密码").fill(ADMIN_PASSWORD!);
  29  |   await page.getByRole("button", { name: "登录" }).click();
> 30  |   await expect(page.getByTestId("session-user")).toContainText("管理员");
      |                                                  ^ Error: expect(locator).toContainText(expected) failed
  31  | }
  32  | 
  33  | test("游客只读讨论区；管理员开楼并一层回复", async ({ page }) => {
  34  |   const floorContent = `e2e 讨论楼层 ${Date.now()}`;
  35  |   const replyContent = `e2e 一层回复 ${Date.now()}`;
  36  | 
  37  |   // 游客：能读讨论区，但没有发言框，只有登录引导；登录链接带回跳（含锚点预填）
  38  |   await openDiscussion(page);
  39  |   await expect(page.getByLabel("发言内容")).toHaveCount(0);
  40  |   await expect(page.getByText("登录后即可发言")).toBeVisible();
  41  |   const loginHref = await page
  42  |     .getByRole("main")
  43  |     .getByRole("link", { name: "登录", exact: true })
  44  |     .getAttribute("href");
  45  |   expect(loginHref).toMatch(/^\/login\?redirect=%2Fterm%2F/);
  46  | 
  47  |   // 登录种子管理员
  48  |   await loginAdmin(page);
  49  |   await openDiscussion(page);
  50  | 
  51  |   // 开楼
  52  |   await page.getByLabel("发言内容").fill(floorContent);
  53  |   await page.getByRole("button", { name: "发言", exact: true }).click();
  54  |   const floor = page.locator('[data-testid="discussion-floors"] > li').filter({
  55  |     hasText: floorContent,
  56  |   });
  57  |   await expect(floor).toBeVisible();
  58  |   // 软删后楼层正文换成占位，按内容过滤的定位器会失效——改用稳定的楼层锚 id
  59  |   const floorId = (await floor.locator("article").getAttribute("id"))!;
  60  | 
  61  |   // 对该楼层做一层嵌套回复
  62  |   await floor.getByRole("button", { name: "回复", exact: true }).click();
  63  |   await floor.getByLabel("回复内容").fill(replyContent);
  64  |   await floor.getByRole("button", { name: "回复", exact: true }).last().click();
  65  |   await expect(floor.getByText(replyContent)).toBeVisible();
  66  | 
  67  |   // 版务：软删这层回复 → 占位；内容不再外发（回复在楼层内的 ul>li 里，别误删外层楼层）
  68  |   await page
  69  |     .locator("article ul > li")
  70  |     .filter({ hasText: replyContent })
  71  |     .getByRole("button", { name: "删除", exact: true })
  72  |     .click();
  73  |   await expect(page.getByText("该回复已被版务删除。")).toBeVisible();
  74  |   await expect(page.getByText(replyContent)).toHaveCount(0);
  75  | 
  76  |   // 版务：软删楼层（删除按钮在楼层 header 里）
  77  |   await page
  78  |     .locator(`#${floorId}`)
  79  |     .locator("header")
  80  |     .getByRole("button", { name: "删除", exact: true })
  81  |     .click();
  82  |   await expect(page.locator(`#${floorId}`).getByText("该楼层已被版务删除。")).toBeVisible();
  83  | 
  84  |   // 版务：锁定讨论 → 发言框消失且出现锁定横幅；解锁恢复
  85  |   await page.getByRole("button", { name: "锁定讨论" }).click();
  86  |   await expect(page.getByText("本讨论区已被版务锁定")).toBeVisible();
  87  |   await expect(page.getByLabel("发言内容")).toHaveCount(0);
  88  |   await page.getByRole("button", { name: "解锁讨论" }).click();
  89  |   await expect(page.getByLabel("发言内容")).toBeVisible();
  90  | });
  91  | 
  92  | test("视角页一键带锚点开楼；锚点可点击跳回该视角", async ({ page }) => {
  93  |   await loginAdmin(page);
  94  | 
  95  |   // 从首页进入 拉康论主体性 视角页
  96  |   await page.goto("/");
  97  |   await page.getByRole("link", { name: "主体性", exact: true }).click();
  98  |   await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  99  |   await page.getByRole("link", { name: "拉康论主体性" }).first().click();
  100 |   await expect(page.getByRole("heading", { level: 1, name: "拉康论主体性" })).toBeVisible();
  101 | 
  102 |   // 一键开楼：带锚点跳到讨论区，发言框已显示锚点
  103 |   await page.getByRole("link", { name: /就这个视角发起讨论/ }).click();
  104 |   await expect(
  105 |     page.getByRole("heading", { level: 1, name: "「主体性」的讨论区" }),
  106 |   ).toBeVisible();
  107 |   await expect(page.getByText("视角锚点：").locator("..")).toContainText("拉康论主体性");
  108 | 
  109 |   // 发言后楼层携带锚点徽标，点击徽标跳回视角页
  110 |   const anchored = `e2e 锚点楼层 ${Date.now()}`;
  111 |   await page.getByLabel("发言内容").fill(anchored);
  112 |   await page.getByRole("button", { name: "发言", exact: true }).click();
  113 |   const floor = page.locator('[data-testid="discussion-floors"] > li').filter({
  114 |     hasText: anchored,
  115 |   });
  116 |   await expect(floor).toBeVisible();
  117 |   await floor.getByRole("link", { name: /锚点 · 拉康论主体性/ }).click();
  118 |   await expect(page.getByRole("heading", { level: 1, name: "拉康论主体性" })).toBeVisible();
  119 | });
  120 | 
```