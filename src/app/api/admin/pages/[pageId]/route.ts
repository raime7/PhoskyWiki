import { requireAdminUser } from "@/lib/admin-auth";
import { historyId, rollbackPage, setPageDeleted } from "@/lib/history";
import { ReviewError, reviewErrorResponse } from "@/lib/review";

export async function POST(req: Request, ctx: { params: Promise<{ pageId: string }> }) {
  const actor = await requireAdminUser(req);
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  try {
    const pageId = historyId((await ctx.params).pageId);
    if (typeof body !== "object" || body === null || !("action" in body)) {
      throw new ReviewError(400, "缺少页面操作");
    }
    if (body.action === "rollback") {
      const revisionId = historyId("revisionId" in body ? body.revisionId : undefined);
      return Response.json(await rollbackPage(pageId, revisionId, actor.user));
    }
    if (body.action === "delete" || body.action === "restore") {
      return Response.json(await setPageDeleted(pageId, body.action === "delete", actor.user));
    }
    throw new ReviewError(400, "未知的页面操作");
  } catch (error) {
    const response = reviewErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
