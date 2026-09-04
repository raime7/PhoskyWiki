// 管理员审核动作（T06）：POST /api/admin/submissions/:id/review
// body = { action: "approve" } 或 { action: "reject", reason: "…"（必填）}。
// 准入走 requireAdminUser（需要具体管理员 id 做投票去重），状态机转移见 lib/review.ts。

import { requireAdminUser } from "@/lib/admin-auth";
import { isUniqueViolation, reviewSubmission, ReviewError } from "@/lib/review";

interface ReviewRouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: ReviewRouteContext) {
  const admission = await requireAdminUser(req);
  if (admission instanceof Response) return admission;

  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return Response.json({ error: "非法的提交 id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const action = (body as { action?: unknown } | null)?.action;
  if (action !== "approve" && action !== "reject") {
    return Response.json({ error: "action 必须是 approve 或 reject" }, { status: 400 });
  }
  const reason =
    typeof (body as { reason?: unknown }).reason === "string"
      ? (body as { reason: string }).reason
      : undefined;

  try {
    const outcome = await reviewSubmission(id, admission.user, action, reason);
    return Response.json(outcome);
  } catch (err) {
    if (err instanceof ReviewError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    if (isUniqueViolation(err)) {
      return Response.json(
        { error: "提议的目标已存在（可能被其他提交抢先创建），请驳回该提交" },
        { status: 409 },
      );
    }
    throw err;
  }
}
