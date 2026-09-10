import { fixtureRegister } from "./auth-fixture";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";
import { getDb } from "../../src/db";
import { pages } from "../../src/db/schema";

test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要独立数据库的种子管理员");

async function submit(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.post("/api/submissions", { data });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ pageId: number; href: string; submissionId: number }>;
}
async function head(request: APIRequestContext, pageId: number) {
  const response = await request.get(`/api/pages/${pageId}/history`);
  expect(response.status()).toBe(200);
  return (await response.json()).revisions[0] as { id: number; content: string };
}
async function login(request: APIRequestContext) {
  expect((await request.post("/api/auth/sign-in/email", { data: {
    email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD,
  } })).ok()).toBe(true);
}

test("混合正文的预览、受理、直编与回滚只为真实双链生成导航关系", async ({ page, request }) => {
  test.setTimeout(180_000);
  await login(request);
  const suffix = randomUUID();
  const title = `真实目标 ${suffix}`;
  const interpreterTitle = `诠释者 ${suffix}`;
  const term = await submit(request, { kind: "new_term", title });
  const interpreter = await submit(request, { kind: "new_interpreter", title: interpreterTitle });
  const target = await submit(request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "目标正文" });
  const exampleTitle = `代码示例 ${suffix}`;
  const example = await submit(request, { kind: "new_term", title: exampleTitle });
  const sourceTerm = await submit(request, { kind: "new_term", title: `来源 ${suffix}` });
  const source = await submit(request, { kind: "new_perspective", termId: sourceTerm.pageId, interpreterId: interpreter.pageId, content: "初始正文" });
  const gap = `真实缺口 ${suffix}`;
  const examples = [
    "```md", `[[${exampleTitle}]] [[围栏缺口]]`, "```", "",
    `    [[${exampleTitle}]] [[缩进缺口]]`, "", `\`[[${exampleTitle}]] [[行内缺口]]\``, "",
    `\\[[${exampleTitle}]] \\[[转义缺口]]`,
  ].join("\n");
  const mixed = `[[${title}]] [[${title}|别名]] [[${title}|特定视角@${interpreterTitle}]] [[${gap}]]\n\n${examples}`;
  async function bodyAssertions(body: Locator) {
    await expect(body.locator("a.wiki-link")).toHaveCount(3);
    await expect(body.getByRole("link", { name: "别名", exact: true })).toHaveAttribute("href", term.href);
    await expect(body.getByRole("link", { name: "特定视角", exact: true })).toHaveAttribute("href", target.href);
    await expect(body.locator(".wiki-link--red")).toHaveText(gap);
    await expect(body.locator("pre")).toHaveCount(2);
  }
  async function relations(present: boolean) {
    const graph = await (await page.request.get("/api/graph/site")).json();
    const adjacent = graph.edges.filter((edge: { source: number; target: number }) => edge.source === sourceTerm.pageId || edge.target === sourceTerm.pageId);
    expect(adjacent).toEqual(present ? [{ source: term.pageId, target: sourceTerm.pageId, weight: 2 }] : []);
    await page.goto(target.href);
    await expect(page.getByRole("region", { name: /^反链/ }).locator(`a[href="${source.href}"]`)).toHaveCount(present ? 1 : 0);
    await page.goto(example.href);
    await expect(page.getByRole("region", { name: /^反链/ }).locator(`a[href="${source.href}"]`)).toHaveCount(0);
    await page.goto(term.href);
    await expect(page.locator("li").filter({ has: page.locator(`a[href="${target.href}"]`) })).toContainText(`${present ? 1 : 0} 次引用`);
  }
  // 普通编者的真实预览与审核发布。
  expect((await fixtureRegister(page.request, { data: {
    email: `wiki-${suffix}@example.com`, password: "wiki-semantics-password", name: "双链编者",
  } })).ok()).toBe(true);
  await page.goto(`/edit/${source.pageId}`);
  await page.getByRole("textbox", { name: "正文（Markdown）" }).fill(mixed);
  await bodyAssertions(page.getByRole("region", { name: "实时预览" }));
  const proposal = await submit(page.request, { kind: "edit", pageId: source.pageId, baseRevisionId: (await head(request, source.pageId)).id, content: mixed });
  expect((await request.post(`/api/admin/submissions/${proposal.submissionId}/review`, { data: { action: "approve" } })).status()).toBe(200);
  const mixedRevision = await head(request, source.pageId);
  await page.goto(source.href);
  await bodyAssertions(page.locator(".wiki-content"));
  await relations(true);
  // 管理员直编去除真实引用后，示例不能维持反链、热度或图谱边。
  await submit(request, { kind: "edit", pageId: source.pageId, baseRevisionId: mixedRevision.id, content: examples });
  await page.goto(source.href);
  await expect(page.locator(".wiki-content .wiki-link")).toHaveCount(0);
  await relations(false);
  expect((await request.post(`/api/admin/pages/${source.pageId}`, { data: { action: "rollback", revisionId: mixedRevision.id } })).status()).toBe(200);
  await page.goto(source.href);
  await bodyAssertions(page.locator(".wiki-content"));
  await relations(true);
});

for (const explicit of [false, true]) {
test(`${explicit ? "显式视角" : "普通双链"}源文仍用旧名时，预览、保存与回滚保留目标身份，隐藏目标恢复后仍可达`, async ({ page, request }) => {
  test.setTimeout(120_000);
  await login(request);
  await login(page.request);
  const suffix = randomUUID();
  const title = `旧名 ${suffix}`;
  const term = await submit(request, { kind: "new_term", title });
  const interpreterTitle = `解释 ${suffix}`;
  const interpreter = await submit(request, { kind: "new_interpreter", title: interpreterTitle });
  const target = await submit(request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "目标正文" });
  const sourceTerm = await submit(request, { kind: "new_term", title: `身份来源 ${suffix}` });
  const gap = `待创建 ${suffix}`;
  const content = `[[${title}|原目标${explicit ? `@${interpreterTitle}` : ""}]] [[${gap}]]`;
  const source = await submit(request, { kind: "new_perspective", termId: sourceTerm.pageId, interpreterId: interpreter.pageId, content });
  const original = await head(request, source.pageId);
  // 此工单的前置夹具：已改名页面；实际改名工作流由 #24 验证。
  await getDb().update(pages).set({ title: `新名 ${suffix}`, slug: `renamed-${suffix}` }).where(eq(pages.id, term.pageId));
  const replacement = await submit(request, { kind: "new_term", title }); // 旧名被另一个新页面使用
  await submit(request, { kind: "new_perspective", termId: replacement.pageId, interpreterId: interpreter.pageId, content: "同名替代视角" });
  const newTarget = await submit(request, { kind: "new_term", title: gap });
  const targetHref = explicit ? target.href : `/term/renamed-${suffix}-${term.pageId}`;
  await page.goto(`/edit/${source.pageId}`);
  await expect(page.getByRole("region", { name: "实时预览" }).getByRole("link", { name: "原目标" })).toHaveAttribute("href", targetHref);
  async function edit() {
    await submit(request, { kind: "edit", pageId: source.pageId, baseRevisionId: (await head(request, source.pageId)).id, content: `${content}\n\n补充解释` });
  }
  await edit();
  await page.goto(source.href);
  await expect(page.locator(".wiki-content").getByRole("link", { name: "原目标" })).toHaveAttribute("href", targetHref);
  await expect(page.locator(".wiki-content").getByRole("link", { name: gap })).toHaveAttribute("href", newTarget.href);
  expect((await request.post(`/api/admin/pages/${term.pageId}`, { data: { action: "delete" } })).status()).toBe(200);
  await page.goto(`/edit/${source.pageId}`);
  await expect(page.getByRole("region", { name: "实时预览" }).getByText("原目标", { exact: true })).toHaveAttribute("title", "页面暂不可用");
  await edit();
  expect((await request.post(`/api/admin/pages/${source.pageId}`, { data: { action: "rollback", revisionId: original.id } })).status()).toBe(200);
  await page.goto(source.href);
  await expect(page.locator(".wiki-content .wiki-link--unavailable")).toHaveText("原目标");
  expect((await request.post(`/api/admin/pages/${term.pageId}`, { data: { action: "restore" } })).status()).toBe(200);
  await page.reload();
  await expect(page.locator(".wiki-content").getByRole("link", { name: "原目标" })).toHaveAttribute("href", targetHref);
});
}
