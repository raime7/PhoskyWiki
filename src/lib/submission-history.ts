import "server-only";

import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb } from "@/db";
import { pages, revisions, submissions, type SubmissionStatus } from "@/db/schema";
import { getLivePage } from "@/lib/content";

const termPage = alias(pages, "submission_term");
const interpreterPage = alias(pages, "submission_interpreter");

function mySubmissions(userId: string, filter?: SQL) {
  return getDb()
    .select({
      id: submissions.id,
      kind: submissions.kind,
      status: submissions.status,
      targetTitle: sql<string>`case
        when ${submissions.kind} = 'edit' then coalesce(${pages.title}, '目标页缺失')
        when ${submissions.kind} = 'new_perspective' then
          coalesce(${interpreterPage.title}, '未知诠释者') || '论' || coalesce(${termPage.title}, '未知词条')
        else coalesce(${submissions.title}, '未命名页面') end`,
      createdAt: submissions.createdAt,
      decidedAt: submissions.decidedAt,
      rejectionReason: submissions.rejectionReason,
    })
    .from(submissions)
    .leftJoin(pages, eq(pages.id, submissions.pageId))
    .leftJoin(termPage, eq(termPage.id, submissions.termId))
    .leftJoin(interpreterPage, eq(interpreterPage.id, submissions.interpreterId))
    .where(and(eq(submissions.submittedBy, userId), filter));
}

export async function listMySubmissions(userId: string, status?: SubmissionStatus) {
  return mySubmissions(userId, status ? eq(submissions.status, status) : undefined)
    .orderBy(desc(submissions.createdAt), desc(submissions.id));
}

/** 历史差异始终基于提交时的修订；受理或后续编辑不会改变 diff 的旧侧。 */
export async function getMySubmission(userId: string, id: number, isAdmin = false) {
  const [item] = await mySubmissions(userId, eq(submissions.id, id)).limit(1);
  if (!item) return null;
  const [proposal] = await getDb()
    .select({
      content: submissions.content,
      title: submissions.title,
      summary: submissions.summary,
      baseRevisionId: submissions.baseRevisionId,
      pageId: submissions.pageId,
      baseContent: revisions.content,
    })
    .from(submissions)
    .leftJoin(revisions, eq(revisions.id, submissions.baseRevisionId))
    .where(and(eq(submissions.id, id), eq(submissions.submittedBy, userId)))
    .limit(1);
  if (!proposal) return null;
  const baseHidden = !isAdmin && proposal.pageId !== null && !(await getLivePage(proposal.pageId));
  return { ...item, ...proposal, baseHidden, baseContent: baseHidden ? null : proposal.baseContent };
}
