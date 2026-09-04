// 编辑视角页（T06）：textarea 全量编辑 + 提交进审核队列（管理员直接生效）。
// 编辑器体验（CodeMirror + 预览 + 补全）是后续工单，这里刻意素 textarea。

import Link from "next/link";
import { notFound } from "next/navigation";

import { SubmissionForm } from "@/components/submission-form";
import {
  getHeadContent,
  getHeadRevisionId,
  getLivePage,
  getPerspectiveDetail,
} from "@/lib/content";
import { pageIdFromKey, pagePath } from "@/lib/slug";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pageKey: string }> };

export default async function EditPage({ params }: Params) {
  const id = pageIdFromKey((await params).pageKey);
  if (!id) notFound();
  const page = await getLivePage(id);
  // 一期编辑对象只有视角页：词条的正文在其通俗视角里（见 lib/review.ts 校验）
  if (!page || page.type !== "perspective") notFound();

  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">需要登录才能编辑</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          编辑以「提交」的形式进入审核队列；注册成为编者即可参与共建。
        </p>
        <div className="mt-6 flex gap-3 text-sm">
          <Link
            href="/login"
            className="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
          >
            登录
          </Link>
          <Link
            href="/register"
            className="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
          >
            注册
          </Link>
        </div>
      </main>
    );
  }

  const detail = await getPerspectiveDetail(id);
  if (!detail) notFound();
  const [content, baseRevisionId] = await Promise.all([
    getHeadContent(id),
    getHeadRevisionId(id),
  ]);
  // base 修订是并发防护的锚点（ADR-0004 #2），缺失即不可编辑
  if (content === null || baseRevisionId === null) notFound();

  const termHref = pagePath("term", detail.termSlug, detail.termId);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={termHref} className="hover:text-foreground">
          {detail.termTitle}
        </Link>
        <span className="mx-1.5">/</span>
        <span aria-current="page">编辑 {detail.title}</span>
      </nav>

      <h1 className="text-2xl font-bold tracking-tight">编辑：{detail.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {sessionUser.role === "admin"
          ? "管理员提交不经审核，直接产生修订并重建双链。"
          : "提交进入审核队列，需管理员受理后生效。"}
      </p>

      <div className="mt-8">
        <SubmissionForm
          variant="edit"
          isAdmin={sessionUser.role === "admin"}
          pageId={id}
          initialContent={content}
          baseRevisionId={baseRevisionId}
        />
      </div>
    </main>
  );
}
