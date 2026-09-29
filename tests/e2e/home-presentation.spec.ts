import { expect, test, type Locator } from "./fixtures";
import { toggleTheme } from "./navigation-fixture";

const SLOGAN = "只有改变过去，才能创造新的未来";

async function expectInsideFirstScreen(locator: Locator, height: number) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
}

for (const width of [1440, 375]) {
  test(`首页 ${width}px 明暗首屏保留标语、检索、三轴与今日词条构成`, async ({ page }, testInfo) => {
    const height = width === 375 ? 812 : 900;
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const main = page.getByRole("main");
    const daily = main.getByRole("region", { name: "今日词条" });

    for (const theme of ["light", "dark"] as const) {
      if (theme === "dark") await toggleTheme(page);
      await page.evaluate(() => scrollTo(0, 0));
      await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(SLOGAN);
      await expect(main.getByText("一个概念，多种视角。", { exact: true })).toBeVisible();
      await expectInsideFirstScreen(main.getByRole("textbox", { name: "全站搜索" }), height);
      const axes = main.getByRole("navigation", { name: "三轴入口" });
      await expect(axes.getByRole("link")).toHaveCount(3);
      for (const link of await axes.getByRole("link").all()) await expectInsideFirstScreen(link, height);
      const headingSize = await main.getByRole("heading", { level: 1 }).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      expect(headingSize).toBeGreaterThanOrEqual(width === 375 ? 40 : 88);
      expect(headingSize).toBeLessThanOrEqual(width === 375 ? 56 : 120);
      // 今日词条：一个词条连向它的多个视角，每个视角都是可达的链接
      await expect(daily.getByRole("heading", { name: "今日词条", exact: true })).toBeVisible();
      await expect(daily.getByRole("link").first()).toHaveAttribute("href", /^\/term\//);
      expect(await daily.getByRole("list").getByRole("link").count()).toBeGreaterThanOrEqual(2);
      await expect(main.getByRole("heading", { name: "探索概念", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`home-${width}-${theme}.png`), fullPage: true });
      await page.screenshot({ path: testInfo.outputPath(`home-${width}-${theme}-first-screen.png`) });
    }
  });
}

test("今日词条同一天稳定，视角入口进入对应视角页", async ({ page }) => {
  await page.goto("/");
  const daily = page.getByRole("main").getByRole("region", { name: "今日词条" });
  const term = await daily.getByRole("link").first().innerText();
  await page.reload();
  await expect(daily.getByRole("link").first()).toHaveText(term);
  const ray = daily.getByRole("list").getByRole("link").first();
  const interpreter = await ray.locator("strong").innerText();
  await ray.click();
  await expect(page).toHaveURL(/\/perspective\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(interpreter);
});

test("首页三轴进入真实索引，概念计数与索引一致", async ({ page }) => {
  await page.goto("/");
  const totalLabel = await page.getByRole("link", { name: /^浏览全部 \d+ 个词条$/ }).innerText();
  const count = totalLabel.match(/\d+/)![0];
  for (const [name, path, heading] of [
    ["词条索引", "/terms", "词条索引"],
    ["诠释者索引", "/interpreters", "诠释者索引"],
    ["学派入口", "/schools", "学派"],
  ]) {
    await page.goto("/");
    await page.getByRole("navigation", { name: "三轴入口" }).getByRole("link", { name: new RegExp(name) }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    if (path === "/terms") await expect(page.getByRole("main")).toContainText(`共 ${count} 个词条`);
  }
});

test("首页真实搜索提交到词条，联想可用键盘直达视角", async ({ page }) => {
  test.skip(!process.env.E2E_MEILI_HOST, "Requires the isolated real search service");
  await page.goto("/");
  const search = page.getByRole("main").getByRole("textbox", { name: "全站搜索" });
  await search.fill("主体性");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=/);
  await page.getByTestId("search-results").getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体性", exact: true })).toBeVisible();
  await page.goto("/");
  await search.fill("拉康论主体性");
  const suggestions = page.getByRole("main").getByRole("listbox");
  await expect(suggestions.getByRole("option").first()).toContainText("拉康论主体性");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/perspective\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("拉康");
  await expect(page.locator(".wiki-content")).toBeVisible();
});

test("窄屏与中等宽度仍可在首屏搜索与进入三轴", async ({ page }) => {
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const main = page.getByRole("main");
    await expectInsideFirstScreen(main.getByRole("textbox", { name: "全站搜索" }), 900);
    for (const link of await main.getByRole("navigation", { name: "三轴入口" }).getByRole("link").all()) await expectInsideFirstScreen(link, 900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
