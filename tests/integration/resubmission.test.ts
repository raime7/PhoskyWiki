import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, afterAll, expect, it } from "vitest";
import { POST as submit } from "@/app/api/submissions/route";
import { POST as vote } from "@/app/api/admin/submissions/[id]/review/route";
import { GET as history } from "@/app/api/pages/[pageId]/history/route";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { user, pages, submissions } from "@/db/schema";
const ids: string[] = [];
async function account(role: "admin" | "editor") {
  const email = `resubmit-${randomUUID()}@example.com`;
  const result = await auth.api.signUpEmail({ body: { email, name: role, password: "password123" } });
  ids.push(result.user.id);
  await getDb().update(user).set({ role }).where(eq(user.id, result.user.id));
  const response = await auth.api.signInEmail({ body: { email, password: "password123" }, asResponse: true });
  return response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
}
async function post(body: object, cookie: string) {
  return submit(new Request("http://localhost/api/submissions", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }));
}
async function review(id: number, cookie: string, action = "reject") {
  return vote(new Request(`http://localhost/api/admin/submissions/${id}/review`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ action, reason: "请补充证据" }) }), { params: Promise.resolve({ id: String(id) }) });
}
async function readHistory(id: number) {
  return (await history(new Request(`http://localhost/api/pages/${id}/history`), { params: Promise.resolve({ pageId: String(id) }) })).json();
}
let admin: string, editor: string, stranger: string;
beforeAll(async () => { admin = await account("admin"); editor = await account("editor"); stranger = await account("editor"); });
afterAll(async () => {
  await getDb().update(submissions).set({ supersedesId: null }).where(inArray(submissions.submittedBy, ids));
  await getDb().delete(submissions).where(inArray(submissions.submittedBy, ids));
  await getDb().delete(pages).where(inArray(pages.createdBy, ids));
  await getDb().delete(user).where(inArray(user.id, ids));
});
it("只允许原提交者从自己的同类驳回提案重提，旧记录保持终态", async () => {
  const payload = { kind: "new_interpreter", title: `Retry ${randomUUID()}`, summary: "完整原简介" };
  const { submissionId } = await (await post(payload, editor)).json();
  expect((await post({ ...payload, supersedes: submissionId }, editor)).status).toBe(400);
  expect((await review(submissionId, admin)).status).toBe(200);
  expect((await post({ ...payload, supersedes: submissionId }, stranger)).status).toBe(403);
  expect((await post({ ...payload, kind: "new_term", supersedes: submissionId }, editor)).status).toBe(400);
  const response = await post({ ...payload, summary: "修改后简介", supersedes: submissionId }, editor);
  expect(response.status).toBe(201);
  expect((await response.json()).submissionId).not.toBe(submissionId);
  expect((await review(submissionId, admin, "approve")).status).toBe(409);
});
it("过期基准重提必须明确确认当前修订，打开表单后再前进也不能静默覆盖", async () => {
  const title = `Rebase ${randomUUID()}`;
  const { pageId } = await (await post({ kind: "new_term", title }, admin)).json();
  const baseRevisionId = (await readHistory(pageId)).revisions[0].id;
  const payload = { kind: "edit", pageId, baseRevisionId, title, summary: "原提案", aliases: ["原别名"] };
  const { submissionId } = await (await post(payload, editor)).json();
  await review(submissionId, admin);
  await post({ ...payload, summary: "最新简介" }, admin);
  const current = (await readHistory(pageId)).revisions[0].id;
  expect((await post({ ...payload, supersedes: submissionId }, editor)).status).toBe(409);
  expect((await post({ ...payload, baseRevisionId: current, supersedes: submissionId }, editor)).status).toBe(409);
  expect((await post({ ...payload, baseRevisionId: current, confirmedBaseRevisionId: current, supersedes: submissionId }, editor)).status).toBe(201);
  await post({ ...payload, baseRevisionId: current, summary: "又一新版" }, admin);
  expect((await post({ ...payload, baseRevisionId: current, confirmedBaseRevisionId: current, supersedes: submissionId }, editor)).status).toBe(409);
});
