// R02：只能从页面观察的审核结果。HTTP 状态机回归留在 integration/review.test.ts。
// 每个用例通过公开提交入口创建独立页面；数据库仅准备历史 quorum 夹具，不读取结果。
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { getDb } from "../../src/db";
import { submissions } from "../../src/db/schema";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
test.skip(!ADMIN_PASSWORD, "需要 SEED_ADMIN_PASSWORD");

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/auth/sign-in/email", {
    headers: { origin: process.env.BETTER_AUTH_URL ?? "http://localhost:3000" },
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.user.role).toBe("admin");
  return result.user.name as string;
}

async function register(request: APIRequestContext) {
  const credentials = { email: `review-behavior-${randomUUID()}@example.com`, password: "review-behavior-pass123" };
  const response = await request.post("/api/auth/sign-up/email", {
    headers: { origin: process.env.BETTER_AUTH_URL ?? "http://localhost:3000" },
    data: { ...credentials, name: "审核行为编者" },
  });
  expect(response.ok()).toBe(true);
  return credentials;
}

async function submit(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.post("/api/submissions", { data });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ submissionId: number; pageId: number; href: string; outcome: string }>;
}

async function review(request: APIRequestContext, id: number, action: "approve" | "reject", reason?: string) {
  const response = await request.post(`/api/admin/submissions/${id}/review`, { data: { action, reason } });
  expect(response.status()).toBe(200);
  return response.json();
}

async function history(request: APIRequestContext, pageId: number) {
  const response = await request.get(`/api/pages/${pageId}/history`);
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ revisions: { id: number; content: string }[] }>;
}

async function edit(request: APIRequestContext, pageId: number, content: string) {
  const base = (await history(request, pageId)).revisions[0].id;
  return submit(request, { kind: "edit", pageId, content, baseRevisionId: base });
}

async function fixture(request: APIRequestContext) {
  const suffix = randomUUID();
  const title = `审核词条 ${suffix}`;
  const name = `审核诠释者 ${suffix}`;
  const term = await submit(request, { kind: "new_term", title });
  const interpreter = await submit(request, { kind: "new_interpreter", title: name });
  const perspective = await submit(request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "原始正文。" });
  return { term, interpreter, perspective, title, name, perspectiveTitle: `${name}论${title}` };
}

async function detail(page: Page, id: number, state: string) {
  await page.goto(`/profile/submissions/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: "提交详情" })).toBeVisible();
  await expect(page.locator("main")).toContainText(state);
}

async function listedPage(page: Page, listPath: string, title: string) {
  await page.goto(listPath);
  const link = page.getByRole("link", { name: title, exact: true });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
  const href = new URL(page.url()).pathname;
  const id = Number(href.match(/-(\d+)$/)?.[1]);
  expect(Number.isSafeInteger(id) && id > 0).toBe(true);
  return { href, pageId: id };
}

const backlinks = (page: Page) => page.getByRole("region", { name: /^反链/ });

test("队列显示票数、批准者、过期基准与两侧 diff；提交详情保留终态及理由，重提创建新提交", async ({ page, request }) => {
  const adminName = await loginAdmin(request);
  const author = await register(page.request);
  const source = await fixture(request);
  const proposal = "队列展示用的提案内容。";
  const created = await edit(page.request, source.perspective.pageId, proposal);
  await detail(page, created.submissionId, "待审核");
  await expect(page.getByTestId("content-diff")).toContainText("原始正文。");

  // 准备「两管理员时期创建、现剩一管理员」的历史快照；不改变全站角色或并发用例。
  // quorum 的实际创建规则由 HTTP 集成测试覆盖，此处只观察队列呈现。
  await getDb().update(submissions).set({ quorum: 2 }).where(eq(submissions.id, created.submissionId));
  expect(await review(request, created.submissionId, "approve")).toEqual({ outcome: "pending", approveCount: 1, quorum: 2 });
  await edit(request, source.perspective.pageId, "直编推进 head。");
  const fresh = await edit(page.request, source.perspective.pageId, "第二条待审提交。");
  const staleProposal = await edit(page.request, source.perspective.pageId, "等待旧基准受理的提案。");

  await loginAdmin(page.request);
  await page.goto("/review");
  const item = page.locator(`[data-submission-id="${created.submissionId}"]`);
  await expect(item).toContainText("编辑视角");
  await expect(item).toContainText(source.perspectiveTitle);
  await expect(item).toContainText(`批准 1/2（${adminName}）`);
  await expect(item.getByTestId("stale-badge")).toBeVisible();
  await item.getByText("对比当前版与提案", { exact: true }).click();
  await expect(item.getByTestId("content-diff")).toContainText("直编推进 head。");
  await expect(item.getByTestId("content-diff")).toContainText(proposal);
  const freshItem = page.locator(`[data-submission-id="${fresh.submissionId}"]`);
  await expect(freshItem.getByTestId("stale-badge")).toHaveCount(0);
  await expect(freshItem).toContainText("批准 0/");
  const queueIds = await page.locator("[data-submission-id]").filter({ hasText: source.perspectiveTitle }).evaluateAll((items) => items.map((entry) => entry.getAttribute("data-submission-id")));
  await edit(request, source.perspective.pageId, "再次直编，不进入审核队列。");
  await page.reload();
  expect(await page.locator("[data-submission-id]").filter({ hasText: source.perspectiveTitle }).evaluateAll((items) => items.map((entry) => entry.getAttribute("data-submission-id")))).toEqual(queueIds);

  const reason = "论据不足，请补充文献。";
  await review(request, fresh.submissionId, "reject", reason);
  // 提交详情属于原编者，管理员审核会话只访问审核队列。
  expect((await page.request.post("/api/auth/sign-in/email", { data: author, headers: { origin: process.env.BETTER_AUTH_URL ?? "http://localhost:3000" } })).ok()).toBe(true);
  await detail(page, fresh.submissionId, "已驳回");
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
  await expect(page.locator("main")).toContainText("审核于");
  const stale = await review(request, staleProposal.submissionId, "approve");
  expect(stale).toMatchObject({ outcome: "rejected", staleBase: true });
  await detail(page, staleProposal.submissionId, "已驳回");
  await expect(page.locator("main")).toContainText("重新提交");

  // 原提案之后 head 已推进：读最新版并明确确认整理结果，不能只静默替换 base。
  const latest = (await history(page.request, source.perspective.pageId)).revisions[0];
  expect(latest.content).toBe("再次直编，不进入审核队列。");
  const retried = await submit(page.request, {
    kind: "edit", pageId: source.perspective.pageId, content: "补充论据后的重提版本。",
    baseRevisionId: latest.id, confirmedBaseRevisionId: latest.id, supersedes: fresh.submissionId,
  });
  expect(retried.submissionId).not.toBe(fresh.submissionId);
  expect(await review(request, retried.submissionId, "approve")).toEqual({ outcome: "approved" });
  await detail(page, retried.submissionId, "已受理");
  await expect(page.locator("main")).toContainText("审核于");
  await detail(page, fresh.submissionId, "已驳回");
  await getDb().delete(submissions).where(eq(submissions.id, created.submissionId));
});

test("受理追加完整修订并替换双链；反链与精确视角引用热度同步更新并重排", async ({ page, request }) => {
  await loginAdmin(request);
  await register(page.request);
  const source = await fixture(request);
  const target = await fixture(request);
  const old = await fixture(request);
  const popularName = `被引用诠释者 ${randomUUID()}`;
  const popularInterpreter = await submit(request, { kind: "new_interpreter", title: popularName });
  const popular = await submit(request, { kind: "new_perspective", termId: target.term.pageId, interpreterId: popularInterpreter.pageId, content: "被精确引用的视角。" });
  const popularTitle = `${popularName}论${target.title}`;
  await edit(request, source.perspective.pageId, `旧正文参见[[${old.title}]]。`);
  const before = await history(request, source.perspective.pageId);
  await page.goto(old.term.href);
  await expect(backlinks(page).getByRole("link", { name: source.perspectiveTitle, exact: true })).toBeVisible();
  await page.goto(target.term.href);
  const perspectiveItems = page.getByRole("region", { name: /诠释者视角/ }).locator("li");
  await expect(perspectiveItems).toHaveCount(2);
  await expect(perspectiveItems.nth(0)).toContainText(target.perspectiveTitle);
  await expect(perspectiveItems.nth(1)).toContainText("0 次引用");

  const content = `新正文参见[[${target.title}]]；精确参见[[${target.title}|精确视角@${popularName}]]。`;
  const created = await edit(page.request, source.perspective.pageId, content);
  expect(await review(request, created.submissionId, "approve")).toEqual({ outcome: "approved" });
  const after = await history(request, source.perspective.pageId);
  expect(after.revisions).toHaveLength(before.revisions.length + 1);
  expect(after.revisions[0].content).toBe(content);
  expect(after.revisions.slice(1)).toEqual(before.revisions);
  await page.goto(source.perspective.href);
  await expect(page.locator("article").getByRole("link", { name: old.title, exact: true })).toHaveCount(0);
  await expect(page.locator("article").getByRole("link", { name: target.title, exact: true })).toHaveAttribute("href", target.term.href);
  await expect(page.locator("article").getByRole("link", { name: "精确视角", exact: true })).toHaveAttribute("href", popular.href);
  await page.goto(old.term.href);
  await expect(backlinks(page).getByRole("link", { name: source.perspectiveTitle, exact: true })).toHaveCount(0);
  for (const href of [target.term.href, popular.href]) {
    await page.goto(href);
    await expect(backlinks(page).getByRole("link", { name: source.perspectiveTitle, exact: true })).toBeVisible();
  }
  await page.goto(target.term.href);
  await expect(perspectiveItems.nth(0)).toContainText(popularTitle);
  await expect(perspectiveItems.nth(0)).toContainText("1 次引用");
  await expect(perspectiveItems.nth(1)).toContainText("0 次引用");
});

test("词条、诠释者及视角新建均经审核后可读，重复名称与挂载仍拒绝", async ({ page, request }) => {
  await loginAdmin(request);
  await register(page.request);
  const suffix = randomUUID();
  const title = `新受理词条 ${suffix}`;
  const name = `新受理诠释者 ${suffix}`;
  for (const [kind, proposedTitle, listPath] of [
    ["new_term", title, "/terms"], ["new_interpreter", name, "/interpreters"],
  ]) {
    const created = await submit(page.request, { kind, title: proposedTitle, summary: "受理后的简介。" });
    await page.goto(listPath);
    await expect(page.getByRole("link", { name: proposedTitle, exact: true })).toHaveCount(0);
    expect(await review(request, created.submissionId, "approve")).toEqual({ outcome: "approved" });
  }
  const term = await listedPage(page, "/terms", title);
  await expect(page.locator("main")).toContainText("受理后的简介。");
  const interpreter = await listedPage(page, "/interpreters", name);
  await expect(page.locator("main")).toContainText("受理后的简介。");
  const target = await fixture(request);
  const content = `欲望生产视角，另见[[${target.title}]]。`;
  const created = await submit(page.request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content });
  await page.goto(term.href);
  await expect(page.getByRole("link", { name: `${name}论${title}`, exact: true })).toHaveCount(0);
  expect(await review(request, created.submissionId, "approve")).toEqual({ outcome: "approved" });
  await page.reload();
  await page.getByRole("link", { name: `${name}论${title}`, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${name}论${title}`, exact: true })).toBeVisible();
  await expect(page.locator("article")).toContainText("欲望生产视角");
  await expect(page.locator("article").getByRole("link", { name: target.title, exact: true })).toHaveAttribute("href", target.term.href);
  await page.goto(target.term.href);
  await expect(backlinks(page).getByRole("link", { name: `${name}论${title}`, exact: true })).toBeVisible();
  for (const body of [
    { kind: "new_term", title }, { kind: "new_interpreter", title: name },
    { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "重复挂载" },
  ]) {
    expect((await page.request.post("/api/submissions", { data: body })).status()).toBe(400);
  }
});
