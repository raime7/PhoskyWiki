"use client";

// 审核队列的受理/驳回操作（T06）：驳回必填理由；受理票数凑满 quorum 才生效。
// 结果消息区分「记票未生效」「已受理生效」「base 过期自动驳回」三种。

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { ReviewOutcome } from "@/lib/review-types";

export function ReviewActions({ submissionId }: { submissionId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  async function post(action: "approve" | "reject", reason?: string) {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/admin/submissions/${submissionId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    const data = (await res.json().catch(() => null)) as
      | (ReviewOutcome & { error?: string })
      | null;
    setPending(false);
    if (!res.ok || !data || !("outcome" in data)) {
      setError(data?.error ?? "操作失败，请稍后再试");
      return;
    }
    if (data.outcome === "pending") {
      setMessage(`已记录批准票（${data.approveCount}/${data.quorum}），等待下一位管理员。`);
      router.refresh();
    } else if (data.outcome === "approved") {
      setMessage("已受理并生效。");
      router.refresh();
    } else {
      setMessage(
        data.staleBase
          ? `base 修订过期，已自动驳回——提交者会看到提示：${data.message}`
          : "已驳回。",
      );
      router.refresh();
    }
  }

  if (message) {
    return (
      <p data-testid="review-result" className="text-sm text-muted-foreground" role="status">
        {message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button disabled={pending} onClick={() => post("approve")}>
          {pending ? "处理中…" : "受理"}
        </Button>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() => setRejecting((value) => !value)}
        >
          驳回…
        </Button>
        {error && (
          <p data-testid="review-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      {rejecting && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <label className="text-sm font-medium">
            驳回理由（必填，提交者可见）
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-2 flex min-h-20 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder="说明哪里需要修改，便于提交者修改后重新提交"
            />
          </label>
          <div>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length === 0}
              onClick={() => post("reject", reason)}
            >
              确认驳回
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
