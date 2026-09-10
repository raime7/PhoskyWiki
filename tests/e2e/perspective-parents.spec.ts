import { fixtureRegister } from "./auth-fixture";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

async function submit(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.post("/api/submissions", { data });
  expect(response.status()).toBe(201);
  return response.json();
}

for (const parent of ["term", "interpreter"] as const) {
  test(`${parent} 失效的系统理由、原提案与通知在编者历史可读；恢复不复活旧提交`, async ({ page, request }) => {
    test.setTimeout(120_000);
    test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
    expect((await request.post("/api/auth/sign-in/email", { data: {
      email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD,
    } })).ok()).toBe(true);
    expect((await fixtureRegister(page.request, { data: {
      name: "父页面提案编者", email: `parents-${randomUUID()}@example.com`, password: "parents-browser-password",
    } })).ok()).toBe(true);
    const term = await submit(request, { kind: "new_term", title: `浏览父词条 ${randomUUID()}` });
    const interpreter = await submit(request, { kind: "new_interpreter", title: `浏览父诠释者 ${randomUUID()}` });
    const content = `等待恢复的原提案 ${randomUUID()}`;
    const proposal = { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content };
    const old = await submit(page.request, proposal);
    const parentId = parent === "term" ? term.pageId : interpreter.pageId;
    const manage = async (action: string) => {
      expect((await request.post(`/api/admin/pages/${parentId}`, { data: { action } })).status()).toBe(200);
    };
    try {
      await manage("delete");
      const decided = await request.post(`/api/admin/submissions/${old.submissionId}/review`, { data: { action: "approve" } });
      expect(decided.status()).toBe(200);
      const { outcome, message } = await decided.json();
      expect(outcome).toBe("rejected");
      expect(message).toContain("系统驳回");
      expect(await (await page.request.get("/api/notifications/unread-count")).json()).toEqual({ unreadCount: 1 });
      await page.goto("/profile");
      const item = page.locator(`[data-submission-id="${old.submissionId}"]`);
      await expect(item).toContainText("已驳回");
      await expect(item).toContainText(message);
      const notification = page.locator(`[data-notification-id="${old.submissionId}"]`);
      await expect(notification).toContainText("已驳回");
      await expect(notification).toContainText(message);
      await item.getByRole("link", { name: "查看差异" }).click();
      await expect(page).toHaveURL(new RegExp(`/profile/submissions/${old.submissionId}$`));
      await expect(page.getByRole("heading", { name: "提交详情", exact: true })).toBeVisible();
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      await expect(page.getByTestId("content-diff")).toContainText(content);
      await manage("restore");
      await page.reload();
      await expect(page.getByText("已驳回", { exact: true })).toBeVisible();
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      expect((await request.post(`/api/admin/submissions/${old.submissionId}/review`, { data: { action: "approve" } })).status()).toBe(409);
      const next = await submit(page.request, { ...proposal, supersedes: old.submissionId });
      expect(next.submissionId).not.toBe(old.submissionId);
      await page.goto(`/profile/submissions/${next.submissionId}`);
      await expect(page.getByText("待审核", { exact: true })).toBeVisible();
      await expect(page.getByTestId("content-diff")).toContainText(content);
    } finally {
      await manage("restore");
    }
  });
}
