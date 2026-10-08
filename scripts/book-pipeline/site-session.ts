// 站点登录（submit 与 export-site 共用）：用 BOOK_PIPELINE_EMAIL / BOOK_PIPELINE_PASSWORD 登录 AI 编者账号。
// HTTP 薄层，不在测试范围内；调用方决定是否要求账号角色。

import { fail } from "./errors";

export async function siteHttp(origin: string, cookie: string, path: string, body?: unknown): Promise<Response> {
  return fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
}

export function hasPipelineCredentials(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.BOOK_PIPELINE_EMAIL && env.BOOK_PIPELINE_PASSWORD);
}

/** 登录并返回会话 Cookie 与账号角色；凭据缺失或登录失败即报错。 */
export async function loginPipelineAccount(origin: string, env: NodeJS.ProcessEnv): Promise<{ cookie: string; role: string | undefined }> {
  const email = env.BOOK_PIPELINE_EMAIL;
  const password = env.BOOK_PIPELINE_PASSWORD;
  if (!email || !password) fail("SUBMIT_CREDENTIALS", "set BOOK_PIPELINE_EMAIL and BOOK_PIPELINE_PASSWORD (the AI editor account)");
  const login = await siteHttp(origin, "", "/api/auth/sign-in/email", { email, password });
  if (!login.ok) fail("SUBMIT_LOGIN", `login failed: HTTP ${login.status}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const session = (await (await siteHttp(origin, cookie, "/api/auth/get-session")).json()) as { user?: { role?: string } } | null;
  return { cookie, role: session?.user?.role };
}
