// 管理员操作的准入（T05 会话角色）：请求经 better-auth 解析数据库会话，
// 未登录 401、已登录但非 admin 403——游客与普通编者都进不了管理员操作。

import { auth } from "@/lib/auth";
import type { UserRole } from "@/db/schema";

/**
 * 校验管理员身份。返回 null = 通过；否则返回应直接作为响应的错误 Response。
 */
export async function requireAdmin(req: Request): Promise<Response | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json({ error: "管理员操作需要登录" }, { status: 401 });
  }
  // additionalFields 的 role 类型是 string；取值域由 user_role 枚举保证
  if ((session.user.role as UserRole) !== "admin") {
    return Response.json({ error: "需要管理员角色" }, { status: 403 });
  }
  return null;
}
