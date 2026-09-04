"use client";

// 注册表单（T05）：better-auth signUp.email，成功即自动登录（autoSignIn 默认开启）。

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

export function RegisterForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const { data, error } = await authClient.signUp.email({
      name: String(form.get("name") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });
    if (error || !data) {
      setError(authErrorMessage(error));
      setPending(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <label className="flex flex-col gap-2 text-sm font-medium">
        名称
        <Input name="name" type="text" required autoComplete="name" placeholder="站内展示的编者名称" />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        邮箱
        <Input name="email" type="email" required autoComplete="email" />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        密码（至少 8 位）
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      {error && (
        <p data-testid="form-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "注册中…" : "注册并登录"}
      </Button>
    </form>
  );
}
