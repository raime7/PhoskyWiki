// 创建提交（T06）：编者把编辑/新建提议送入审核队列；管理员本人提交直接生效。
// 准入：登录（editor/admin 皆可，游客 401）。语义见 ADR-0004 与 lib/review.ts。

import { auth } from "@/lib/auth";
import {
  createSubmission,
  isUniqueViolation,
  ReviewError,
  type SubmissionInput,
} from "@/lib/review";
import type { SubmissionKind, UserRole } from "@/db/schema";

const KINDS: SubmissionKind[] = ["edit", "new_term", "new_perspective", "new_interpreter"];

function parseSubmissionInput(body: Record<string, unknown>): SubmissionInput {
  const kind = body.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind as SubmissionKind)) {
    throw new ReviewError(400, "非法的提交类型");
  }
  const optionalInt = (value: unknown): number | undefined =>
    value === undefined || value === null || value === ""
      ? undefined
      : Number.isSafeInteger(Number(value)) && Number(value) > 0
        ? Number(value)
        : -1; // 走 requiredInt 的报错路径
  return {
    kind: kind as SubmissionKind,
    pageId: optionalInt(body.pageId),
    content: typeof body.content === "string" ? body.content : undefined,
    title: typeof body.title === "string" ? body.title : undefined,
    summary: typeof body.summary === "string" ? body.summary : undefined,
    termId: optionalInt(body.termId),
    interpreterId: optionalInt(body.interpreterId),
    baseRevisionId: optionalInt(body.baseRevisionId),
    supersedes: optionalInt(body.supersedes),
  };
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json({ error: "提交需要登录" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "请求体必须是 JSON 对象" }, { status: 400 });
  }

  try {
    const input = parseSubmissionInput(body as Record<string, unknown>);
    const result = await createSubmission(input, {
      id: session.user.id,
      role: session.user.role as UserRole,
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ReviewError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    // 提交期预检与受理期应用之间被并发抢先（同名词典/同对视角）——唯一索引兜底
    if (isUniqueViolation(err)) {
      return Response.json(
        { error: "提议的目标已存在（可能被其他提交抢先创建），请驳回该提交" },
        { status: 409 },
      );
    }
    throw err;
  }
}
