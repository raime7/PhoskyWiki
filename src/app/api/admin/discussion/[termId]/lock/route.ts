// 版务锁定/解锁词条讨论区（T13）：POST = 锁定，DELETE = 解锁，幂等。
// 准入见 requireAdminUser（T05 会话角色：登录且 admin）；锁定人记录在
// term_discussions.locked_by。锁定后任何角色不能发言。

import { requireAdminUser } from "@/lib/admin-auth";
import { setDiscussionLocked } from "@/lib/discussion";

interface LockRouteContext {
  params: Promise<{ termId: string }>;
}

async function handle(req: Request, ctx: LockRouteContext, locked: boolean) {
  const actor = await requireAdminUser(req);
  if (actor instanceof Response) return actor;

  const termId = Number((await ctx.params).termId);
  if (!Number.isSafeInteger(termId) || termId <= 0) {
    return Response.json({ error: "非法的词条 id" }, { status: 400 });
  }
  const updated = await setDiscussionLocked(termId, locked, actor.user);
  return updated
    ? new Response(null, { status: 204 })
    : Response.json({ error: "词条不存在" }, { status: 404 });
}

export async function POST(req: Request, ctx: LockRouteContext) {
  return handle(req, ctx, true);
}

export async function DELETE(req: Request, ctx: LockRouteContext) {
  return handle(req, ctx, false);
}
