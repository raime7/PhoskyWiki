// 词条局部图谱只读端点（T11）：?termId=<词条 id>&hops=1|2（默认 1 跳）。
// 词条不存在/已软删除 404；参数非法 400。游客可读。

import { getLocalGraph } from "@/lib/graph";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;

  const termId = Number(params.get("termId"));
  if (!Number.isSafeInteger(termId) || termId <= 0) {
    return Response.json({ error: "termId 必须是正整数" }, { status: 400 });
  }

  const hopsParam = params.get("hops") ?? "1";
  if (hopsParam !== "1" && hopsParam !== "2") {
    return Response.json({ error: "hops 只接受 1 或 2" }, { status: 400 });
  }
  const hops: 1 | 2 = hopsParam === "2" ? 2 : 1;

  const data = await getLocalGraph(termId, hops);
  if (!data) {
    return Response.json({ error: "词条不存在或已删除" }, { status: 404 });
  }
  return Response.json(data, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}
