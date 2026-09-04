import Link from "next/link";
import type { Metadata } from "next";

import { RegisterForm } from "@/components/register-form";

export const metadata: Metadata = {
  title: "注册",
};

export default function RegisterPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight">注册成为编者</h1>
      <p className="mt-2 mb-8 text-sm leading-relaxed text-muted-foreground">
        注册后可提交词条与视角的编辑，经审核受理后生效。
      </p>
      <RegisterForm />
      <p className="mt-6 text-sm text-muted-foreground">
        已有账号？{" "}
        <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
          登录
        </Link>
      </p>
    </main>
  );
}
