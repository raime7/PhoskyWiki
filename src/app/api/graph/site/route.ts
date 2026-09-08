// 全站图谱只读端点（T11）：links 聚合的节点/边/学派图例，游客可读。
// 每次请求读取当前关系，删除/恢复和存量校对后不复用旧图谱。

import { getSiteGraph } from "@/lib/graph";

export async function GET() {
  const data = await getSiteGraph();
  return Response.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}
