import { fixtureSignUp } from "./auth-fixture";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, afterAll, expect, it } from "vitest";
import { POST as submit } from "@/app/api/submissions/route";
import { POST as vote } from "@/app/api/admin/submissions/[id]/review/route";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { user, pages, submissions } from "@/db/schema";
import { listQueue } from "@/lib/review";
import { getMySubmission } from "@/lib/submission-history";

const ids: string[] = [];
async function account(role: "admin" | "editor") {
  const email = `note-${randomUUID()}@example.com`;
  const result = await fixtureSignUp({ body: { email, name: role, password: "password123" } });
  ids.push(result.user.id);
  await getDb().update(user).set({ role }).where(eq(user.id, result.user.id));
  const response = await auth.api.signInEmail({ body: { email, password: "password123" }, asResponse: true });
  return { id: result.user.id, cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") };
}
async function post(body: object, cookie: string) {
  return submit(new Request("http://localhost/api/submissions", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }));
}
async function reject(id: number, cookie: string) {
  return vote(new Request(`http://localhost/api/admin/submissions/${id}/review`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "reject", reason: "请补充" }) }), { params: Promise.resolve({ id: String(id) }) });
}
let admin: Awaited<ReturnType<typeof account>>, editor: Awaited<ReturnType<typeof account>>;
beforeAll(async () => { admin = await account("admin"); editor = await account("editor"); });
afterAll(async () => {
  await getDb().update(submissions).set({ supersedesId: null }).where(inArray(submissions.submittedBy, ids));
  await getDb().delete(submissions).where(inArray(submissions.submittedBy, ids));
  await getDb().delete(pages).where(inArray(pages.createdBy, ids));
  await getDb().delete(user).where(inArray(user.id, ids));
});

const noteOf = async (submissionId: number) => (await listQueue()).find(i => i.id === submissionId)?.note;

it("带说明的提交成功，审核队列与提交者详情都返回说明（两端去空白）", async () => {
  const response = await post({ kind: "new_interpreter", title: `Note ${randomUUID()}`, note: "  审稿报告：<script>alert(1)</script>  " }, editor.cookie);
  expect(response.status).toBe(201);
  const { submissionId } = await response.json();
  expect(await noteOf(submissionId)).toBe("审稿报告：<script>alert(1)</script>");
  expect((await getMySubmission(editor.id, submissionId))?.note).toBe("审稿报告：<script>alert(1)</script>");
});

it("不带说明或空白说明都按未填处理", async () => {
  const title = `Plain ${randomUUID()}`;
  const a = await (await post({ kind: "new_interpreter", title }, editor.cookie)).json();
  const b = await (await post({ kind: "new_interpreter", title: `${title} b`, note: " \n\t " }, editor.cookie)).json();
  expect(await noteOf(a.submissionId)).toBeNull();
  expect(await noteOf(b.submissionId)).toBeNull();
});

it("超长说明返回 400，恰好上限可通过", async () => {
  const title = `Long ${randomUUID()}`;
  expect((await post({ kind: "new_interpreter", title, note: "x".repeat(20001) }, editor.cookie)).status).toBe(400);
  expect((await post({ kind: "new_interpreter", title, note: "x".repeat(20000) }, editor.cookie)).status).toBe(201);
});

it("修改重提不继承说明，可重新填写", async () => {
  const payload = { kind: "new_interpreter", title: `Resub ${randomUUID()}` };
  const { submissionId } = await (await post({ ...payload, note: "原说明" }, editor.cookie)).json();
  expect((await reject(submissionId, admin.cookie)).status).toBe(200);
  const next = await (await post({ ...payload, supersedes: submissionId }, editor.cookie)).json();
  expect(await noteOf(next.submissionId)).toBeNull();
  const again = await (await post({ ...payload, note: "新说明" }, editor.cookie)).json();
  expect(await noteOf(again.submissionId)).toBe("新说明");
});

it("管理员直编不产生提交行，说明不落库", async () => {
  const before = await getDb().select().from(submissions).where(eq(submissions.submittedBy, admin.id));
  const response = await post({ kind: "new_term", title: `Direct ${randomUUID()}`, note: "不应保存" }, admin.cookie);
  expect(response.status).toBe(201);
  expect((await response.json()).outcome).toBe("direct");
  const after = await getDb().select().from(submissions).where(eq(submissions.submittedBy, admin.id));
  expect(after.length).toBe(before.length);
});
