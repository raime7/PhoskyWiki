// 认证与角色集成测试（T05）：better-auth 服务端 API + 数据库断言，连真实 PG。
// 浏览器全流程（注册→登出→再登录）由 tests/e2e/auth.spec.ts 覆盖。
// 注意：只碰 user/session/account 表，不与并行跑的种子测试（内容表 TRUNCATE）冲突。

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { CREDENTIAL_ISSUER, seedAdminAccount } from "@/db/seed-admin";
import { account, session, user } from "@/db/schema";

const createdEmails: string[] = [];

async function signUpFixture(password = "password123") {
  const email = `t05-${randomUUID()}@example.com`;
  createdEmails.push(email);
  const res = await auth.api.signUpEmail({
    body: { name: "测试编者", email, password },
  });
  return { email, res };
}

afterAll(async () => {
  // 级联清掉 account/session；user 行按 email 删
  const db = getDb();
  for (const email of createdEmails) {
    await db.delete(user).where(eq(user.email, email));
  }
});

describe("注册（邮箱 + 密码）", () => {
  it("创建 editor 角色用户 + credential 账号（密码只存散列）并自动建立会话", async () => {
    const db = getDb();
    const { email, res } = await signUpFixture();

    expect(res.user).toMatchObject({ email, role: "editor", emailVerified: false });
    expect(typeof res.token).toBe("string");

    const [row] = await db.select().from(user).where(eq(user.email, email));
    expect(row.role).toBe("editor");

    const [acc] = await db.select().from(account).where(eq(account.userId, row.id));
    expect(acc).toMatchObject({
      providerId: "credential",
      issuer: CREDENTIAL_ISSUER,
      accountId: row.id,
    });
    expect(acc.password).toBeTruthy();
    expect(acc.password).not.toBe("password123");

    // autoSignIn：注册即有数据库会话
    const sessions = await db.select().from(session).where(eq(session.userId, row.id));
    expect(sessions.length).toBeGreaterThanOrEqual(1);
  });

  it("注册请求携带 role 一律忽略（角色只能由服务端写入）", async () => {
    const email = `t05-${randomUUID()}@example.com`;
    createdEmails.push(email);
    const res = await auth.api.signUpEmail({
      // role 在输入 schema 之外（input:false）——类型与运行时都必须被忽略
      body: { name: "注入尝试", email, password: "password123", role: "admin" } as never,
    });
    expect(res.user.role).toBe("editor");
  });

  it("重复邮箱注册被拒绝；密码过短被拒绝", async () => {
    const { email } = await signUpFixture();

    await expect(
      auth.api.signUpEmail({
        body: { name: "重复", email, password: "password123" },
      }),
    ).rejects.toMatchObject({ statusCode: 422 });

    await expect(
      auth.api.signUpEmail({
        body: { name: "过短", email: `t05-${randomUUID()}@example.com`, password: "short" },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("登录（数据库会话）", () => {
  it("正确凭据建立新会话；错误凭据 401，不建会话", async () => {
    const db = getDb();
    const { email } = await signUpFixture();

    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    const before = await db.$count(session, eq(session.userId, u.id));

    const good = await auth.api.signInEmail({ body: { email, password: "password123" } });
    expect(good.user.email).toBe(email);
    expect(await db.$count(session, eq(session.userId, u.id))).toBe(before + 1);

    await expect(
      auth.api.signInEmail({ body: { email, password: "wrong-password" } }),
    ).rejects.toMatchObject({
      statusCode: 401,
      body: { code: "INVALID_EMAIL_OR_PASSWORD" },
    });
    expect(await db.$count(session, eq(session.userId, u.id))).toBe(before + 1);
  });
});

describe("来源信任（dev/test 信任任意本地端口）", () => {
  // e2e 用 PW_PORT 可把应用起在任意本地端口，而 BETTER_AUTH_URL 固定 3000；
  // 浏览器登录请求带 origin 头，来源检查必须放行本地端口（见 auth.ts trustedOrigins）。
  it("非 baseURL 端口的 localhost origin 不再 403（走正常错误路径）", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3456/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3456" },
        body: JSON.stringify({ email: "nobody@example.com", password: "wrong-pass" }),
      }),
    );
    // 来源放行后进入业务路径：凭据无效 → 401（而非 403 INVALID_ORIGIN）
    expect(res.status).toBe(401);
  });

  it("陌生外域 origin 仍被拒绝（403）", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example.com" },
        body: JSON.stringify({ email: "nobody@example.com", password: "wrong-pass" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("种子管理员", () => {
  it("凭环境无关的显式凭据创建 admin，可登录，且重复执行幂等", async () => {
    const email = `t05-admin-${randomUUID()}@example.com`;
    createdEmails.push(email);
    const first = await seedAdminAccount({ email, password: "admin-pass-123" });
    expect(first).toMatchObject({ created: true, passwordGenerated: false });

    const db = getDb();
    const [row] = await db.select().from(user).where(eq(user.email, email));
    expect(row.role).toBe("admin");

    // 种子写入的凭据能走正常登录路径
    const signIn = await auth.api.signInEmail({ body: { email, password: "admin-pass-123" } });
    expect(signIn.user.role).toBe("admin");

    // 换密码重灌：仍是同一用户，新密码生效
    const second = await seedAdminAccount({ email, password: "rotated-pass-456" });
    expect(second.created).toBe(false);
    await expect(
      auth.api.signInEmail({ body: { email, password: "admin-pass-123" } }),
    ).rejects.toMatchObject({ statusCode: 401 });
    const rotated = await auth.api.signInEmail({ body: { email, password: "rotated-pass-456" } });
    expect(rotated.user.id).toBe(row.id);
  });
});
