"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PasswordResetForm() {
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await fetch("/api/access/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: String(form.get("token") ?? "").trim() || window.location.hash.slice(1), password: form.get("password") }), cache: "no-store" });
      if (!result.ok) { setMessage((await result.json()).error); return; }
      window.history.replaceState(null, "", window.location.pathname);
      setDone(true); setMessage("密码已重设，旧会话已失效。请重新登录。");
    } catch { setMessage("网络连接失败，请重试"); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="flex flex-col gap-5">
    <p>忘记密码请联系管理员核实身份，取得一次性恢复链接。此过程不代表邮箱已验证。</p>
    {!done && <>
      <label>恢复码<Input name="token" type="password" autoComplete="off" /></label>
      <label>新密码（8–128 位）<Input name="password" type="password" minLength={8} maxLength={128} required autoComplete="new-password" /></label>
      <Button disabled={pending}>{pending ? "处理中…" : "重设密码"}</Button>
    </>}
    {message && <p role="status">{message}</p>}
    <Link href="/login">返回登录</Link>
  </form>;
}
