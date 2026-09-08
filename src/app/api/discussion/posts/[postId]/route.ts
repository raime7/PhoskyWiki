// 版务软删讨论楼层（T13）：管理员专属（requireAdminUser：未登录 401、非管理员 403）。
// 幂等：重复删除已删楼层仍 204；楼层不存在 404。

import { requireAdminUser } from "@/lib/admin-auth";
import { softDeleteDiscussionPost } from "@/lib/discussion";

interface PostRouteContext {
  params: Promise<{ postId: string }>;
}

export async function DELETE(req: Request, ctx: PostRouteContext) {
  const actor = await requireAdminUser(req);
  if (actor instanceof Response) return actor;

  const postId = Number((await ctx.params).postId);
  if (!Number.isSafeInteger(postId) || postId <= 0) {
    return Response.json({ error: "非法的楼层 id" }, { status: 400 });
  }
  const deleted = await softDeleteDiscussionPost(postId, actor.user);
  return deleted
    ? new Response(null, { status: 204 })
    : Response.json({ error: "楼层不存在" }, { status: 404 });
}
