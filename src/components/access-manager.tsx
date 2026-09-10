"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Grant = { id: string; purpose: "invitation" | "reset"; targetUserId: string | null; expiresAt: string; consumedAt: string | null; revokedAt: string | null };
async function fetchGrants(): Promise<Grant[]> {
  const response = await fetch("/api/admin/access", { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取令牌记录");
  return (await response.json()).grants;
}
export function AccessManager() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  async function refresh() {
    setGrants(await fetchGrants());
    setLoadedAt(Date.now());
  }
  useEffect(() => {
    let active = true;
    fetchGrants().then(grants => {
      if (active) { setGrants(grants); setLoadedAt(Date.now()); }
    }).catch(() => { if (active) setMessage("无法读取令牌记录"); });
    return () => { active = false; };
  }, []);
  async function act(body: Record<string, unknown>) {
    setPending(true); setMessage(""); setLink("");
    try {
      const response = await fetch("/api/admin/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) { setMessage(data.error); return; }
      if (data.token) setLink(`${window.location.origin}/${body.purpose === "invitation" ? "register" : "reset-password"}#${data.token}`);
      setMessage(body.action === "revoke" ? "已撤销" : "链接仅显示这一次，请私下交付。不会自动发送邮件。");
      await refresh();
    } catch { setMessage("操作失败，请刷新记录后重试"); }
    finally { setPending(false); }
  }
  function recover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void act({ action: "issue", purpose: "reset", targetEmail: new FormData(event.currentTarget).get("targetEmail") });
  }
  return <div className="flex flex-col gap-6">
    <Button disabled={pending} onClick={() => act({ action: "issue", purpose: "invitation" })}>签发编者邀请</Button>
    <form onSubmit={recover} className="flex flex-col gap-3">
      <p>恢复前，通过既有可信渠道人工核实账号本人，并核对目标账号邮箱。这不等同于验证邮箱。</p>
      <label>目标账号邮箱<Input name="targetEmail" type="email" required /></label>
      <label><input type="checkbox" required /> 已核实目标账号本人身份</label>
      <Button disabled={pending}>签发密码恢复</Button>
    </form>
    {message && <p role="status">{message}</p>}
    {link && <label>一次性链接<Input readOnly value={link} autoComplete="off" onFocus={event => event.target.select()} /></label>}
    <h2 className="text-xl font-semibold">最近 100 条签发记录</h2>
    <ul className="divide-y">{grants.map(grant => <li key={grant.id} className="break-all py-3" data-testid="grant-record">
      <p>{grant.purpose === "invitation" ? "编者邀请" : "密码恢复"} · {grant.id}</p>
      {grant.targetUserId && <p>目标账号：{grant.targetUserId}</p>}
      <p>有效至 {new Date(grant.expiresAt).toLocaleString()} · {grant.revokedAt ? "已撤销" : grant.consumedAt ? "已使用" : new Date(grant.expiresAt).getTime() <= loadedAt ? "已过期" : "待使用"}</p>
      {!grant.revokedAt && !grant.consumedAt && <Button disabled={pending} onClick={() => act({ action: "revoke", id: grant.id })}>撤销</Button>}
    </li>)}</ul>
  </div>;
}
