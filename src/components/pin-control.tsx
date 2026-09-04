"use client";

// 管理员的置顶开关（T04 置顶 × T05 角色）：直调置顶 API，
// 成功后 router.refresh() 让服务端重排视角列表。仅管理员视角列表渲染本控件。

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PinControl({ pageId, pinned }: { pageId: number; pinned: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/admin/perspectives/${pageId}/pin`, {
      method: pinned ? "DELETE" : "POST",
    });
    if (res.ok) {
      router.refresh();
      setPending(false);
      return;
    }
    try {
      setError(((await res.json()) as { error?: string }).error ?? "操作失败");
    } catch {
      setError("操作失败");
    }
    setPending(false);
  }

  return (
    <span className="flex shrink-0 items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        title={pinned ? "取消置顶，回到热度序" : "置顶到通俗视角之后"}
        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
      >
        {pending ? "…" : pinned ? "取消置顶" : "置顶"}
      </button>
    </span>
  );
}
