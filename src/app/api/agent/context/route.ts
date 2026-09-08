import { getAgentContext } from "@/lib/agent/context";

/** 游客可用的只读内容 API，不接收模型配置、密钥或问题。 */
export async function GET(request: Request) {
  const termId = Number(new URL(request.url).searchParams.get("termId"));
  if (!Number.isSafeInteger(termId) || termId <= 0 || termId > 2147483647) {
    return Response.json({ error: "termId 必须是有效的正整数页面 id" }, { status: 400 });
  }
  const context = await getAgentContext(termId);
  if (!context) return Response.json({ error: "词条不存在或已删除" }, { status: 404 });
  return Response.json(context, { headers: { "Cache-Control": "no-store" } });
}
