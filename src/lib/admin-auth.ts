// 管理员操作的准入（T04 停摆方案）：角色体系随 T05（认证与角色）落到会话，
// 在那之前 fail-closed——仅在环境显式配置 ADMIN_TOKEN 时放行，校验
// x-admin-token 请求头（常数时间比较）。T05 接入后本文件应改为会话角色检查。

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 校验管理员身份。返回 null = 通过；否则返回应直接作为响应的错误 Response。
 * 未配置 ADMIN_TOKEN 时一律拒绝（503），保证默认部署不暴露管理员面。
 */
export function requireAdmin(req: Request): Response | null {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return Response.json(
      { error: "未配置 ADMIN_TOKEN：管理员操作在 T05 接入会话角色前不可用" },
      { status: 503 },
    );
  }
  const presented = req.headers.get("x-admin-token") ?? "";
  const expectedHash = createHash("sha256").update(expected).digest();
  const presentedHash = createHash("sha256").update(presented).digest();
  if (!timingSafeEqual(expectedHash, presentedHash)) {
    return Response.json({ error: "无效的管理员令牌" }, { status: 403 });
  }
  return null;
}
