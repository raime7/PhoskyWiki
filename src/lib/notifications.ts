import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { notifications, submissions } from "@/db/schema";

/** 通知内容取自终态提交，保留驳回理由原文；读取列表不改变已读状态。 */
export async function getNotificationInbox(userId: string) {
  const rows = await getDb()
    .select({
      submissionId: notifications.submissionId,
      status: submissions.status,
      rejectionReason: submissions.rejectionReason,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .innerJoin(submissions, eq(submissions.id, notifications.submissionId))
    .where(eq(submissions.submittedBy, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.submissionId));
  return {
    notifications: rows,
    unreadCount: rows.filter((row) => row.readAt === null).length,
  };
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(notifications)
    .innerJoin(submissions, eq(submissions.id, notifications.submissionId))
    .where(and(eq(submissions.submittedBy, userId), isNull(notifications.readAt)));
  return row.count;
}

/** 所有权条件和更新在同一条语句中执行；重复标记保留首次已读时间。 */
export async function markNotificationRead(userId: string, submissionId: number): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(
      eq(notifications.submissionId, submissionId),
      inArray(notifications.submissionId,
        db.select({ id: submissions.id }).from(submissions).where(eq(submissions.submittedBy, userId))),
    ))
    .returning({ id: notifications.submissionId });
  return Boolean(row);
}
