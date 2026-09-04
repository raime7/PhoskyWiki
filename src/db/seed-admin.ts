// 种子管理员（T05）：幂等 upsert——存在则校正角色与密码，不存在则创建。
// 凭据走环境变量 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD（见 .env.example），
// 密码未设置时随机生成并由调用方打印，任何真实凭据不进仓库。

import { randomUUID } from "node:crypto";

import { generateRandomString, hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { account, user } from "@/db/schema";

/** 与 better-auth 的 createLocalAccountIssuer("credential") 一致（账号表命名空间） */
export const CREDENTIAL_ISSUER = "local:credential";

export interface SeedAdminResult {
  email: string;
  /** 实际使用的密码：环境变量给定的或随机生成的 */
  password: string;
  /** 本次是否新建（false = 更新既有账号） */
  created: boolean;
  /** 密码是否为随机生成（提示调用方打印/保存） */
  passwordGenerated: boolean;
}

export async function seedAdminAccount(overrides?: {
  email?: string;
  password?: string;
}): Promise<SeedAdminResult> {
  const email = (
    overrides?.email ?? process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local"
  ).toLowerCase();
  const envPassword = overrides?.password ?? process.env.SEED_ADMIN_PASSWORD ?? "";
  const passwordGenerated = envPassword === "";
  const password = passwordGenerated ? generateRandomString(20) : envPassword;

  const db = getDb();
  const passwordHash = await hashPassword(password);
  const now = new Date();

  const [existing] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  const userId = existing?.id ?? randomUUID();

  if (existing) {
    await db.update(user).set({ role: "admin", updatedAt: now }).where(eq(user.id, userId));
  } else {
    await db.insert(user).values({
      id: userId,
      name: "管理员",
      email,
      emailVerified: true,
      role: "admin",
    });
  }

  // 邮箱密码登录查的是 (providerId=credential, issuer, accountId=user.id)
  await db
    .insert(account)
    .values({
      accountId: userId,
      providerId: "credential",
      issuer: CREDENTIAL_ISSUER,
      userId,
      password: passwordHash,
    })
    .onConflictDoUpdate({
      target: [account.providerId, account.accountId],
      set: { password: passwordHash, updatedAt: now },
    });

  return { email, password, created: !existing, passwordGenerated };
}
