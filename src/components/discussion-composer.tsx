"use client";

// 讨论区发言框（T13）：编者开楼，可带视角锚点（视角页「就这个视角发起讨论」跳转
// 过来时由服务端预填）。锁定与游客态不渲染本组件（服务端决定），组件自身不再判权。

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export interface ComposerAnchor {
  pageId: number;
  title: string;
  href: string;
}

export function DiscussionComposer({
  termId,
  anchor,
  maxLength,
}: {
  termId: number;
  anchor: ComposerAnchor | null;
  maxLength: number;
}) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    const res = await fetch("/api/discussion/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        termId,
        perspectiveId: anchor?.pageId,
        content,
      }),
    });
    if (res.ok) {
      setContent("");
      router.refresh();
      setPending(false);
      return;
    }
    try {
      setError(((await res.json()) as { error?: string }).error ?? "发言失败");
    } catch {
      setError("发言失败");
    }
    setPending(false);
  }

  return (
    <form
      id="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="rounded-lg border border-border bg-card px-4 py-3"
    >
      {anchor && (
        <p className="mb-2 text-xs text-muted-foreground">
          视角锚点：
          <Link
            href={anchor.href}
            className="text-foreground underline-offset-4 hover:underline"
          >
            {anchor.title}
          </Link>
          <span className="ml-1">（本楼将围绕该视角展开）</span>
        </p>
      )}
      <label htmlFor="discussion-content" className="sr-only">
        发言内容
      </label>
      <textarea
        id="discussion-content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        maxLength={maxLength}
        rows={4}
        placeholder="发言即时可见（纯文本）。页面内容的修改仍走两票审核。"
        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
      />
      <div className="mt-2 flex min-h-6 items-center justify-between gap-3">
        {error ? (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {content.length}/{maxLength} 字
          </span>
        )}
        <Button type="submit" disabled={pending || content.trim().length === 0}>
          {pending ? "发送中…" : "发言"}
        </Button>
      </div>
    </form>
  );
}
