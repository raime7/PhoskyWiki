// 站点目录只读端点：游客可读，见 lib/site-catalog.ts。书籍流水线 export-site 用它生成 site-terms.json。

import { getSiteCatalog } from "@/lib/site-catalog";

export async function GET() {
  return Response.json(await getSiteCatalog(), { headers: { "Cache-Control": "no-store" } });
}
