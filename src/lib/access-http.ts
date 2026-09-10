import { AccessError } from "@/lib/access-grants";
import { accessRetryAfter } from "@/lib/access-rate-limit";

export function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
export async function accessExchange(req: Request, action: (body: Record<string, unknown>) => Promise<Response>) {
  const retryAfter = accessRetryAfter(req);
  if (retryAfter) {
    const response = privateJson({ error: "请求过于频繁，请稍后重试" }, 429);
    response.headers.set("Retry-After", String(retryAfter));
    return response;
  }
  return accessRequest(req, action);
}
export async function accessRequest(req: Request, action: (body: Record<string, unknown>) => Promise<Response>) {
  // Exact same-origin JSON requests only, including in test/development.
  const origin = process.env.NODE_ENV === "production" ? new URL(process.env.BETTER_AUTH_URL!).origin : new URL(req.url).origin;
  if (req.headers.get("origin") !== origin) return privateJson({ error: "请求来源不受信任" }, 403);
  if (!req.headers.get("content-type")?.split(";")[0].trim().match(/^application\/json$/i)) return privateJson({ error: "需要 JSON 请求" }, 415);
  try {
    const text = await req.text();
    if (text.length > 8192) return privateJson({ error: "请求过大" }, 413);
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AccessError("请求格式错误");
    return await action(body as Record<string, unknown>);
  } catch (error) {
    if (error instanceof AccessError) return privateJson({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return privateJson({ error: "请求格式错误" }, 400);
    // Database errors contain parameters. Never log them or send them to clients.
    return privateJson({ error: "操作暂时失败，请重试或联系管理员" }, 503);
  }
}
