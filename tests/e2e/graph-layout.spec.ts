import { expect, test, type Page } from "./fixtures";

async function expectSeparated(page: Page) {
  const nodes = page.locator("[data-node-boundary]");
  await expect(nodes.first()).toBeVisible();
  const minimumGap = await nodes.evaluateAll(elements => {
    const circles = elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, radius: box.width / 2 };
    });
    let minimum = Infinity;
    for (let i = 0; i < circles.length; i++) for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i], b = circles[j];
      minimum = Math.min(minimum, Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius);
    }
    return minimum;
  });
  expect(minimumGap).toBeGreaterThan(1);
}

test("实心饼图保留多个学派，搜索和键盘聚焦显示完整关联", async ({ page }) => {
  await page.goto("/graph");
  await page.getByTestId("graph-search").fill("主体性");
  await page.getByRole("option", { name: /主体性/ }).first().click();
  const graph = page.getByTestId("graph-canvas");
  await expect(graph).toHaveAttribute("data-located", /\d+/);
  const id = await graph.getAttribute("data-located");
  const node = graph.locator(`[data-node-id="${id}"]`);
  expect(await node.locator("[data-school-sector]").count()).toBeGreaterThan(1);
  // A sector starts at the circle centre: the chosen design is a solid pie.
  await expect(node.locator("[data-school-sector]").first()).toHaveAttribute("d", /^M 0 0 L /);
  await node.focus();
  await expect(graph).toContainText("精神分析 · 2 个视角");
  await expect(graph).toContainText("不表示概念归属比例");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/term\//);
});

test("全站和局部圆点在拖拽、缩放、窄屏与跳数切换后均不重叠", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/graph");
  await expectSeparated(page);
  const graph = page.getByTestId("graph-canvas");
  await graph.scrollIntoViewIfNeeded();
  const box = (await graph.boundingBox())!;
  const visible = await page.locator("[data-node-boundary]").evaluateAll((elements, box) => elements.map(e => {
    const b = e.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }).filter(p => p.x > box.x + 30 && p.x < box.x + box.width - 30 && p.y > box.y + 30 && p.y < box.y + box.height - 60), box);
  expect(visible.length).toBeGreaterThan(1);
  await page.mouse.move(visible[0].x, visible[0].y);
  await page.mouse.down();
  await page.mouse.move(visible[1].x, visible[1].y, { steps: 10 });
  await expectSeparated(page);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/graph$/);
  await expectSeparated(page);
  await page.getByRole("button", { name: "放大图谱" }).click();
  await expectSeparated(page);
  for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "缩小图谱" }).click();
  await expectSeparated(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectSeparated(page);
  await page.screenshot({ path: testInfo.outputPath("graph-mobile.png"), fullPage: true });
  await page.getByTestId("graph-search").fill("主体性");
  await page.getByRole("option", { name: /主体性/ }).first().click();
  const id = await graph.getAttribute("data-located");
  await graph.locator(`[data-node-id="${id}"]`).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "局部图谱" })).toBeVisible();
  await expectSeparated(page);
  await page.getByRole("button", { name: "2 跳" }).click();
  await expect(page.getByRole("button", { name: "2 跳" })).toHaveAttribute("aria-pressed", "true");
  await expectSeparated(page);
  expect(errors).toEqual([]);
});
