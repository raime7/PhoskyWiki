import { requireAdminUser } from "@/lib/admin-auth";
import { AccessError, issueGrant, listGrants, revokeGrant } from "@/lib/access-grants";
import { accessRequest, privateJson } from "@/lib/access-http";
import { getDb } from "@/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: Request) {
  const actor = await requireAdminUser(req);
  if (actor instanceof Response) return privateJson(await actor.json(), actor.status);
  return privateJson({ grants: await listGrants() });
}
export async function POST(req: Request) {
  return accessRequest(req, async body => {
    const actor = await requireAdminUser(req);
    if (actor instanceof Response) return privateJson(await actor.json(), actor.status);
    if (body.action === "revoke") {
      if (typeof body.id !== "string" || body.id.length > 100) throw new AccessError("请选择有效令牌");
      await revokeGrant(body.id);
      return privateJson({ ok: true });
    }
    if (body.action !== "issue" || (body.purpose !== "invitation" && body.purpose !== "reset")) throw new AccessError("请选择邀请或密码恢复");
    let targetUserId = typeof body.targetUserId === "string" ? body.targetUserId : undefined;
    if (body.purpose === "reset" && typeof body.targetEmail === "string") {
      if (body.targetEmail.length > 254) throw new AccessError("请填写目标账号邮箱");
      const [target] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, body.targetEmail.trim().toLowerCase()));
      if (!target) throw new AccessError("找不到目标账号", 404);
      targetUserId = target.id;
    }
    if (body.purpose === "reset" && (!targetUserId || targetUserId.length > 100)) throw new AccessError("请填写目标账号邮箱或 ID");
    return privateJson(await issueGrant(body.purpose, actor.user.id, targetUserId), 201);
  });
}
