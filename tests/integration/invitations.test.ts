import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { seedAdminAccount } from "@/db/seed-admin";
import { getDb } from "@/db";
import { accessGrants, user } from "@/db/schema";
import { POST as manage, GET as list } from "@/app/api/admin/access/route";
import { POST as register } from "@/app/api/access/register/route";
import { POST as reset } from "@/app/api/access/reset/route";

let adminCookie: string;
const createdEmails: string[] = [];
afterAll(async () => { await getDb().delete(user).where(inArray(user.email, createdEmails)); });
const password = "invitation-test-123";
function request(path: string, body: unknown, cookie = "", origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000${path}`, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function login(email: string, value = password) {
  const response = await auth.api.signInEmail({ body: { email, password: value }, asResponse: true });
  return { response, cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") };
}
beforeAll(async () => {
  const email = `d02-admin-${randomUUID()}@example.com`;
  createdEmails.push(email);
  await seedAdminAccount({ email, password });
  adminCookie = (await login(email)).cookie;
});
async function issue(purpose = "invitation", targetUserId?: string) {
  const response = await manage(request("/api/admin/access", { action: "issue", purpose, targetUserId }, adminCookie));
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return await response.json() as { id: string; token: string; expiresAt: string };
}
async function exchange(token: unknown, extras: Record<string, unknown> = {}) {
  const email = `d02-editor-${randomUUID()}@example.com`;
  createdEmails.push(email);
  return register(request("/api/access/register", { token, email, name: "受邀编者", password, ...extras }));
}

it("直接认证注册不能绕过邀请准入", async () => {
  const response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ name: "绕过", email: `${randomUUID()}@example.com`, password: "password123" }),
  }));
  expect(response.status).toBe(400);
});

it("生产兑换入口保留每来源每路径 10 秒三次的认证限流", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  try {
    for (const [path, handler] of [["/api/access/register", register], ["/api/access/reset", reset]] as const) {
      for (let i = 0; i < 3; i++) expect((await handler(request(path, { token: "invalid", password }))).status).toBe(400);
      const denied = await handler(request(path, { token: "invalid", password }));
      expect(denied.status).toBe(429);
      expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(denied.headers.get("cache-control")).toBe("no-store");
    }
  } finally { vi.unstubAllEnvs(); }
});

it("邀请注册仅创建编者；会话可刷新/登出；列表不返回原始令牌或摘要", async () => {
  const grant = await issue();
  expect(new Date(grant.expiresAt).getTime() - Date.now()).toBeGreaterThan(604790000);
  const response = await exchange(grant.token, { role: "admin" });
  expect(response.status).toBe(201);
  const { user } = await response.json();
  expect(user).toMatchObject({ role: "editor", emailVerified: false });
  const signed = await login(user.email);
  const headers = new Headers({ cookie: signed.cookie });
  expect((await auth.api.getSession({ headers }))?.user.id).toBe(user.id);
  expect((await auth.api.getSession({ headers }))?.user.id).toBe(user.id);
  await auth.api.signOut({ headers });
  expect(await auth.api.getSession({ headers })).toBeNull();
  const listed = await list(new Request("http://localhost:3000/api/admin/access", { headers: { cookie: adminCookie } }));
  const text = await listed.text();
  expect(text).not.toContain(grant.token);
  expect(text).not.toContain("digest");
});

it("游客和编者不能签发/撤销；跨站与非法请求失败", async () => {
  const grant = await issue();
  const editor = await (await exchange(grant.token)).json();
  const cookie = (await login(editor.user.email)).cookie;
  for (const [actor, status] of [["", 401], [cookie, 403]] as const) {
    for (const body of [{ action: "issue", purpose: "invitation" }, { action: "issue", purpose: "reset", targetUserId: editor.user.id }, { action: "revoke", id: grant.id }]) {
      expect((await manage(request("/api/admin/access", body, actor))).status).toBe(status);
    }
  }
  expect((await manage(request("/api/admin/access", { action: "issue", purpose: "invitation" }, adminCookie, "https://evil.example"))).status).toBe(403);
  for (const token of [null, {}, [], "bad", "x".repeat(43)]) expect((await exchange(token)).status).toBe(400);
  expect((await manage(request("/api/admin/access", { action: "issue", purpose: "reset", targetUserId: "missing" }, adminCookie))).status).toBe(404);
});

it("并发和重放最多创建一个账号；失效令牌给出明确结果", async () => {
  const grant = await issue();
  const responses = await Promise.all([exchange(grant.token), exchange(grant.token), exchange(grant.token)]);
  expect(responses.map(r => r.status).sort()).toEqual([201, 400, 400]);
  expect(await (await exchange(grant.token)).text()).toContain("已使用");
  const revoked = await issue();
  expect((await manage(request("/api/admin/access", { action: "revoke", id: revoked.id }, adminCookie))).status).toBe(200);
  expect(await (await exchange(revoked.token)).text()).toContain("已撤销");
  const expired = await issue();
  await getDb().update(accessGrants).set({ expiresAt: new Date(0) }).where(eq(accessGrants.id, expired.id));
  expect(await (await exchange(expired.token)).text()).toContain("已过期");
});

it("两张邀请并发注册同一邮箱，失败方仍可邀请另一位编者", async () => {
  const grants = [await issue(), await issue()];
  const email = `d02-editor-${randomUUID()}@example.com`;
  createdEmails.push(email);
  const results = await Promise.all(grants.map(grant => exchange(grant.token, { email })));
  expect(results.map(response => response.status).sort()).toEqual([201, 422]);
  const losingGrant = grants[results[0].status === 422 ? 0 : 1];
  expect((await exchange(losingGrant.token)).status).toBe(201);
});

it("重复邮箱、无效密码和非法资料不消费邀请；已有角色不变", async () => {
  const existing = await (await exchange((await issue()).token)).json();
  const grant = await issue();
  expect((await exchange(grant.token, { email: existing.user.email.toUpperCase(), role: "admin" })).status).toBe(422);
  expect((await exchange(grant.token, { password: "short" })).status).toBe(400);
  expect((await exchange(grant.token, { email: "bad..email@example.com" })).status).toBe(400);
  expect((await exchange(grant.token, { name: "", email: "invalid" })).status).toBe(400);
  expect((await exchange(grant.token)).status).toBe(201);
  expect((await (await login(existing.user.email)).response.json()).user.role).toBe("editor");
});

it("账号凭据写入故障回滚整次注册，不留下半成账号或泄露秘密", async () => {
  const grant = await issue();
  const email = `d02-editor-${randomUUID()}@example.com`;
  createdEmails.push(email);
  await getDb().execute(sql`create function d02_fail_credential() returns trigger language plpgsql as $$ begin
    if exists (select 1 from "user" where id = new.user_id and name = 'D02故障注入') then raise exception 'injected failure'; end if;
    return new; end $$`);
  await getDb().execute(sql`create trigger d02_fail_credential before insert on account for each row execute function d02_fail_credential()`);
  try {
    const result = await exchange(grant.token, { email, name: "D02故障注入" });
    expect(result.status).toBe(503);
    const text = await result.text();
    expect(text).not.toContain(grant.token);
    expect(text).not.toContain(password);
    expect((await login(email)).response.status).toBe(401);
  } finally {
    await getDb().execute(sql`drop trigger d02_fail_credential on account`);
    await getDb().execute(sql`drop function d02_fail_credential()`);
  }
  expect((await exchange(grant.token, { email })).status).toBe(201);
  expect((await login(email)).response.status).toBe(200);
});

it("恢复与邀请不可互换；重设撤销全部旧会话和旧密码，忽略伪造目标", async () => {
  const invitation = await issue();
  const editor = await (await exchange(invitation.token)).json();
  const one = await login(editor.user.email);
  const two = await login(editor.user.email);
  const grant = await issue("reset", editor.user.id);
  expect(new Date(grant.expiresAt).getTime() - Date.now()).toBeGreaterThan(3590000);
  expect((await exchange(grant.token)).status).toBe(400);
  const unused = await issue();
  expect((await reset(request("/api/access/reset", { token: unused.token, password }))).status).toBe(400);
  expect((await reset(request("/api/access/reset", { token: grant.token, password: "short" }))).status).toBe(400);
  const result = await reset(request("/api/access/reset", { token: grant.token, password: "new-password123", userId: "other", role: "admin" }));
  expect(result.status).toBe(200);
  expect((await login(editor.user.email)).response.status).toBe(401);
  expect((await login(editor.user.email, "new-password123")).response.status).toBe(200);
  for (const signed of [one, two]) expect(await auth.api.getSession({ headers: new Headers({ cookie: signed.cookie }) })).toBeNull();
  expect((await reset(request("/api/access/reset", { token: grant.token, password }))).status).toBe(400);
});

it("恢复令牌过期、撤销和并发兑换保持单次语义", async () => {
  const editor = await (await exchange((await issue()).token)).json();
  for (const state of ["expired", "revoked"] as const) {
    const grant = await issue("reset", editor.user.id);
    if (state === "expired") await getDb().update(accessGrants).set({ expiresAt: new Date(0) }).where(eq(accessGrants.id, grant.id));
    else await manage(request("/api/admin/access", { action: "revoke", id: grant.id }, adminCookie));
    expect((await reset(request("/api/access/reset", { token: grant.token, password: "new-password123" }))).status).toBe(400);
    expect((await login(editor.user.email)).response.status).toBe(200);
  }
  const grant = await issue("reset", editor.user.id);
  const responses = await Promise.all(["first-new-pass", "second-new-pass"].map(password => reset(request("/api/access/reset", { token: grant.token, password }))));
  expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
  expect((await login(editor.user.email, responses[0].status === 200 ? "first-new-pass" : "second-new-pass")).response.status).toBe(200);
});

it("已经校验旧密码但尚未创建会话的登录不能跨过密码重设", async () => {
  const editor = await (await exchange((await issue()).token, { name: "D02并发登录" })).json();
  const grant = await issue("reset", editor.user.id);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const blocker = await pool.connect();
  await getDb().execute(sql`create function d02_pause_signin() returns trigger language plpgsql as $$ begin
    if exists (select 1 from "user" where id = new.user_id and name = 'D02并发登录') then perform pg_advisory_xact_lock(70236, 1); end if;
    return new; end $$`);
  await getDb().execute(sql`create trigger d02_pause_signin before insert on session for each row execute function d02_pause_signin()`);
  await blocker.query("select pg_advisory_lock(70236, 1)");
  const pending = login(editor.user.email);
  try {
    try {
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const rows = await blocker.query("select 1 from pg_locks where locktype = 'advisory' and classid = 70236 and objid = 1 and not granted");
        if (rows.rowCount) { waiting = true; break; }
        await delay(20);
      }
      expect(waiting).toBe(true);
      expect((await reset(request("/api/access/reset", { token: grant.token, password: "concurrent-new-pass" }))).status).toBe(200);
    } finally {
      await blocker.query("select pg_advisory_unlock(70236, 1)");
      blocker.release(); await pool.end();
    }
    const signed = await pending;
    expect(signed.response.status).toBe(401);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: signed.cookie }) })).toBeNull();
  } finally {
    await pending;
    await getDb().execute(sql`drop trigger d02_pause_signin on session`);
    await getDb().execute(sql`drop function d02_pause_signin()`);
  }
});
