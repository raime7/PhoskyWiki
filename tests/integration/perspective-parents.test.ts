import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { POST as submitRoute } from "@/app/api/submissions/route";
import { POST as reviewRoute } from "@/app/api/admin/submissions/[id]/review/route";
import { POST as manageRoute } from "@/app/api/admin/pages/[pageId]/route";
import { GET as unreadRoute } from "@/app/api/notifications/unread-count/route";
import { POST as readRoute } from "@/app/api/notifications/[id]/read/route";
import { GET as searchRoute } from "@/app/api/search/route";
import { GET as historyRoute } from "@/app/api/pages/[pageId]/history/route";
import { getDb } from "@/db";
import { pages, submissions, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { FakeSearchIndex } from "@/lib/search/fake-index";
import { injectSearchIndex, resetSearchIndex } from "@/lib/search/search-service";

const users: string[] = [];
let editor: string;
let admin1: string;
let admin2: string;
async function account(role: "editor" | "admin") {
  const email = `parents-${randomUUID()}@example.com`;
  const password = "parents-test-password";
  const signed = await auth.api.signUpEmail({ body: { name: "父页面检查", email, password } });
  users.push(signed.user.id);
  await getDb().update(user).set({ role }).where(eq(user.id, signed.user.id));
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return response.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ");
}
beforeAll(async () => {
  editor = await account("editor");
  admin1 = await account("admin");
  admin2 = await account("admin");
  injectSearchIndex(new FakeSearchIndex());
});
afterAll(async () => {
  resetSearchIndex();
  await getDb().delete(submissions).where(inArray(submissions.submittedBy, users));
  await getDb().delete(pages).where(inArray(pages.createdBy, users));
  await getDb().delete(user).where(inArray(user.id, users));
});
function request(path: string, cookie: string, body?: unknown) {
  return new Request(`http://localhost${path}`, { method: body ? "POST" : "GET",
    headers: { cookie, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
function submit(cookie: string, body: unknown) { return submitRoute(request("/api/submissions", cookie, body)); }
async function created(cookie: string, body: unknown) {
  const response = await submit(cookie, body);
  expect(response.status).toBe(201);
  return response.json();
}
function vote(id: number, cookie: string) {
  return reviewRoute(request(`/api/admin/submissions/${id}/review`, cookie, { action: "approve" }), { params: Promise.resolve({ id: String(id) }) });
}
async function action(id: number, action: "delete" | "restore") {
  const response = await manageRoute(request(`/api/admin/pages/${id}`, admin1, { action }), { params: Promise.resolve({ pageId: String(id) }) });
  expect(response.status).toBe(200);
}
async function fixture() {
  const term = await created(admin1, { kind: "new_term", title: `依赖词条 ${randomUUID()}` });
  const interpreter = await created(admin1, { kind: "new_interpreter", title: `依赖诠释者 ${randomUUID()}` });
  return { term, interpreter, proposal: { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: `ParentBody${randomUUID()}` } };
}
async function unread() { return (await (await unreadRoute(request("/api/notifications/unread-count", editor))).json()).unreadCount; }
async function search(content: string) { return (await (await searchRoute(request(`/api/search?q=${content}`, ""))).json()).hits; }

it.each(["term", "interpreter"] as const)("%s 首票后删除会系统驳回、通知；恢复后新提案可发布且旧提交保持终态", async (parent) => {
  const { term, interpreter, proposal } = await fixture();
  const pending = await created(editor, proposal);
  expect(await (await vote(pending.submissionId, admin1)).json()).toMatchObject({ outcome: "pending" });
  const before = await unread();
  await action(parent === "term" ? term.pageId : interpreter.pageId, "delete");
  const decided = await vote(pending.submissionId, admin2);
  expect(decided.status).toBe(200);
  expect(await decided.json()).toMatchObject({ outcome: "rejected", staleBase: false, message: expect.stringMatching(parent === "term" ? /系统驳回.*词条.*已删除/ : /系统驳回.*诠释者.*已删除/) });
  expect(await unread()).toBe(before + 1);
  expect((await readRoute(request(`/api/notifications/${pending.submissionId}/read`, editor, {}), { params: Promise.resolve({ id: String(pending.submissionId) }) })).status).toBe(200);
  await action(parent === "term" ? term.pageId : interpreter.pageId, "restore");
  expect((await vote(pending.submissionId, admin2)).status).toBe(409);
  expect(await search(proposal.content)).toHaveLength(0);
  // 同一挂载能创建并发布，证明拒绝没有留下占位页或部分修订。
  const next = await created(editor, { ...proposal, supersedes: pending.submissionId });
  expect(next.submissionId).not.toBe(pending.submissionId);
  await vote(next.submissionId, admin1);
  expect(await (await vote(next.submissionId, admin2)).json()).toEqual({ outcome: "approved" });
  const hits = await search(proposal.content);
  expect(hits).toHaveLength(1);
  const history = await historyRoute(request(`/api/pages/${hits[0].pageId}/history`, ""), { params: Promise.resolve({ pageId: String(hits[0].pageId) }) });
  expect(history.status).toBe(200);
  expect((await history.json()).revisions.map((revision: { content: string }) => revision.content)).toEqual([proposal.content]);
});

it.each(["term", "interpreter"] as const)("%s 已删除时编者与管理员创建都解释具体失效原因，且不占用视角", async (parent) => {
  const { term, interpreter, proposal } = await fixture();
  const id = parent === "term" ? term.pageId : interpreter.pageId;
  await action(id, "delete");
  for (const cookie of [editor, admin1]) {
    const response = await submit(cookie, proposal);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(parent === "term" ? /词条.*已删除/ : /诠释者.*已删除/) });
  }
  await action(id, "restore");
  expect(await search(proposal.content)).toHaveLength(0);
  expect(await created(admin1, proposal)).toMatchObject({ outcome: "direct" });
});

it.each(["term", "interpreter"] as const)("%s 在首票前已删除时立即系统驳回", async (parent) => {
  const { term, interpreter, proposal } = await fixture();
  const pending = await created(editor, proposal);
  await action(parent === "term" ? term.pageId : interpreter.pageId, "delete");
  expect(await (await vote(pending.submissionId, admin1)).json()).toMatchObject({ outcome: "rejected", staleBase: false });
  expect((await vote(pending.submissionId, admin2)).status).toBe(409);
});

for (const parent of ["term", "interpreter"] as const) {
  for (const mode of ["review", "direct"] as const) {
    it(`${parent} 删除与 ${mode} 并发可串行解释，删除后隐藏，恢复后仅有完整发布`, async () => {
      const { term, interpreter, proposal } = await fixture();
      const parentId = parent === "term" ? term.pageId : interpreter.pageId;
      let pendingId: number | undefined;
      if (mode === "review") {
        pendingId = (await created(editor, proposal)).submissionId;
        await vote(pendingId!, admin1);
      }
      const [published] = await Promise.all([
        mode === "review" ? vote(pendingId!, admin2) : submit(admin2, proposal),
        action(parentId, "delete"),
      ]);
      expect([200, 201, 404]).toContain(published.status);
      const result = await published.json();
      const success = result.outcome === "approved" || result.outcome === "direct";
      if (!success) {
        if (mode === "review") expect(result).toMatchObject({ outcome: "rejected", message: expect.stringContaining("系统驳回") });
        else expect(result).toMatchObject({ error: expect.stringContaining("已删除") });
      }
      expect(await search(proposal.content)).toHaveLength(0);
      await action(parentId, "restore");
      let hits = await search(proposal.content);
      expect(hits).toHaveLength(success ? 1 : 0);
      if (!success) {
        await created(admin1, proposal);
        hits = await search(proposal.content);
      }
      const pageId = hits[0].pageId;
      const history = await historyRoute(request(`/api/pages/${pageId}/history`, ""), { params: Promise.resolve({ pageId: String(pageId) }) });
      expect((await history.json()).revisions.map((revision: { content: string }) => revision.content)).toEqual([proposal.content]);
      // 受理先结束、随后删除的另一确定顺序：已发布内容照常被隐藏和恢复。
      await action(parentId, "delete");
      expect((await historyRoute(request(`/api/pages/${pageId}/history`, ""), { params: Promise.resolve({ pageId: String(pageId) }) })).status).toBe(404);
      await action(parentId, "restore");
      expect((await historyRoute(request(`/api/pages/${pageId}/history`, ""), { params: Promise.resolve({ pageId: String(pageId) }) })).status).toBe(200);
    });
  }
}
