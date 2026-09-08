// 保存当前用户的兴趣标签（T12）：PUT 全量替换。任何登录角色可写自己的；
// 游客 401——游客的兴趣只存浏览器 localStorage，发现接口仅做匿名只读计算。

import { auth } from "@/lib/auth";
import { saveInterestTags } from "@/lib/interests";
import { parseInterestRequestBody } from "@/lib/interest-tags";

export async function PUT(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json({ error: "保存兴趣需要登录" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const parsed = parseInterestRequestBody(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const saved = await saveInterestTags(session.user.id, parsed.set);
  return Response.json({ interests: saved });
}
