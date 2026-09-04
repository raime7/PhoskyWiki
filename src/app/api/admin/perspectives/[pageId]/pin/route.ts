// 管理员置顶/取消置顶视角（T04）：POST = 置顶，DELETE = 取消，幂等。
// 准入见 requireAdmin（T05 会话角色：登录且 admin）。

import { requireAdmin } from "@/lib/admin-auth";
import { setPerspectivePinned } from "@/lib/pinning";

interface PinRouteContext {
  params: Promise<{ pageId: string }>;
}

async function handle(req: Request, ctx: PinRouteContext, pinned: boolean) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const pageId = Number((await ctx.params).pageId);
  if (!Number.isSafeInteger(pageId) || pageId <= 0) {
    return Response.json({ error: "非法的视角页 id" }, { status: 400 });
  }
  const updated = await setPerspectivePinned(pageId, pinned);
  return updated
    ? new Response(null, { status: 204 })
    : Response.json({ error: "视角页不存在" }, { status: 404 });
}

export async function POST(req: Request, ctx: PinRouteContext) {
  return handle(req, ctx, true);
}

export async function DELETE(req: Request, ctx: PinRouteContext) {
  return handle(req, ctx, false);
}
