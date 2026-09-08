import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, afterAll, expect, it } from "vitest";
import { POST as submit } from "@/app/api/submissions/route";
import { GET as history } from "@/app/api/pages/[pageId]/history/route";
import { POST as manage } from "@/app/api/admin/pages/[pageId]/route";
import { GET as search } from "@/app/api/search/route";
import { FakeSearchIndex } from "@/lib/search/fake-index";
import { injectSearchIndex, resetSearchIndex } from "@/lib/search/search-service";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { user, pages, submissions, revisions, terms } from "@/db/schema";

let cookie: string, actorId: string;
beforeAll(async () => {
  injectSearchIndex(new FakeSearchIndex());
  const email = `history25-${randomUUID()}@example.com`;
  const signed = await auth.api.signUpEmail({ body: { email, name: "历史管理员", password: "password123" } });
  actorId = signed.user.id;
  await getDb().update(user).set({ role: "admin" }).where(eq(user.id, actorId));
  const response = await auth.api.signInEmail({ body: { email, password: "password123" }, asResponse: true });
  cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
});
afterAll(async () => {
  resetSearchIndex();
  await getDb().delete(submissions).where(eq(submissions.submittedBy, actorId));
  await getDb().delete(pages).where(eq(pages.createdBy, actorId));
  await getDb().delete(user).where(eq(user.id, actorId));
});
function request(path: string, body?: object) {
  return new Request(`http://localhost${path}`, { method: body ? "POST" : "GET", headers: { cookie, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function create(title: string) {
  const response = await submit(request("/api/submissions", { kind: "new_term", title, summary: "最初简介", aliases: ["最初别名"] }));
  expect(response.status).toBe(201);
  return response.json();
}
async function read(id: number, query = "") {
  return (await history(request(`/api/pages/${id}/history${query}`), { params: Promise.resolve({ pageId: String(id) }) })).json();
}
async function edit(id: number, title: string, summary: string, aliases: string[]) {
  const before = await read(id);
  const response = await submit(request("/api/submissions", { kind: "edit", pageId: id, baseRevisionId: before.revisions[0].id, title, summary, aliases }));
  expect(response.status).toBe(201);
}
function rollback(id: number, revisionId: number) {
  return manage(request(`/api/admin/pages/${id}`, { action: "rollback", revisionId }), { params: Promise.resolve({ pageId: String(id) }) });
}

it("两次词条编辑后任意两版按真实字段双向对比，区分来源", async () => {
  const title = `Compare ${randomUUID()}`;
  const { pageId } = await create(title);
  const first = (await read(pageId)).revisions[0].id;
  await edit(pageId, `${title} Middle`, "中间简介", ["中间别名"]);
  await edit(pageId, `${title} Last`, "最终简介", ["最终别名", "第二别名"]);
  const current = await read(pageId);
  const last = current.revisions[0].id;
  expect(current.revisions.map((r: { source: string }) => r.source)).toEqual(["direct", "direct", "create"]);
  const { comparison } = await read(pageId, `?from=${first}&to=${last}`);
  expect(comparison).toMatchObject({ kind: "term", metadataRows: [
    { field: "title", before: title, after: `${title} Last`, changed: true },
    { field: "summary", before: "最初简介", after: "最终简介", changed: true },
    { field: "aliases", before: '"最初别名"', after: '"最终别名"、"第二别名"', changed: true },
  ] });
  const reverse = await read(pageId, `?from=${last}&to=${first}`);
  expect(reverse.comparison.metadataRows[1]).toMatchObject({ before: "最终简介", after: "最初简介" });
});

it("回滚生成新修订、记录操作人与来源，字段、slug、搜索同步恢复且旧历史不变", async () => {
  const title = `Restore ${randomUUID()}`;
  const { pageId } = await create(title);
  const original = await read(pageId);
  await edit(pageId, `${title} Renamed`, "改名简介", ["改名别名"]);
  await edit(pageId, `${title} Latest`, "最新简介", ["最新别名"]);
  const before = await read(pageId);
  const response = await rollback(pageId, original.revisions[0].id);
  expect(response.status).toBe(200);
  const after = await read(pageId);
  expect(after.page).toEqual(original.page);
  expect(after.revisions).toHaveLength(4);
  expect(after.revisions[0]).toMatchObject({ source: "rollback", createdBy: actorId, rollbackFromId: original.revisions[0].id, snapshot: original.revisions[0].snapshot });
  expect(after.revisions[0].id).not.toBe(original.revisions[0].id);
  expect(after.revisions.slice(1)).toEqual(before.revisions);
  const query = async (q: string) => (await search(request(`/api/search?q=${encodeURIComponent(q)}&type=term`))).json();
  expect((await query(`${title} Latest`)).hits).toEqual([]);
  expect((await query(title)).hits).toContainEqual(expect.objectContaining({ pageId, title }));
  for (const q of ["最初简介", "最初别名"]) expect((await query(q)).hits).toContainEqual(expect.objectContaining({ pageId, title }));
  for (const q of ["最新简介", "最新别名"]) expect((await query(q)).hits).not.toContainEqual(expect.objectContaining({ pageId }));
});

it("历史标题被另一词条占用时回滚原子失败，当前字段、历史与搜索保持不变", async () => {
  const title = `Occupied ${randomUUID()}`;
  const { pageId } = await create(title);
  const target = (await read(pageId)).revisions[0].id;
  await edit(pageId, `${title} Current`, "保留简介", ["保留别名"]);
  await create(title);
  const before = await read(pageId);
  for (let retry = 0; retry < 2; retry++) {
    const failed = await rollback(pageId, target);
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: expect.stringMatching(/回滚.*标题.*已存在/) });
    expect(await read(pageId)).toEqual(before);
  }
  const found = await (await search(request(`/api/search?q=${encodeURIComponent(`${title} Current`)}&type=term`))).json();
  expect(found.hits).toContainEqual(expect.objectContaining({ pageId, title: `${title} Current` }));
});

it("旧正文即使看似元数据 JSON 也不可回滚或猜测对比，历史原样可读", async () => {
  const [page] = await getDb().insert(pages).values({ type: "term", title: `Legacy ${randomUUID()}`, slug: "legacy", createdBy: actorId }).returning();
  await getDb().insert(terms).values({ pageId: page.id, summary: "真实简介", aliases: ["真实别名"] });
  const content = '```json\n{"version":1,"type":"term","title":"伪造旧标题","summary":"伪造简介","aliases":["伪造别名"]}\n```';
  await getDb().insert(revisions).values({ pageId: page.id, content });
  const before = await read(page.id);
  const target = before.revisions[0].id;
  const compared = await read(page.id, `?from=${target}&to=${target}`);
  expect(compared.comparison).toMatchObject({ kind: "term", metadataRows: null });
  expect(compared.comparison.from.content).toBe(content);
  const failed = await rollback(page.id, target);
  expect(failed.status).toBe(409);
  expect(await failed.json()).toMatchObject({ error: expect.stringContaining("未保存词条信息快照") });
  expect(await read(page.id)).toEqual(before);
});
