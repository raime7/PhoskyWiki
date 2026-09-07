import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function openNewPerspective(page: Page) {
  await page.goto("/register");
  await page.getByLabel("名称").fill("编辑器测试编者");
  await page.getByLabel("邮箱").fill(`t07-${randomUUID()}@example.com`);
  await page.getByLabel("密码（至少 8 位）").fill("password123");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByTestId("session-user")).toContainText("编者");
  await page.goto("/new/perspective");
}

test("正文工具栏、实时预览与本地草稿", async ({ page }) => {
  await openNewPerspective(page);
  const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.fill("预览文字");
  await editor.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "粗体", exact: true }).click();
  const preview = page.getByRole("region", { name: "实时预览" });
  await expect(preview.locator("strong")).toHaveText("预览文字");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(preview.locator("strong")).toHaveCount(0);
  await expect(page.getByText(/草稿已自动保存/)).toBeVisible();
  await page.reload();
  await expect(editor).toHaveText("预览文字");
  await expect(preview).toContainText("预览文字");
});

test("[[ 补全已有词条与红链，预览精确视角并过滤不安全 HTML", async ({ page }) => {
  await openNewPerspective(page);
  const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
  await editor.pressSequentially("[[主体");
  await page.getByRole("listbox").getByRole("option", { name: "主体性", exact: true }).click();
  await expect(editor).toHaveText("[[主体性]]");
  const preview = page.getByRole("region", { name: "实时预览" });
  await expect(preview.getByRole("link", { name: "主体性", exact: true })).toHaveAttribute("href", /^\/term\//);
  await editor.fill("");
  await editor.pressSequentially("[[未创建的词条T07");
  await page.getByRole("listbox").getByRole("option", { name: /未创建的词条T07.*将创建红链/ }).click();
  await expect(editor).toHaveText("[[未创建的词条T07]]");
  await expect(preview.getByText("未创建的词条T07", { exact: true })).toHaveAttribute("title", "词条尚未创建");
  await editor.fill('[[主体性|视角@拉康]] <script>alert(1)</script> [危险](javascript:alert)');
  await expect(preview.getByRole("link", { name: "视角", exact: true })).toHaveAttribute("href", /^\/perspective\//);
  await expect(preview.locator("script, [href^='javascript:']")).toHaveCount(0);
});

test("新建视角即时拒绝重复组合，换选后仍可提交审核", async ({ page }) => {
  await openNewPerspective(page);
  await page.getByLabel("所属词条").selectOption({ label: "主体性" });
  await page.getByRole("combobox", { name: /^诠释者/ }).selectOption({ label: "拉康" });
  await expect(page.locator("form").getByRole("alert")).toContainText("该诠释者在此词条下已有视角");
  await expect(page.getByRole("button", { name: "提交审核", exact: true })).toBeDisabled();
  await page.getByLabel("所属词条").selectOption({ label: "剩余价值" });
  await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
  await page.getByRole("textbox", { name: "正文（Markdown）" }).fill("新视角的提议正文。");
  await page.getByRole("button", { name: "提交审核", exact: true }).click();
  await expect(page.getByTestId("submit-success")).toContainText("等待审核");
});

test.describe("移动端编辑", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("窄屏可触摸补全、使用工具栏、预览长文本并提交", async ({ page }, testInfo) => {
    await openNewPerspective(page);
    await page.getByLabel("所属词条").selectOption({ label: "剩余价值" });
    await page.getByRole("combobox", { name: /^诠释者/ }).selectOption({ label: "黑格尔" });
    const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
    await editor.tap();
    await editor.pressSequentially("[[主体");
    await page.getByRole("listbox").getByRole("option", { name: "主体性", exact: true }).tap();
    await expect(editor).toHaveText("[[主体性]]");
    await editor.fill("很长的原文术语 " + "LongUnbrokenWord".repeat(20));
    await editor.press("ControlOrMeta+a");
    await page.getByRole("button", { name: "粗体", exact: true }).tap();
    await expect(page.getByRole("region", { name: "实时预览" }).locator("strong")).toContainText("很长的原文术语");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("mobile-editor.png"), fullPage: true });
    await page.getByRole("button", { name: "提交审核", exact: true }).tap();
    await expect(page.getByTestId("submit-success")).toContainText("等待审核");
  });
});
