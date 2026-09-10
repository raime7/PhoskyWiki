import Link from "next/link";
import type { Metadata } from "next";

import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "登录",
};

/** 登录后的回跳目标：只接受站内相对路径，防开放重定向（"//" 协议相对 URL 也拒）。 */
function safeRedirect(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const redirectTo = safeRedirect((await searchParams).redirect);
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight">登录</h1>
      <p className="mt-2 mb-8 text-sm leading-relaxed text-muted-foreground">
        未登录也可以浏览全站内容；登录后才能提交编辑。
      </p>
      <LoginForm redirectTo={redirectTo} />
      <Link href="/reset-password" className="mt-4 text-sm underline">忘记密码？联系管理员恢复</Link>
      <p className="mt-6 text-sm text-muted-foreground">
        还没有账号？{" "}
        <Link href="/register" className="text-foreground underline-offset-4 hover:underline">
          注册
        </Link>
      </p>
    </main>
  );
}
