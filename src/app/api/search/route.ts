// 全站搜索 API（T10/ADR-0002）：游客可搜，结果来自 SearchIndex 端口的当前实现。
// 服务不可用转 503（索引是派生数据，报错如实但不拖垮站点其余部分）。

import { getSearchIndex, searchErrorResponse } from "@/lib/search/search-service";
import { parseSearchParams } from "@/lib/search/search-types";

export async function GET(req: Request) {
  const parsed = parseSearchParams(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.q) {
    return Response.json({ hits: [], total: 0, facets: {} });
  }
  try {
    const result = await getSearchIndex().search(parsed.q, {
      type: parsed.type,
      limit: parsed.limit,
      offset: parsed.offset,
    });
    return Response.json(result);
  } catch (err) {
    return searchErrorResponse("全站搜索失败", err);
  }
}
