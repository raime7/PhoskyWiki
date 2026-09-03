import { expect, test } from "@playwright/test";

test("首页渲染站点壳：站头与占位内容", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "PhoskyWiki" })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("词条");
  await expect(page.getByRole("contentinfo")).toContainText("原子笔记");
});

test("/healthz 返回 PG 连接状态（经真实起动的应用）", async ({ request }) => {
  const res = await request.get("/healthz");

  expect(res.status()).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    status: "ok",
    checks: { postgres: "up" },
  });
});
