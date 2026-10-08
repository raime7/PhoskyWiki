import { expect, test } from "./fixtures";

// 游客读路径全流程（依赖 pnpm db:seed 灌入的演示内容，见 CI 与 README）

test("词条页：视角并置列 + 信息框", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  // 导航页没有默认正文；所有解释均在具名视角中。
  await expect(page.locator("#board-heading")).toHaveCount(0);
  await expect(page.locator(".wiki-content")).toHaveCount(0);
  // 词条身份和目录在前，资料与关联探索各自可定位。
  const headings = await page.getByRole("main").getByRole("heading", { level: 2 }).allTextContents();
  expect(headings.findIndex(text => text.startsWith("诠释者视角"))).toBeLessThan(headings.indexOf("词条资料"));
  expect(headings.indexOf("词条资料")).toBeLessThan(headings.indexOf("继续探索"));
  await expect(page.getByRole("region", { name: "词条资料", exact: true })).toContainText("主体、subject");
  await expect(page.getByRole("region", { name: "继续探索", exact: true })).toContainText("相关词条");
  // 信息框
  await expect(page.getByText("词条（聚合枢纽）")).toBeVisible();
  await expect(page.getByText("主体、subject")).toBeVisible();
  // 并置列：8 个视角全部同宽排开（放不下时横向滚动），每列有首段摘录与读全文入口
  const columns = page.getByRole("list", { name: "视角目录" }).getByRole("listitem");
  await expect(columns).toHaveCount(8);
  await expect(page.getByRole("link", { name: "德勒兹论主体性", exact: true })).toBeVisible();
  await expect(columns.filter({ hasText: "德勒兹论主体性" }).getByRole("link", { name: "读全文", exact: true }))
    .toHaveAccessibleDescription("德勒兹论主体性");
});

test("全流程：词条 → 视角 → 双链落词条枢纽；红链可见", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();

  // 视角列表点进拉康的视角页
  await page.getByRole("link", { name: "拉康论主体性" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "拉康论主体性" })).toBeVisible();

  // 红链：未创建词条渲染为不可点击的缺口标记
  const redLink = page.locator(".wiki-link--red", { hasText: "镜像阶段" });
  await expect(redLink).toBeVisible();
  await expect(redLink).toHaveAttribute("title", "词条尚未创建");

  // 正文双链点击落到词条枢纽页
  await page.getByRole("link", { name: "意识形态", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "意识形态" })).toBeVisible();
  await expect(page).toHaveURL(/\/term\/.+/, { timeout: 5_000 });
});

test("诠释者页：信息框 + 全部视角索引", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();

  // 视角列表里的诠释者名进入诠释者页
  await page.getByRole("link", { name: "拉康", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "拉康" })).toBeVisible();
  await expect(page.getByText("1901–1981", { exact: true })).toBeVisible();

  // 视角索引：其全部视角（含所属词条链接）
  await expect(page.getByRole("link", { name: "拉康论主体性", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "主体性", exact: true })).toBeVisible();
});

test("仅凭 id 亦可解析：/term/<id> 重定向到规范路径", async ({ page }) => {
  await page.goto("/");
  const href = await page
    .getByRole("link", { name: "主体性", exact: true })
    .getAttribute("href");
  expect(href).toBeTruthy();
  const id = href!.match(/(\d+)$/)![1];

  await page.goto(`/term/${id}`);
  await expect(page).toHaveURL(new RegExp(`/term/.+${id}$`));
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
});
