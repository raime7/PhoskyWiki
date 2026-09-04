// 新建词条（T06）：标题 + 一句话简介，提交进审核队列（词条是聚合枢纽，
// 知识内容写在其下的视角页里；骨架模板向导是后续内容生产工单的事）。

import Link from "next/link";

import { SubmissionForm } from "@/components/submission-form";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewTermPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">需要登录才能创建词条</h1>
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

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <span aria-current="page">新建词条</span>
      </nav>

      <h1 className="text-2xl font-bold tracking-tight">新建词条</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        词条是概念名的聚合枢纽页：创建后在各诠释者的视角里写入知识内容。
        {sessionUser.role === "admin"
          ? "管理员提交不经审核，直接生效。"
          : "提交进入审核队列，需管理员受理后生效。"}
      </p>

      <div className="mt-8">
        <SubmissionForm variant="new_term" isAdmin={sessionUser.role === "admin"} />
      </div>
    </main>
  );
}
