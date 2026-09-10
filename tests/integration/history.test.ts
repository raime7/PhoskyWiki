import { fixtureSignUp } from "./auth-fixture";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { GET as historyRoute } from "@/app/api/pages/[pageId]/history/route";
import { POST as manageRoute } from "@/app/api/admin/pages/[pageId]/route";
import { POST as reviewRoute } from "@/app/api/admin/submissions/[id]/review/route";
import { POST as submitRoute } from "@/app/api/submissions/route";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { seedDatabase } from "@/db/seed";
import { pages, perspectives, submissions, user } from "@/db/schema";

let adminCookie: string;
let editorCookie: string;
const userIds: string[] = [];

beforeAll(async () => {
  await seedDatabase();
  for (const role of ["admin", "editor"] as const) {
    const email = `t08-${randomUUID()}@example.com`;
    const password = "history-test-pass-123";
    const signed = await fixtureSignUp({ body: { email, password, name: `T08 ${role}` } });
    userIds.push(signed.user.id);
    await getDb().update(user).set({ role }).where(eq(user.id, signed.user.id));
    const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    const cookie = response.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ");
    if (role === "admin") adminCookie = cookie;
    else editorCookie = cookie;
  }
});

afterAll(async () => {
  if (!userIds.length) return;
  await getDb().delete(pages).where(inArray(pages.createdBy, userIds));
  await getDb().delete(submissions).where(inArray(submissions.submittedBy, userIds));
  await getDb().delete(user).where(inArray(user.id, userIds));
});

function request(url: string, cookie?: string, body?: unknown) {
  return new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function history(pageId: number, cookie?: string, query = "") {
  return historyRoute(request(`/api/pages/${pageId}/history${query}`, cookie), {
    params: Promise.resolve({ pageId: String(pageId) }),
  });
}

function manage(pageId: number, body: unknown, cookie = adminCookie) {
  return manageRoute(request(`/api/admin/pages/${pageId}`, cookie, body), {
    params: Promise.resolve({ pageId: String(pageId) }),
  });
}

async function edit(pageId: number, content: string) {
  const current = await (await history(pageId, adminCookie)).json();
  return submitRoute(request("/api/submissions", adminCookie, {
    kind: "edit", pageId, content, baseRevisionId: current.revisions[0].id,
  }));
}

async function writeComparedHistory(pageId: number) {
  for (const content of ["旧论点😀与旧结论", "中间修订", "新论点😀与新结论"]) {
    expect((await edit(pageId, content)).status).toBe(201);
  }
}

it("历史通过 HTTP 展示所有快照，新修订在前，旧内容保持不变", async () => {
  // 种子只用作输入定位；行为断言均通过 HTTP 边界。
  const [page] = await getDb().select({ id: pages.id }).from(pages).where(eq(pages.title, "拉康论主体性"));
  const initial = await (await history(page.id)).json();
  expect(initial.revisions).toHaveLength(1);
  await writeComparedHistory(page.id);
  const result = await history(page.id);
  expect(result.status).toBe(200);
  const data = await result.json();
  expect(data.revisions.map((r: { content: string }) => r.content)).toEqual([
    "新论点😀与新结论", "中间修订", "旧论点😀与旧结论", initial.revisions[0].content,
  ]);
  expect(data.revisions[3]).toEqual(initial.revisions[0]);
});

it("任意非相邻修订双向对比；不接受其他页面的修订或缺失参数", async () => {
  const [page] = await getDb().select({ id: pages.id }).from(pages).where(eq(pages.title, "拉康论主体性"));
  await writeComparedHistory(page.id);
  const { revisions: historyRows } = await (await history(page.id)).json();
  const newest = historyRows[0].id;
  const older = historyRows[2].id;
  const compared = await history(page.id, undefined, `?from=${older}&to=${newest}`);
  expect(compared.status).toBe(200);
  const { comparison } = await compared.json();
  expect(comparison.from.content).toBe("旧论点😀与旧结论");
  expect(comparison.to.content).toBe("新论点😀与新结论");
  expect(comparison.rows).toEqual([
    { type: "del", text: "旧论点😀与旧结论" },
    { type: "add", text: "新论点😀与新结论" },
  ]);
  const reverse = await (await history(page.id, undefined, `?from=${newest}&to=${older}`)).json();
  expect(reverse.comparison.from.id).toBe(newest);
  expect(reverse.comparison.to.id).toBe(older);
  expect((await history(page.id, undefined, `?from=${older}`)).status).toBe(400);
  expect((await history(page.id, undefined, `?from=bad&to=${older}`)).status).toBe(400);
  const [other] = await getDb().select({ id: pages.id }).from(pages).where(eq(pages.title, "福柯论主体性"));
  const otherHistory = await (await history(other.id)).json();
  expect((await history(page.id, undefined, `?from=${otherHistory.revisions[0].id}&to=${older}`)).status).toBe(404);
});

it("只有管理员能回滚；回滚创建带来源的新修订，原历史完整保留", async () => {
  const [page] = await getDb().select({ id: pages.id }).from(pages).where(eq(pages.title, "拉康论主体性"));
  await writeComparedHistory(page.id);
  const before = await (await history(page.id)).json();
  const target = before.revisions[2];
  const body = { action: "rollback", revisionId: target.id };
  expect((await manage(page.id, body, "")).status).toBe(401);
  expect((await manage(page.id, body, editorCookie)).status).toBe(403);
  expect((await manage(page.id, { action: "rollback", revisionId: 99999999 })).status).toBe(404);
  expect((await manage(page.id, body)).status).toBe(200);
  const after = await (await history(page.id)).json();
  expect(after.revisions).toHaveLength(before.revisions.length + 1);
  expect(after.revisions[0]).toMatchObject({ content: "旧论点😀与旧结论", rollbackFromId: target.id });
  expect(after.revisions[0].id).not.toBe(target.id);
  expect(after.revisions.slice(1)).toEqual(before.revisions);
});

it("软删除屏蔽读者及编者的历史访问，管理员可查看并恢复完整历史", async () => {
  const [page] = await getDb().select({ id: pages.id }).from(pages).where(eq(pages.title, "拉康论主体性"));
  await edit(page.id, "删除前的修订");
  const before = await (await history(page.id)).json();
  for (const action of ["delete", "restore"]) {
    expect((await manage(page.id, { action }, "")).status).toBe(401);
    expect((await manage(page.id, { action }, editorCookie)).status).toBe(403);
  }
  expect((await manage(page.id, { action: "delete" })).status).toBe(200);
  expect((await manage(page.id, { action: "delete" })).status).toBe(200);
  expect((await history(page.id)).status).toBe(404);
  expect((await history(page.id, editorCookie)).status).toBe(404);
  expect((await history(page.id, undefined, `?from=${before.revisions[0].id}&to=${before.revisions[1].id}`)).status).toBe(404);
  const hidden = await (await history(page.id, adminCookie)).json();
  expect(hidden.page.deletedAt).not.toBeNull();
  expect(hidden.revisions).toEqual(before.revisions);
  expect((await edit(page.id, "已删除页面不得编辑")).status).toBe(404);
  expect((await manage(page.id, { action: "rollback", revisionId: before.revisions[0].id })).status).toBe(404);
  expect((await manage(page.id, { action: "restore" })).status).toBe(200);
  expect((await manage(page.id, { action: "restore" })).status).toBe(200);
  const restored = await (await history(page.id)).json();
  expect(restored.page.deletedAt).toBeNull();
  expect(restored.revisions).toEqual(before.revisions);
});

it.each(["term", "interpreter", "school"] as const)("%s 页面没有正文修订也可以删除与恢复", async (type) => {
  const [page] = await getDb().select({ id: pages.id }).from(pages).where(eq(pages.type, type)).limit(1);
  const original = await (await history(page.id)).json();
  expect((await manage(page.id, { action: "delete" })).status).toBe(200);
  expect((await history(page.id)).status).toBe(404);
  expect((await manage(page.id, { action: "restore" })).status).toBe(200);
  expect(await (await history(page.id)).json()).toEqual(original);
});

it.each(["termId", "interpreterId"] as const)("所属 %s 删除时，视角历史遵循正文的可见性，恢复后完整可读", async (parent) => {
  const [perspective] = await getDb().select().from(perspectives).limit(1);
  const original = await (await history(perspective.pageId)).json();
  expect((await manage(perspective[parent], { action: "delete" })).status).toBe(200);
  try {
    expect((await history(perspective.pageId)).status).toBe(404);
    expect((await history(perspective.pageId, editorCookie)).status).toBe(404);
    expect((await history(perspective.pageId, adminCookie)).status).toBe(200);
  } finally {
    await manage(perspective[parent], { action: "restore" });
  }
  expect(await (await history(perspective.pageId)).json()).toEqual(original);
});

it("回滚推进 head 后，旧 base 的待审提交被驳回，过期管理员编辑返回 409", async () => {
  const [page] = await getDb().select({ id: pages.id }).from(pages).where(eq(pages.title, "福柯论主体性"));
  const before = await (await history(page.id)).json();
  const input = { kind: "edit", pageId: page.id, content: "不应覆盖回滚的提议", baseRevisionId: before.revisions[0].id };
  const pending = await (await submitRoute(request("/api/submissions", editorCookie, input))).json();
  expect((await manage(page.id, { action: "rollback", revisionId: before.revisions[0].id })).status).toBe(200);
  const reviewed = await reviewRoute(request(`/api/admin/submissions/${pending.submissionId}/review`, adminCookie, { action: "approve" }), {
    params: Promise.resolve({ id: String(pending.submissionId) }),
  });
  expect(await reviewed.json()).toMatchObject({ outcome: "rejected", staleBase: true });
  expect((await submitRoute(request("/api/submissions", adminCookie, input))).status).toBe(409);
  const after = await (await history(page.id)).json();
  expect(after.revisions).toHaveLength(before.revisions.length + 1);
  expect(after.revisions[0].content).toBe(before.revisions[0].content);
});

it("并发直编同一 base 只允许一份生效，不覆盖抢先写入的修订", async () => {
  const [page] = await getDb().select({ id: pages.id }).from(pages).where(eq(pages.title, "福柯论主体性"));
  const before = await (await history(page.id)).json();
  const responses = await Promise.all(["第一份并发编辑", "第二份并发编辑"].map((content) =>
    submitRoute(request("/api/submissions", adminCookie, {
      kind: "edit", pageId: page.id, content, baseRevisionId: before.revisions[0].id,
    })),
  ));
  expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  const after = await (await history(page.id)).json();
  expect(after.revisions).toHaveLength(before.revisions.length + 1);
  expect(after.revisions.slice(1)).toEqual(before.revisions);
});

it("非法管理输入返回 400，不存在页面与跨页回滚返回 404", async () => {
  const [page] = await getDb().select({ id: pages.id }).from(pages).where(eq(pages.title, "拉康论主体性"));
  const [other] = await getDb().select({ id: pages.id }).from(pages).where(eq(pages.title, "福柯论主体性"));
  const otherHistory = await (await history(other.id)).json();
  expect((await manage(page.id, { action: "rollback", revisionId: otherHistory.revisions[0].id })).status).toBe(404);
  for (const body of [null, [], {}, { action: "bad" }, { action: "rollback" }, { action: "rollback", revisionId: true }]) {
    expect((await manage(page.id, body)).status).toBe(400);
  }
  expect((await manage(0, { action: "delete" })).status).toBe(400);
  expect((await manage(99999999, { action: "restore" })).status).toBe(404);
  expect((await history(99999999)).status).toBe(404);
  expect((await history(2147483648)).status).toBe(400);
});
