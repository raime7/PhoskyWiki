// PROTOTYPE（构成主义视觉原型，一次性代码）：在同一路由上切换"现状 / 书卷 / 居中 / 海报"四档构成强度。
// 决策记录见本分支提交说明；定稿后只把胜出方向重写进正式代码，本文件与切换条一并删除。
import "server-only";

import { cookies } from "next/headers";

import { PROTO_COOKIE, PROTO_VARIANTS, type ProtoVariant } from "@/components/prototype/variants";

export async function getProtoVariant(param?: string | string[]): Promise<ProtoVariant> {
  if (process.env.NODE_ENV === "production") return "current";
  const fromParam = typeof param === "string" ? param : undefined;
  const candidate = fromParam ?? (await cookies()).get(PROTO_COOKIE)?.value;
  return PROTO_VARIANTS.some(v => v.key === candidate) ? candidate as ProtoVariant : "current";
}
