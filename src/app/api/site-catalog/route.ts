// 站点目录只读端点：游客可读，见 lib/site-catalog.ts。书籍流水线 export-site 用它生成 site-terms.json。
// 编者以上登录时多给 deletedTermTitles（软删除词条的标题），游客响应不变。

import { auth } from "@/lib/auth";
import { getSiteCatalog } from "@/lib/site-catalog";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  // 全部登录角色（editor / trusted / admin / superadmin）都在编者以上
  const catalog = await getSiteCatalog({ includeDeletedTermTitles: Boolean(session?.user) });
  return Response.json(catalog, { headers: { "Cache-Control": "no-store" } });
}
