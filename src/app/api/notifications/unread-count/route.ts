import { auth } from "@/lib/auth";
import { getUnreadNotificationCount } from "@/lib/notifications";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "查看通知需要登录" }, { status: 401 });
  return Response.json(
    { unreadCount: await getUnreadNotificationCount(session.user.id) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
