import { parseInterestRequestBody } from "@/lib/interest-tags";
import { getTermDiscovery } from "@/lib/term-discovery";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** 匿名、只读：每次请求显式携带兴趣，不读取或写入任何游客档案。 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rawId = (await params).id;
  const id = Number(rawId);
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647) {
    return Response.json({ error: "词条 id 无效" }, { status: 400, headers });
  }
  let body: unknown;
  try {
    body = JSON.parse(new URL(req.url).searchParams.get("interests") ?? "{}");
  } catch {
    return Response.json({ error: "兴趣必须是 JSON" }, { status: 400, headers });
  }
  const parsed = parseInterestRequestBody(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400, headers });
  const data = await getTermDiscovery(id, parsed.set);
  return data ? Response.json(data, { headers })
    : Response.json({ error: "词条不存在" }, { status: 404, headers });
}
