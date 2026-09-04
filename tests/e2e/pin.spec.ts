// 管理员置顶全流程（T04 置顶 × T05 角色）：游客看不到置顶开关；
// 种子管理员（pnpm db:seed 依 .env 的 SEED_ADMIN_* 灌入）登录后
// 可置顶/取消置顶，视角列表经 router.refresh() 实时重排。
// SEED_ADMIN_PASSWORD 未配置（种子走随机密码）的环境自动跳过。

import "dotenv/config";

import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

test.skip(!ADMIN_PASSWORD, "需要 .env 配置 SEED_ADMIN_PASSWORD（种子管理员密码）");

// 词条页的视角列表区（编委会通俗视角单独渲染，不在本列表里）
const SECTION = '[aria-labelledby="perspectives-heading"]';

async function perspectiveTitles(page: Page): Promise<string[]> {
  return page.locator(`${SECTION} li > div > a.font-medium`).allTextContents();
}

test("游客看不到置顶开关；管理员置顶后列表重排，取消后恢复", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();

  // 先等词条页真正渲染（click 不等导航完成，下面的读取才不会落在旧页面上）
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();

  // 游客视角：整个页面没有任何置顶控件
  await expect(page.getByRole("button", { name: /取消?置顶/ })).toHaveCount(0);

  await expect.poll(() => perspectiveTitles(page)).toContain("拉康论主体性");
  const before = await perspectiveTitles(page);

  // 登录种子管理员（角色徽标「管理员」出现在页头）
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码").fill(ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByTestId("session-user")).toContainText("管理员");

  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();

  const lacan = page
    .locator(`${SECTION} li`)
    .filter({ hasText: "拉康论主体性" });
  try {
    await lacan.getByRole("button", { name: "置顶", exact: true }).click();

    // 列表实时重排：拉康升到首位（紧随通俗视角），带置顶徽标
    const pinned = [
      "拉康论主体性",
      ...before.filter((title) => title !== "拉康论主体性"),
    ];
    await expect.poll(() => perspectiveTitles(page)).toEqual(pinned);
    await expect(lacan.getByTestId("pin-badge")).toBeVisible();

    // 取消置顶：恢复原热度序，徽标消失
    await lacan.getByRole("button", { name: "取消置顶" }).click();
    await expect.poll(() => perspectiveTitles(page)).toEqual(before);
    await expect(lacan.getByTestId("pin-badge")).toHaveCount(0);
  } finally {
    // 中途失败时兜底取消，避免把置顶状态留在共享的 dev 库
    const undo = page.getByRole("button", { name: "取消置顶" });
    if ((await undo.count()) > 0) {
      await undo.first().click();
      await expect.poll(() => perspectiveTitles(page)).toEqual(before);
    }
  }
});
