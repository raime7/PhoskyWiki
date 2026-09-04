// better-auth 服务端实例（T05）：邮箱密码 + 数据库会话。
// 表结构在 src/db/schema.ts（user/session/account/verification），角色枚举 user_role。
// 密钥读 BETTER_AUTH_SECRET、baseURL 读 BETTER_AUTH_URL（见 .env.example）。

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { getDb } from "@/db";
import { account, session, user, verification } from "@/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      // 角色只能由服务端/种子写入，注册请求携带 role 一律忽略
      role: {
        type: "string",
        required: true,
        defaultValue: "editor",
        input: false,
      },
    },
  },
  session: {
    // 数据库会话默认 30 天有效，滚动续期——「会话持久」的验收口径
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
});

export type Session = typeof auth.$Infer.Session;
