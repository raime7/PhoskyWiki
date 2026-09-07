// 全量校对搜索索引（T10 验收：可手动触发，修复漂移）。管理员专用；
// 定时触发走 scripts/reindex-search.ts（cron 直接调库，无需 HTTP 凭据）。

import { requireAdminUser } from "@/lib/admin-auth";
import { reindexAll } from "@/lib/search/search-sync";
import { searchErrorResponse } from "@/lib/search/search-service";

export async function POST(req: Request) {
  const admission = await requireAdminUser(req);
  if (admission instanceof Response) return admission;
  try {
    return Response.json(await reindexAll());
  } catch (err) {
    return searchErrorResponse("搜索索引全量校对失败", err);
  }
}
