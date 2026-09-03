import { sql } from "drizzle-orm";

import { getDb } from "@/db";

// 探活路由必须每次实时查询，不能被构建期静态化
export const dynamic = "force-dynamic";

export async function GET() {
  let postgres: "up" | "down" = "down";
  try {
    await getDb().execute(sql`select 1`);
    postgres = "up";
  } catch {
    // 连不上就保持 down，让状态码与响应体如实报告
  }

  return Response.json(
    {
      status: postgres === "up" ? "ok" : "error",
      checks: { postgres },
    },
    { status: postgres === "up" ? 200 : 503 },
  );
}
