import { auth } from "@/lib/auth";
import type { UserRole } from "@/db/schema";
import { beginImageUpload, imageErrorResponse } from "@/lib/images";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "上传图片需要登录" }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }
  try {
    return Response.json(await beginImageUpload(body, { id: session.user.id, role: session.user.role as UserRole }), { status: 201 });
  } catch (error) { return imageErrorResponse(error); }
}
