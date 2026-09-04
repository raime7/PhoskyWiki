// 审核域的跨端类型（T06）：服务端 lib/review.ts 与客户端表单/操作组件共用。
// 单独成文件是因为 review.ts 带 server-only，客户端组件不能直接引它的类型；
// 收敛在这里避免两端各自声明同一形状后悄悄漂移。

export type ReviewOutcome =
  | { outcome: "pending"; approveCount: number; quorum: number }
  | { outcome: "approved" }
  | { outcome: "rejected"; staleBase: boolean; message: string };

export type CreateSubmissionResult =
  | { outcome: "pending"; submissionId: number; quorum: number }
  | { outcome: "direct"; pageId: number; href: string };
