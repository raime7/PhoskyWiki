import type { SubmissionKind, SubmissionStatus } from "@/db/schema";

export const kindLabels: Record<SubmissionKind, string> = {
  edit: "编辑视角",
  new_term: "新建词条",
  new_perspective: "新建视角",
  new_interpreter: "新建诠释者",
};

export const statusLabels: Record<SubmissionStatus, string> = {
  pending: "待审核",
  approved: "已受理",
  rejected: "已驳回",
};

// 站内统一的时间戳格式化（lib/format）；在此转出口保持既有相对导入不变
export { formatWhen } from "@/lib/format";

export function RejectionReason({ reason }: { reason: string | null }) {
  if (reason === null) return null;

  return (
    <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
      <p className="font-medium">驳回理由</p>
      <p className="mt-1 whitespace-pre-wrap break-words">{reason}</p>
    </div>
  );
}
