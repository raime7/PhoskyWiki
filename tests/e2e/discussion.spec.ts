// 讨论区端到端（T13）：词条讨论区开楼与一层回复、游客只读、视角锚点一键开楼、
// 版务软删与锁定。种子管理员登录走 /login（角色徽标「管理员」出现在页头）。
// SEED_ADMIN_PASSWORD 未配置（种子走随机密码）的环境自动跳过。

import "dotenv/config";

import { expect, test, type Page } from "./fixtures";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

test.skip(!ADMIN_PASSWORD, "需要 .env 配置 SEED_ADMIN_PASSWORD（种子管理员密码）");

/** 打开 主体性 词条页并进入其讨论区（返回讨论区 URL 断言用）。 */
async function openDiscussion(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  await page.getByRole("link", { name: /讨论区（\d+ 楼）→/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "「主体性」的讨论区" }),
  ).toBeVisible();
}

async function loginAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码").fill(ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByTestId("session-user")).toContainText("管理员");
}

test("游客只读讨论区；管理员开楼并一层回复", async ({ page }) => {
  const floorContent = `e2e 讨论楼层 ${Date.now()}`;
  const replyContent = `e2e 一层回复 ${Date.now()}`;

  // 游客：能读讨论区，但没有发言框，只有登录引导；登录链接带回跳（含锚点预填）
  await openDiscussion(page);
  await expect(page.getByLabel("发言内容")).toHaveCount(0);
  await expect(page.getByText("登录后即可发言")).toBeVisible();
  const loginHref = await page
    .getByRole("main")
    .getByRole("link", { name: "登录", exact: true })
    .getAttribute("href");
  expect(loginHref).toMatch(/^\/login\?redirect=%2Fterm%2F/);

  // 登录种子管理员
  await loginAdmin(page);
  await openDiscussion(page);

  // 开楼
  await page.getByLabel("发言内容").fill(floorContent);
  await page.getByRole("button", { name: "发言", exact: true }).click();
  const floor = page.locator('[data-testid="discussion-floors"] > li').filter({
    hasText: floorContent,
  });
  await expect(floor).toBeVisible();
  // 软删后楼层正文换成占位，按内容过滤的定位器会失效——改用稳定的楼层锚 id
  const floorId = (await floor.locator("article").getAttribute("id"))!;

  // 对该楼层做一层嵌套回复
  await floor.getByRole("button", { name: "回复", exact: true }).click();
  await floor.getByLabel("回复内容").fill(replyContent);
  await floor.getByRole("button", { name: "回复", exact: true }).last().click();
  await expect(floor.getByText(replyContent)).toBeVisible();

  // 版务：软删这层回复 → 占位；内容不再外发（回复在楼层内的 ul>li 里，别误删外层楼层）
  await page
    .locator("article ul > li")
    .filter({ hasText: replyContent })
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await expect(page.getByText("该回复已被版务删除。")).toBeVisible();
  await expect(page.getByText(replyContent)).toHaveCount(0);

  // 版务：软删楼层（删除按钮在楼层 header 里）
  await page
    .locator(`#${floorId}`)
    .locator("header")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await expect(page.locator(`#${floorId}`).getByText("该楼层已被版务删除。")).toBeVisible();

  // 版务：锁定讨论 → 发言框消失且出现锁定横幅；解锁恢复
  await page.getByRole("button", { name: "锁定讨论" }).click();
  await expect(page.getByText("本讨论区已被版务锁定")).toBeVisible();
  await expect(page.getByLabel("发言内容")).toHaveCount(0);
  await page.getByRole("button", { name: "解锁讨论" }).click();
  await expect(page.getByLabel("发言内容")).toBeVisible();
});

test("视角页一键带锚点开楼；锚点可点击跳回该视角", async ({ page }) => {
  await loginAdmin(page);

  // 从首页进入 拉康论主体性 视角页
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  await page.getByRole("link", { name: "拉康论主体性" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "拉康论主体性" })).toBeVisible();

  // 一键开楼：带锚点跳到讨论区，发言框已显示锚点
  await page.getByRole("link", { name: /就这个视角发起讨论/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "「主体性」的讨论区" }),
  ).toBeVisible();
  await expect(page.getByText("视角锚点：").locator("..")).toContainText("拉康论主体性");

  // 发言后楼层携带锚点徽标，点击徽标跳回视角页
  const anchored = `e2e 锚点楼层 ${Date.now()}`;
  await page.getByLabel("发言内容").fill(anchored);
  await page.getByRole("button", { name: "发言", exact: true }).click();
  const floor = page.locator('[data-testid="discussion-floors"] > li').filter({
    hasText: anchored,
  });
  await expect(floor).toBeVisible();
  await floor.getByRole("link", { name: /锚点 · 拉康论主体性/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "拉康论主体性" })).toBeVisible();
});
