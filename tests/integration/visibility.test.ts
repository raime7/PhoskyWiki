import { fixtureSignUp } from "./auth-fixture";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { POST as manageRoute } from "@/app/api/admin/pages/[pageId]/route";
import { POST as submitRoute } from "@/app/api/submissions/route";
import { GET as searchRoute } from "@/app/api/search/route";
import { GET as suggestRoute } from "@/app/api/search/suggest/route";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { seedDatabase } from "@/db/seed";
import { user } from "@/db/schema";
import { FakeSearchIndex } from "@/lib/search/fake-index";
import { injectSearchIndex, resetSearchIndex } from "@/lib/search/search-service";

let cookie: string;
let userId: string;
beforeAll(async () => {
  await seedDatabase();
  const email = `visibility-${randomUUID()}@example.com`;
  const password = "visibility-test-password";
  const signed = await fixtureSignUp({ body: { email, password, name: "可见性管理员" } });
  userId = signed.user.id;
  await getDb().update(user).set({ role: "admin" }).where(eq(user.id, userId));
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  cookie = response.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ");
});
afterAll(async () => {
  resetSearchIndex();
  await seedDatabase();
  await getDb().delete(user).where(eq(user.id, userId));
});
function request(path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, { method: body ? "POST" : "GET",
    headers: { cookie, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function submit(body: unknown) {
  const response = await submitRoute(request("/api/submissions", body));
  expect(response.status).toBe(201);
  return response.json();
}
async function action(pageId: number, action: string) {
  const response = await manageRoute(request(`/api/admin/pages/${pageId}`, { action }), { params: Promise.resolve({ pageId: String(pageId) }) });
  expect(response.status).toBe(200);
}

it.each(["term", "interpreter"])("%s 删除同步关联视角，旧索引也不能泄露隐藏正文或联想", async (parent) => {
  const index = new FakeSearchIndex();
  injectSearchIndex(index);
  const term = await submit({ kind: "new_term", title: `搜索父词条 ${randomUUID()}` });
  const interpreter = await submit({ kind: "new_interpreter", title: `搜索父诠释者 ${randomUUID()}` });
  const query = `Visibility${randomUUID()}`;
  const perspective = await submit({ kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: query });
  async function search() { return (await searchRoute(request(`/api/search?q=${query}`))).json(); }
  expect((await search()).hits.map((hit: { pageId: number }) => hit.pageId)).toContain(perspective.pageId);
  await action(parent === "term" ? term.pageId : interpreter.pageId, "delete");
  // 直接搜索端口验证既有同步承诺；再注入旧文档模拟同步故障/延迟。
  expect((await index.search(query)).hits).toHaveLength(0);
  await index.upsert([{ pageId: perspective.pageId, type: "perspective", title: query, slug: "old", body: query }]);
  expect((await search()).hits).toHaveLength(0);
  expect((await (await suggestRoute(request(`/api/search/suggest?q=${query}`))).json()).suggestions).toHaveLength(0);
  await action(parent === "term" ? term.pageId : interpreter.pageId, "restore");
  expect((await search()).hits.map((hit: { pageId: number }) => hit.pageId)).toContain(perspective.pageId);
});
