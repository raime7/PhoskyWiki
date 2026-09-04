import Link from "next/link";
import type { Metadata } from "next";

import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "登录",
};

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight">登录</h1>
      <p className="mt-2 mb-8 text-sm leading-relaxed text-muted-foreground">
        未登录也可以浏览全站内容；登录后才能提交编辑。
      </p>
      <LoginForm />
      <p className="mt-6 text-sm text-muted-foreground">
        还没有账号？{" "}
        <Link href="/register" className="text-foreground underline-offset-4 hover:underline">
          注册
        </Link>
      </p>
    </main>
  );
}
