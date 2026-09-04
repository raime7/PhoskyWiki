import { expect, test } from "@playwright/test";

// 游客读路径全流程（依赖 pnpm db:seed 灌入的演示内容，见 CI 与 README）

test("词条页：通俗视角全文置顶 + 视角列表折叠展开 + 信息框", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  // 通俗视角全文置顶（正文段落直接可见，不是折叠列表里的一项）
  await expect(page.getByRole("heading", { name: "编委会 · 通俗视角" })).toBeVisible();
  await expect(page.getByText("谁是「我」", { exact: false })).toBeVisible();
  // 信息框
  await expect(page.getByText("词条（聚合枢纽）")).toBeVisible();
  await expect(page.getByText("主体、subject")).toBeVisible();
  // 折叠列表：默认露 5 条，德勒兹论主体性 藏在「展开全部」之后
  await expect(page.getByRole("link", { name: "德勒兹论主体性" })).toBeHidden();
  await page.getByRole("button", { name: /展开全部/ }).click();
  await expect(page.getByRole("link", { name: "德勒兹论主体性" })).toBeVisible();
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
