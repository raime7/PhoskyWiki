// better-auth 的全部认证端点（/api/auth/*）都从这里转发（T05）。

import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
