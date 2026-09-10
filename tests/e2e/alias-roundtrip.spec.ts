import { fixtureRegister } from "./auth-fixture";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const originalAliases = ["甲、乙", "Alpha, Beta", "中文，逗号", '引号 "示例"', "路径\\名称", "换行\n别名"];
async function signIn(page: Page) {
  expect((await page.request.post("/api/auth/sign-in/email", { data: { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD } })).ok()).toBe(true);
}
async function submitForm(page: Page, name: string) {
  const received = page.waitForResponse(r => r.url().endsWith("/api/submissions") && r.request().method() === "POST");
  await page.getByRole("button", { name, exact: true }).click();
  const response = await received;
  expect(response.status()).toBe(201);
  await expect(page.getByTestId("submit-success")).toBeVisible();
  return { result: await response.json(), submitted: response.request().postDataJSON() };
}

test("只改简介并恢复本地草稿，含分隔符的已有别名数组原样往返", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  const created = await page.request.post("/api/submissions", { data: { kind: "new_term", title: `Alias edit ${randomUUID()}`, summary: "原简介", aliases: originalAliases } });
  expect(created.status()).toBe(201);
  const { pageId, href } = await created.json();
  await page.goto(href);
  const before = await (await page.request.get(`/api/pages/${pageId}/history`)).json();
  await page.goto("/");
  // Existing installations may restore a draft saved by the old, lossy prefill.
  await page.evaluate(({ id, base, title, aliases }) => localStorage.setItem(`phoskywiki:draft:edit_term:${id}`, JSON.stringify({ content: "", baseRevisionId: base, title, summary: "旧草稿简介", aliases })), { id: pageId, base: before.revisions[0].id, title: before.revisions[0].snapshot.title, aliases: originalAliases.join("、") });
  await page.goto(`/edit/${pageId}`);
  await expect(page.getByLabel("一句话简介（信息框用）")).toHaveValue("旧草稿简介");
  await page.getByLabel("一句话简介（信息框用）").fill("只修改简介");
  await expect(page.getByText(/草稿已自动保存/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("一句话简介（信息框用）")).toHaveValue("只修改简介");
  const { submitted } = await submitForm(page, "提交（直接生效）");
  expect(submitted.aliases).toEqual(originalAliases);
  const history = await (await page.request.get(`/api/pages/${pageId}/history`)).json();
  expect(history.revisions[0].snapshot.aliases).toEqual(originalAliases);
});

test("新建词条的带引号别名支持草稿恢复，含糊引号报错后原文仍可修正提交", async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  await page.goto("/new/term");
  await page.getByLabel("词条标题", { exact: true }).fill(`Alias quoted ${randomUUID()}`);
  const input = page.getByLabel("别名（信息框用，以逗号分隔）");
  await input.fill('"Alpha, Beta');
  await page.getByRole("button", { name: "提交（直接生效）", exact: true }).click();
  await expect(page.getByTestId("form-error")).toContainText("引号格式不完整");
  await page.reload();
  await expect(input).toHaveValue('"Alpha, Beta');
  const quotedAliases = String.raw`"Alpha, Beta",甲、乙，"引号 \"示例\""`;
  await input.fill(quotedAliases);
  await expect(page.getByText(/草稿已自动保存/)).toBeVisible();
  await page.reload();
  await expect(input).toHaveValue(quotedAliases);
  const next = await submitForm(page, "提交（直接生效）");
  expect(next.submitted.aliases).toEqual(["Alpha, Beta", "甲、乙", '引号 "示例"']);
  const history = await (await page.request.get(`/api/pages/${next.result.pageId}/history`)).json();
  expect(history.revisions[0].snapshot.aliases).toEqual(["Alpha, Beta", "甲、乙", '引号 "示例"']);
});

test("新词条和词条编辑驳回重提预填及草稿保留完整别名数组", async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  await signIn(page);
  const editorContext = await browser.newContext({ baseURL });
  const editor = await editorContext.newPage();
  try {
    const signedUp = await fixtureRegister(editor.request, { data: { email: `${randomUUID()}@example.com`, name: "别名编者", password: "password123" } });
    expect(signedUp.ok()).toBe(true);
    const ownerId = (await signedUp.json()).user.id;
    const created = await page.request.post("/api/submissions", { data: { kind: "new_term", title: `Alias target ${randomUUID()}` } });
    const { pageId } = await created.json();
    const base = (await (await page.request.get(`/api/pages/${pageId}/history`)).json()).revisions[0];
    for (const proposal of [
      { kind: "new_term", title: `Alias retry ${randomUUID()}`, summary: "原提案", aliases: originalAliases },
      { kind: "edit", pageId, baseRevisionId: base.id, title: base.snapshot.title, summary: "原提案", aliases: originalAliases },
    ]) {
      const submitted = await editor.request.post("/api/submissions", { data: proposal });
      expect(submitted.status()).toBe(201);
      const { submissionId } = await submitted.json();
      expect((await page.request.post(`/api/admin/submissions/${submissionId}/review`, { data: { action: "reject", reason: "只修改简介后重提" } })).ok()).toBe(true);
      await editor.goto("/");
      await editor.evaluate(({ ownerId, submissionId, title, baseRevisionId, aliases }) => localStorage.setItem(`phoskywiki:draft:resubmit:${ownerId}:${submissionId}`, JSON.stringify({ content: "", title, summary: "旧重提草稿", baseRevisionId, aliases })), { ownerId, submissionId, title: proposal.title, baseRevisionId: proposal.baseRevisionId ?? null, aliases: originalAliases.join(",") });
      await editor.goto(`/profile/submissions/${submissionId}/resubmit`);
      await expect(editor.getByLabel("一句话简介（信息框用）")).toHaveValue("旧重提草稿");
      await editor.getByLabel("一句话简介（信息框用）").fill("重新整理简介");
      await expect(editor.getByText(/草稿已自动保存/)).toBeVisible();
      await editor.reload();
      await expect(editor.getByLabel("一句话简介（信息框用）")).toHaveValue("重新整理简介");
      const next = await submitForm(editor, "提交审核");
      expect(next.submitted.aliases).toEqual(originalAliases);
      expect(next.submitted.supersedes).toBe(submissionId);
      await editor.goto(`/profile/submissions/${next.result.submissionId}`);
      await expect(editor.locator("main")).toContainText("Alpha, Beta");
      await expect(editor.locator("main")).toContainText("甲、乙");
    }
  } finally { await editorContext.close(); }
});
