// 发表讨论楼层/回复（T13）：编者与管理员都可发言，游客 401（只读）。
// 语义（一层嵌套、视角锚点、锁定）见 lib/discussion.ts 的 createDiscussionPost。

import { auth } from "@/lib/auth";
import type { UserRole } from "@/db/schema";
import {
  createDiscussionPost,
  DiscussionError,
  discussionErrorResponse,
} from "@/lib/discussion";

function parseId(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new DiscussionError(400, `${field} 必须是正整数`);
  }
  return n;
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json({ error: "发言需要登录" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "请求体必须是 JSON 对象" }, { status: 400 });
  }

  try {
    const raw = body as Record<string, unknown>;
    const termId = parseId(raw.termId, "termId");
    if (termId === undefined) {
      throw new DiscussionError(400, "termId 必须是正整数");
    }
    const result = await createDiscussionPost(
      {
        termId,
        perspectiveId: parseId(raw.perspectiveId, "perspectiveId"),
        parentId: parseId(raw.parentId, "parentId"),
        content: typeof raw.content === "string" ? raw.content : "",
      },
      { id: session.user.id, role: session.user.role as UserRole },
    );
    return Response.json(result, { status: 201 });
  } catch (err) {
    const mapped = discussionErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
