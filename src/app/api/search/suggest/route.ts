// 搜索联想 API（即打即搜）：输入前缀返回小结果集，供搜索框下拉。

import { searchErrorResponse } from "@/lib/search/search-service";
import { suggestPublicPages } from "@/lib/search/public-search";
import { SEARCH_QUERY_MAX_LENGTH } from "@/lib/search/search-types";

const SUGGEST_LIMIT_DEFAULT = 8;
const SUGGEST_LIMIT_MAX = 20;

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams;
  const q = (query.get("q") ?? "").trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
  const limitRaw = Number(query.get("limit"));
  const limit =
    Number.isSafeInteger(limitRaw) && limitRaw > 0
      ? Math.min(SUGGEST_LIMIT_MAX, limitRaw)
      : SUGGEST_LIMIT_DEFAULT;
  if (!q) return Response.json({ suggestions: [] });
  try {
    const suggestions = await suggestPublicPages(q, limit);
    return Response.json({ suggestions });
  } catch (err) {
    return searchErrorResponse("搜索联想失败", err);
  }
}
