"use client";

// 提交表单（T06）：编者用 textarea 把编辑/新建提议送入审核队列。
// 编辑器体验（CodeMirror + 实时预览 + 双链补全）是后续工单，这里刻意保持素 textarea。
// 草稿在客户端 localStorage 自动保存（ADR-0004 #6：服务端只见 pending）；
// 管理员提交不经审核直接生效（ADR-0004 #9）。

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreateSubmissionResult } from "@/lib/review-types";

type Option = {
  id: number;
  label: string;
};

/**
 * 正文字段的本地草稿：与它所基于的页面修订绑定（ADR-0004 #6 草稿在客户端；
 * base 前进后旧草稿不可信——恢复前校验 base 一致，弃用过期草稿）。
 */
interface ContentDraft {
  content: string;
  baseRevisionId: number | null;
}

export type SubmissionFormProps =
  | {
      variant: "edit";
      isAdmin: boolean;
      pageId: number;
      initialContent: string;
      baseRevisionId: number;
    }
  | { variant: "new_term"; isAdmin: boolean }
  | { variant: "new_interpreter"; isAdmin: boolean }
  | {
      variant: "new_perspective";
      isAdmin: boolean;
      terms: Option[];
      interpreters: Option[];
      presetTermId: number | null;
    };

const TEXTAREA_CLASS =
  "flex min-h-80 w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function SubmissionForm(props: SubmissionFormProps) {
  const { variant, isAdmin } = props;
  // 草稿只覆盖正文字段（编辑/新视角）；标题类字段短，不做草稿
  const draftKey =
    variant === "edit"
      ? `phoskywiki:draft:edit:${props.pageId}`
      : variant === "new_perspective"
        ? "phoskywiki:draft:new-perspective"
        : null;

  const [content, setContent] = useState(
    variant === "edit" ? props.initialContent : "",
  );
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [termId, setTermId] = useState(
    variant === "new_perspective" ? (props.presetTermId ?? "") : "",
  );
  const [interpreterId, setInterpreterId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateSubmissionResult | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const initialContent = variant === "edit" ? props.initialContent : null;
  // 草稿基于的修订：编辑 = 表单加载时的 head；新建视角无修订概念，恒 null
  const draftBase = variant === "edit" ? props.baseRevisionId : null;

  // 恢复本地草稿：延后到 hydration 之后（render 期不读 localStorage）；
  // 只在与当前 base 同源时可信，页面已前进则弃用
  useEffect(() => {
    if (!draftKey) return;
    const raw = window.localStorage.getItem(draftKey);
    if (!raw) return;
    let draft: ContentDraft | null = null;
    try {
      draft = JSON.parse(raw) as ContentDraft;
    } catch {
      draft = null;
    }
    if (!draft || typeof draft.content !== "string") return;
    if (draft.baseRevisionId !== draftBase) {
      window.localStorage.removeItem(draftKey);
      return;
    }
    const timer = setTimeout(() => setContent(draft!.content), 0);
    return () => clearTimeout(timer);
  }, [draftKey, draftBase]);

  // 自动保存草稿（防抖 500ms；提交成功后停笔）
  useEffect(() => {
    if (!draftKey || result || content === initialContent) return;
    const timer = setTimeout(() => {
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({ content, baseRevisionId: draftBase } satisfies ContentDraft),
      );
      setDraftSavedAt(new Date().toLocaleTimeString());
    }, 500);
    return () => clearTimeout(timer);
  }, [content, draftKey, draftBase, result, initialContent]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const payload =
      variant === "edit"
        ? {
            kind: "edit",
            pageId: props.pageId,
            content,
            baseRevisionId: props.baseRevisionId,
          }
        : variant === "new_term"
          ? { kind: "new_term", title, summary }
          : variant === "new_interpreter"
            ? { kind: "new_interpreter", title, summary }
            : {
                kind: "new_perspective",
                termId: termId === "" ? undefined : Number(termId),
                interpreterId: interpreterId === "" ? undefined : Number(interpreterId),
                content,
              };
    const res = await fetch("/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as
      | (CreateSubmissionResult & { error?: string })
      | null;
    setPending(false);
    if (!res.ok || !data || (data.outcome !== "pending" && data.outcome !== "direct")) {
      setError(data?.error ?? "提交失败，请稍后再试");
      return;
    }
    if (draftKey) window.localStorage.removeItem(draftKey);
    setResult(data);
  }

  if (result) {
    return (
      <div
        data-testid="submit-success"
        className="rounded-lg border border-border bg-card p-6 text-sm"
      >
        {result.outcome === "pending" ? (
          <>
            <p className="font-medium">已提交，等待审核。</p>
            <p className="mt-2 text-muted-foreground">
              需 {result.quorum} 位管理员受理后生效；可在个人主页查看提交进度与审核结果。
            </p>
            <Link href="/profile" className="mt-2 inline-block text-primary underline-offset-4 hover:underline">
              查看提交历史 →
            </Link>
          </>
        ) : (
          <>
            <p className="font-medium">已直接生效（管理员提交不经审核）。</p>
            <Link
              href={result.href}
              className="mt-2 inline-block text-primary underline-offset-4 hover:underline"
            >
              查看页面 →
            </Link>
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {variant === "new_perspective" && (
        <>
          <label className="flex flex-col gap-2 text-sm font-medium">
            所属词条
            <select
              name="term"
              required
              value={termId}
              onChange={(e) => setTermId(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">选择词条…</option>
              {props.terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            诠释者
            <select
              name="interpreter"
              required
              value={interpreterId}
              onChange={(e) => setInterpreterId(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">选择诠释者…</option>
              {props.interpreters.map((interpreter) => (
                <option key={interpreter.id} value={interpreter.id}>
                  {interpreter.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            视角标题按「诠释者论词条」自动生成（如「德勒兹论主体性」）。
          </p>
        </>
      )}

      {(variant === "new_term" || variant === "new_interpreter") && (
        <label className="flex flex-col gap-2 text-sm font-medium">
          {variant === "new_term" ? "词条标题" : "诠释者名称"}
          <Input
            name="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              variant === "new_term"
                ? "如「物化」；同名多义请用括号限定（如「价值（哲学）」）"
                : "如「卢卡奇」"
            }
          />
        </label>
      )}

      {(variant === "new_term" || variant === "new_interpreter") && (
        <label className="flex flex-col gap-2 text-sm font-medium">
          一句话简介（信息框用）
          <Input
            name="summary"
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="列表页与信息框展示的一句话"
          />
        </label>
      )}

      {(variant === "edit" || variant === "new_perspective") && (
        <label className="flex flex-col gap-2 text-sm font-medium">
          正文（Markdown）
          <textarea
            name="content"
            required
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className={TEXTAREA_CLASS}
            placeholder="支持双链：[[词条名]] 落词条枢纽；[[词条名|视角@诠释者]] 直落具体视角。"
            data-testid="content-textarea"
          />
        </label>
      )}

      {error && (
        <p data-testid="form-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "提交中…" : isAdmin ? "提交（直接生效）" : "提交审核"}
        </Button>
        {draftKey && draftSavedAt && !pending && (
          <span className="text-xs text-muted-foreground">草稿已自动保存 {draftSavedAt}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {isAdmin
          ? "管理员提交不经审核，直接产生修订并重建双链。"
          : "提交进入审核队列，受理后内容才会出现在读路径。草稿自动保存在浏览器本地。"}
      </p>
    </form>
  );
}
