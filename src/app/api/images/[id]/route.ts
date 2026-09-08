import { auth } from "@/lib/auth";
import type { UserRole } from "@/db/schema";
import { completeImageUpload, imageReadUrl, imageErrorResponse } from "@/lib/images";

type Context = { params: Promise<{ id: string }> };
export async function POST(req: Request, context: Context) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "上传图片需要登录" }, { status: 401 });
  try {
    return Response.json(await completeImageUpload((await context.params).id, { id: session.user.id, role: session.user.role as UserRole }));
  } catch (error) { return imageErrorResponse(error); }
}
export async function GET(req: Request, context: Context) {
  const session = await auth.api.getSession({ headers: req.headers });
  try {
    const url = await imageReadUrl((await context.params).id, session ? { id: session.user.id, role: session.user.role as UserRole } : null);
    return new Response(null, { status: 307, headers: { Location: url, "Cache-Control": "private, no-store", Vary: "Cookie", "Referrer-Policy": "no-referrer" } });
  } catch (error) { const response = imageErrorResponse(error); response.headers.set("Cache-Control", "private, no-store"); return response; }
}
