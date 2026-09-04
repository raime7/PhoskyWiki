// better-auth 浏览器客户端（T05）。服务端 additionalFields（user.role）的类型
// 经 inferAdditionalFields 插件流入客户端——仅类型导入，不把服务端代码带进包。

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

import type { auth } from "@/lib/auth";

export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>()],
});
