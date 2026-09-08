"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function PageAction({ pageId, action, revisionId }: {
  pageId: number;
  action: "rollback" | "delete" | "restore";
  revisionId?: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // GET comparison navigation returns SSR buttons before their click handlers attach.
  const ready = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
  const label = action === "rollback" ? `回滚到修订 #${revisionId}` : action === "delete" ? "软删除页面" : "恢复页面";
  async function apply() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/pages/${pageId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, revisionId }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "页面操作失败");
      }
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "页面操作失败，请重试");
    } finally {
      setPending(false);
    }
  }
  return <span className="inline-flex flex-col items-start gap-1">
    <Button type="button" variant="outline" size="sm" disabled={!ready || pending} onClick={apply}>{pending ? "处理中…" : label}</Button>
    {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
  </span>;
}
