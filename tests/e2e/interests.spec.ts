// T12 兴趣标签全流程：游客 localStorage 路径（不注册也有体验）+
// 登录账号同步路径（换设备不丢）→ 词条页视角列表按兴趣重排。
// 每个用例独立浏览器上下文，localStorage 互不串扰。

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

// 词条页的视角列表区（编委会通俗视角单独渲染，不在本列表里）
const SECTION = '[aria-labelledby="perspectives-heading"]';

async function perspectiveTitles(page: Page): Promise<string[]> {
  return page.locator(`${SECTION} li > div > a.font-medium`).allTextContents();
}

async function gotoSubjectivity(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  // 等词条页真正渲染（click 不等导航完成）
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  // 视角列表默认折叠 5 条：先展开，取完整序（8 条视角都在断言范围内）
  const expand = page.getByRole("button", { name: /展开全部/ });
  if ((await expand.count()) > 0) {
    await expand.click();
  }
}

test("游客：选择兴趣即存本浏览器，词条页视角按兴趣重排", async ({ page }) => {
  await gotoSubjectivity(page);

  // 默认序（未设兴趣）：唯一被站内引用的 阿尔都塞论主体性 在首位，拉康不在首位
  await expect.poll(() => perspectiveTitles(page)).toContain("拉康论主体性");
  const before = await perspectiveTitles(page);
  expect(before[0]).not.toBe("拉康论主体性");

  // 相关词条区块：游客按共同引用强度（异化 10 > 意识形态 8 > 剩余价值 2 > 价值（哲学）1）
  const related = page.getByTestId("related-terms");
  await expect(related).toBeVisible();
  await expect(related).toContainText("异化");
  await expect(related).toContainText("意识形态");
  await expect(related.locator("li").first()).toContainText("异化");
  // 游客无兴趣：不出现兴趣匹配徽标
  await expect(page.getByTestId("interest-match-badge")).toHaveCount(0);

  await page.goto("/interests");
  await page.getByLabel("拉康", { exact: true }).check();

  // localStorage 已写入（游客路径不落服务端）
  const stored = await page.evaluate(() =>
    window.localStorage.getItem("phoskywiki:interest-tags"),
  );
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored!).interpreters).toHaveLength(1);

  await gotoSubjectivity(page);
  // 水合后重排：拉康论主体性 升到首位，其余保持默认序，并出现提示
  await expect
    .poll(() => perspectiveTitles(page))
    .toEqual(["拉康论主体性", ...before.filter((title) => title !== "拉康论主体性")]);
  await expect(page.getByTestId("interest-reorder-hint")).toBeVisible();
});

test("登录：兴趣保存到账号并跨页持久，词条页视角按兴趣重排", async ({ page }) => {
  // 注册前先以游客视角记录默认序（独立上下文，无本地兴趣）
  await gotoSubjectivity(page);
  await expect.poll(() => perspectiveTitles(page)).toContain("德勒兹论主体性");
  const before = await perspectiveTitles(page);

  const email = `t12-e2e-${randomUUID()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("名称").fill("兴趣同步编者");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码（至少 8 位）").fill("password123");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByTestId("session-user")).toContainText("编者");

  await page.goto("/interests");
  await page.getByLabel("德勒兹", { exact: true }).check();
  await page.getByRole("button", { name: "保存到账号" }).click();
  await expect(page.getByTestId("interest-saved")).toBeVisible();

  // 服务端持久：整页重开仍勾选
  await page.goto("/interests");
  await expect(page.getByLabel("德勒兹", { exact: true })).toBeChecked();

  // 个人主页展示当前兴趣
  await page.goto("/profile");
  await expect(page.getByTestId("profile-interest-chips")).toContainText("德勒兹");

  // 登录路径：SSR 即重排（无需等水合），德勒兹论主体性 升到首位
  await gotoSubjectivity(page);
  await expect
    .poll(() => perspectiveTitles(page))
    .toEqual(["德勒兹论主体性", ...before.filter((title) => title !== "德勒兹论主体性")]);
  await expect(page.getByTestId("interest-reorder-hint")).toBeVisible();
});
