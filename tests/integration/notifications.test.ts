import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { POST as submit } from "@/app/api/submissions/route";
import { POST as review } from "@/app/api/admin/submissions/[id]/review/route";
import { POST as markRead } from "@/app/api/notifications/[id]/read/route";
import { GET as unreadCount } from "@/app/api/notifications/unread-count/route";
import { getDb } from "@/db";
import { pages, submissions, user } from "@/db/schema";
import { auth } from "@/lib/auth";

const userIds: string[] = [];
let editor: string;
let otherEditor: string;
let admin1: string;
let admin2: string;

async function createUser(role: "editor" | "admin") {
  const email = `t09-${randomUUID()}@example.com`;
  const password = "test-notifications-123";
  const account = await auth.api.signUpEmail({ body: { name: "T09 编者", email, password } });
  userIds.push(account.user.id);
  await getDb().update(user).set({ role }).where(eq(user.id, account.user.id));
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

beforeAll(async () => {
  editor = await createUser("editor");
  otherEditor = await createUser("editor");
  admin1 = await createUser("admin");
  admin2 = await createUser("admin");
});

afterAll(async () => {
  if (!userIds.length) return;
  const db = getDb();
  await db.delete(pages).where(inArray(pages.createdBy, userIds));
  await db.delete(submissions).where(inArray(submissions.submittedBy, userIds));
  await db.delete(user).where(inArray(user.id, userIds));
});

function request(path: string, cookie?: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function readNotification(id: number | string, cookie?: string) {
  return markRead(request(`/api/notifications/${id}/read`, cookie), {
    params: Promise.resolve({ id: String(id) }),
  });
}

function unreadNotifications(cookie?: string) {
  return unreadCount(new Request("http://localhost/api/notifications/unread-count", {
    headers: cookie ? { cookie } : {},
  }));
}

it("只有提交者能标记终态通知已读；首票无通知，重复标记幂等", async () => {
  const response = await submit(request("/api/submissions", editor, {
    kind: "new_term", title: `T09 通知 ${randomUUID()}`, summary: "审核通知测试",
  }));
  expect(response.status).toBe(201);
  const { submissionId, quorum } = await response.json();
  expect(quorum).toBe(2);
  expect((await readNotification(submissionId, editor)).status).toBe(404);
  expect(await (await unreadNotifications(editor)).json()).toEqual({ unreadCount: 0 });

  const vote = (cookie: string) => review(
    request(`/api/admin/submissions/${submissionId}/review`, cookie, { action: "approve" }),
    { params: Promise.resolve({ id: String(submissionId) }) },
  );
  expect(await (await vote(admin1)).json()).toMatchObject({ outcome: "pending" });
  expect((await readNotification(submissionId, editor)).status).toBe(404);
  expect(await (await unreadNotifications(editor)).json()).toEqual({ unreadCount: 0 });
  expect(await (await vote(admin2)).json()).toEqual({ outcome: "approved" });
  expect(await (await unreadNotifications(editor)).json()).toEqual({ unreadCount: 1 });
  expect(await (await unreadNotifications(otherEditor)).json()).toEqual({ unreadCount: 0 });
  expect((await unreadNotifications()).status).toBe(401);

  expect((await readNotification(submissionId)).status).toBe(401);
  expect((await readNotification(submissionId, otherEditor)).status).toBe(404);
  expect((await readNotification(submissionId, admin1)).status).toBe(404);
  expect((await readNotification(submissionId, editor)).status).toBe(200);
  expect((await readNotification(submissionId, editor)).status).toBe(200);
  expect(await (await unreadNotifications(editor)).json()).toEqual({ unreadCount: 0 });
  expect((await vote(admin2)).status).toBe(409);
});

it("标记已读校验通知 id，且不存在的通知返回 404", async () => {
  expect((await readNotification("bad-id", editor)).status).toBe(400);
  expect((await readNotification(0, editor)).status).toBe(400);
  expect((await readNotification(2147483647, editor)).status).toBe(404);
});
