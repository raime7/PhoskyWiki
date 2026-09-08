"use client";

// 楼层的一层嵌套回复框（T13）：点「回复」展开，提交后 router.refresh() 重排楼层树。

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function DiscussionReplyForm({
  termId,
  parentId,
}: {
  termId: number;
  parentId: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    const res = await fetch("/api/discussion/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ termId, parentId, content }),
    });
    if (res.ok) {
      setContent("");
      setOpen(false);
      router.refresh();
      setPending(false);
      return;
    }
    try {
      setError(((await res.json()) as { error?: string }).error ?? "回复失败");
    } catch {
      setError("回复失败");
    }
    setPending(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        回复
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="mt-2 flex flex-col gap-2"
    >
      <label htmlFor={`reply-${parentId}`} className="sr-only">
        回复内容
      </label>
      <textarea
        id={`reply-${parentId}`}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={3}
        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
      />
      <div className="flex items-center justify-between">
        {error ? (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            disabled={pending}
          >
            收起
          </Button>
          <Button type="submit" size="sm" disabled={pending || content.trim().length === 0}>
            {pending ? "发送中…" : "回复"}
          </Button>
        </span>
      </div>
    </form>
  );
}
