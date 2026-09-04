// 服务端组件取登录态的唯一入口（T05）。游客返回 null——未登录浏览完全不受限。

import "server-only";

import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import type { UserRole } from "@/db/schema";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    // additionalFields 的类型是 string；取值域由 user_role 枚举保证
    role: session.user.role as UserRole,
  };
}
