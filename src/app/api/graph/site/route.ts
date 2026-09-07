// 全站图谱只读端点（T11）：links 聚合的节点/边/学派图例，游客可读。
// 纯派生数据（ADR-0001：PG 唯一内容存储），允许短缓存。

import { getSiteGraph } from "@/lib/graph";

export async function GET() {
  const data = await getSiteGraph();
  return Response.json(data, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}
