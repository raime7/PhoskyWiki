import { auth } from "@/lib/auth";
import { markNotificationRead } from "@/lib/notifications";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "查看通知需要登录" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
    return Response.json({ error: "非法的通知 id" }, { status: 400 });
  }
  if (!(await markNotificationRead(session.user.id, id))) {
    return Response.json({ error: "通知不存在" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
