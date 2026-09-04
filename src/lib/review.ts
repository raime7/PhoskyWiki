// 审核域写路径（T06）：提交状态机 + 两票受理 + 修订快照 + links 重建。
// 语义按 ADR-0004：
//   - submissions 存全量提议内容 + base_revision_id（不存 diff，队列页 diff 现算）；
//   - pending → approved/rejected 均终态；任一驳回即 rejected；修改重提 = 新建提交；
//   - quorum = min(2, 提交创建时管理员数)，其后管理员人数变化不追溯；
//   - 受理时页面 head ≠ base → 该票无法通过，自动驳回并提示基于新版重新提交；
//   - 管理员本人提交跳过排队与投票，与受理路径共用「产生修订 → 重建 links」管线
//     （搜索索引同步随 T10 的 SearchIndex 接口挂进同一管线）。

import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb, type Db } from "@/db";
import {
  interpreters,
  links,
  pages,
  perspectives,
  revisions,
  submissionVotes,
  submissions,
  terms,
  user,
} from "@/db/schema";
import type {
  PageType,
  SubmissionKind,
  SubmissionStatus,
  UserRole,
} from "@/db/schema";
import { pagePath, slugify as slugifyTitle } from "@/lib/slug";
import { parseWikiLinks, wikiLinkKey, type ParsedWikiLink } from "@/lib/wiki-links";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

/** 操作者（来自会话）：足够驱动审核域的最小字段。 */
export interface Actor {
  id: string;
  role: UserRole;
}

/** 审核域的业务错误：status 直接作为 HTTP 状态码。 */
export class ReviewError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 应用层唯一索引冲突（并发抢先创建等）的识别，路由据此转 409。 */
export function isUniqueViolation(err: unknown): boolean {
  const candidates = [err, (err as { cause?: unknown })?.cause];
  return candidates.some((candidate) =>
    (candidate as { code?: string } | undefined)?.code?.startsWith("23505"),
  );
}

// ---------------------------------------------------------------------------
// 创建提交
// ---------------------------------------------------------------------------

export interface SubmissionInput {
  kind: SubmissionKind;
  /** kind=edit：编辑目标页 */
  pageId?: number;
  /** kind=edit/new_perspective：提议正文（Markdown 源文本） */
  content?: string;
  /** kind=new_term/new_interpreter：新建页标题 */
  title?: string;
  /** kind=new_term/new_interpreter：一句话简介 */
  summary?: string;
  /** kind=new_perspective：挂载的词条与诠释者 */
  termId?: number;
  interpreterId?: number;
  /** kind=edit：编辑起点的页面 head 修订（ADR-0004 #2） */
  baseRevisionId?: number;
  /** 修改重提的谱系：被驳回的前任提交 id（ADR-0004 #5） */
  supersedes?: number;
}

interface ValidatedSubmission {
  kind: SubmissionKind;
  pageId: number | null;
  content: string;
  title: string | null;
  summary: string | null;
  termId: number | null;
  interpreterId: number | null;
  baseRevisionId: number | null;
  supersedes: number | null;
}

export type CreateSubmissionResult =
  | { outcome: "pending"; submissionId: number; quorum: number }
  | { outcome: "direct"; pageId: number; href: string };

function requiredInt(value: unknown, error: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ReviewError(400, error);
  return n;
}

async function livePageOfType(
  db: DbOrTx,
  id: number,
  type: PageType,
): Promise<boolean> {
  const [row] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.id, id), eq(pages.type, type), isNull(pages.deletedAt)))
    .limit(1);
  return Boolean(row);
}

async function validateSubmissionInput(
  db: Db,
  input: SubmissionInput,
): Promise<ValidatedSubmission> {
  const summary = input.summary?.trim() || null;
  const supersedes =
    input.supersedes === undefined || input.supersedes === null
      ? null
      : requiredInt(input.supersedes, "supersedes 必须是正整数");

  if (supersedes !== null) {
    const [prior] = await db
      .select({ status: submissions.status })
      .from(submissions)
      .where(eq(submissions.id, supersedes))
      .limit(1);
    // 只有被驳回的提交才谈得上「修改重提」（approved 无需重提，pending 未结）
    if (!prior || prior.status !== "rejected") {
      throw new ReviewError(400, "supersedes 必须指向一条已驳回的提交");
    }
  }

  switch (input.kind) {
    case "edit": {
      const pageId = requiredInt(input.pageId, "缺少编辑目标页面");
      const content = (input.content ?? "").trim();
      if (!content) throw new ReviewError(400, "正文不能为空");
      const [page] = await db
        .select({ type: pages.type, deletedAt: pages.deletedAt })
        .from(pages)
        .where(eq(pages.id, pageId))
        .limit(1);
      if (!page) throw new ReviewError(404, "目标页面不存在");
      if (page.deletedAt !== null) throw new ReviewError(404, "目标页面已被删除");
      if (page.type !== "perspective") {
        throw new ReviewError(400, "一期只支持编辑视角页正文（词条的正文在其通俗视角里）");
      }
      const baseRevisionId = requiredInt(input.baseRevisionId, "缺少 base 修订（编辑起点）");
      const [base] = await db
        .select({ id: revisions.id })
        .from(revisions)
        .where(and(eq(revisions.id, baseRevisionId), eq(revisions.pageId, pageId)))
        .limit(1);
      if (!base) throw new ReviewError(400, "base 修订不属于目标页面");
      return {
        kind: "edit",
        pageId,
        content,
        title: null,
        summary: null,
        termId: null,
        interpreterId: null,
        baseRevisionId,
        supersedes,
      };
    }
    case "new_term":
    case "new_interpreter": {
      const title = input.title?.trim() ?? "";
      if (!title) throw new ReviewError(400, "标题不能为空");
      // 撞名检查与唯一性口径：
      //   词条标题有部分唯一索引（软删除仍占标题，ADR-0003 #5）；
      //   诠释者无索引，按在线页面防撞（重名会让显式视角链接的按名解析歧义）。
      const [dup] =
        input.kind === "new_term"
          ? await db
              .select({ id: pages.id })
              .from(pages)
              .where(and(eq(pages.type, "term"), eq(pages.title, title)))
              .limit(1)
          : await db
              .select({ id: pages.id })
              .from(pages)
              .where(
                and(
                  eq(pages.type, "interpreter"),
                  eq(pages.title, title),
                  isNull(pages.deletedAt),
                ),
              )
              .limit(1);
      if (dup) {
        throw new ReviewError(
          400,
          input.kind === "new_term"
            ? "同名词条已存在；同名多义请用括号限定标题（如「价值（哲学）」）"
            : "同名诠释者已存在",
        );
      }
      return {
        kind: input.kind,
        pageId: null,
        content: "",
        title,
        summary,
        termId: null,
        interpreterId: null,
        baseRevisionId: null,
        supersedes,
      };
    }
    case "new_perspective": {
      const termId = requiredInt(input.termId, "缺少目标词条");
      const interpreterId = requiredInt(input.interpreterId, "缺少诠释者");
      const content = (input.content ?? "").trim();
      if (!content) throw new ReviewError(400, "正文不能为空");
      if (!(await livePageOfType(db, termId, "term"))) {
        throw new ReviewError(404, "目标词条不存在");
      }
      if (!(await livePageOfType(db, interpreterId, "interpreter"))) {
        throw new ReviewError(404, "诠释者不存在");
      }
      // （词条 × 诠释者）唯一约束的提交期预检：软删除的视角仍占位（恢复而非重建）
      const [dup] = await db
        .select({ pageId: perspectives.pageId })
        .from(perspectives)
        .where(
          and(
            eq(perspectives.termId, termId),
            eq(perspectives.interpreterId, interpreterId),
          ),
        )
        .limit(1);
      if (dup) throw new ReviewError(400, "该诠释者在此词条下已有视角");
      return {
        kind: "new_perspective",
        pageId: null,
        content,
        title: null,
        summary,
        termId,
        interpreterId,
        baseRevisionId: null,
        supersedes,
      };
    }
    default:
      throw new ReviewError(400, "非法的提交类型");
  }
}

/**
 * 创建提交。管理员本人提交直接生效（ADR-0004 #9：跳过排队与投票，
 * 与受理共用修订管线）；编者提交进入 pending，quorum 在此刻快照。
 */
export async function createSubmission(
  input: SubmissionInput,
  actor: Actor,
): Promise<CreateSubmissionResult> {
  const db = getDb();
  const validated = await validateSubmissionInput(db, input);

  if (actor.role === "admin") {
    const applied = await db.transaction(async (tx) =>
      applySubmission(tx, { ...validated, submittedBy: actor.id }),
    );
    const [page] = await db
      .select({ type: pages.type, slug: pages.slug })
      .from(pages)
      .where(eq(pages.id, applied.pageId))
      .limit(1);
    return {
      outcome: "direct",
      pageId: applied.pageId,
      href: pagePath(page.type, page.slug, applied.pageId),
    };
  }

  const [adminCountRow] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(user)
    .where(eq(user.role, "admin"));
  const quorum = Math.min(2, adminCountRow.count);
  const [row] = await db
    .insert(submissions)
    .values({
      pageId: validated.pageId,
      kind: validated.kind,
      content: validated.content,
      title: validated.title,
      summary: validated.summary,
      termId: validated.termId,
      interpreterId: validated.interpreterId,
      baseRevisionId: validated.baseRevisionId,
      quorum,
      submittedBy: actor.id,
      supersedesId: validated.supersedes,
    })
    .returning({ id: submissions.id });
  return { outcome: "pending", submissionId: row.id, quorum };
}

// ---------------------------------------------------------------------------
// 受理 / 驳回（状态机转移）
// ---------------------------------------------------------------------------

export type ReviewOutcome =
  | { outcome: "pending"; approveCount: number; quorum: number }
  | { outcome: "approved" }
  | { outcome: "rejected"; staleBase: boolean; message: string };

/** 页面当前 head 修订 id；无修订返回 null。 */
async function headRevisionId(db: DbOrTx, pageId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: revisions.id })
    .from(revisions)
    .where(eq(revisions.pageId, pageId))
    .orderBy(desc(revisions.id))
    .limit(1);
  return row?.id ?? null;
}

async function approveCountOf(db: DbOrTx, submissionId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(submissionVotes)
    .where(
      and(
        eq(submissionVotes.submissionId, submissionId),
        eq(submissionVotes.vote, "approve"),
      ),
    );
  return row.count;
}

/**
 * 管理员对提交投票：approve = 批准票（顺序批准，凑满 quorum 即时生效）；
 * reject = 驳回（必填理由，任一驳回即终态）。整段原子——投票、状态翻转、
 * 生效应用要么全部落盘，要么全部回滚。
 */
export async function reviewSubmission(
  submissionId: number,
  actor: Actor,
  action: "approve" | "reject",
  reason?: string,
): Promise<ReviewOutcome> {
  if (actor.role !== "admin") throw new ReviewError(403, "需要管理员角色");
  const db = getDb();

  return db.transaction(async (tx) => {
    // 行锁串行化同一提交上的并发投票，杜绝两次凑票双双「成为决定票」
    const [sub] = await tx
      .select()
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1)
      .for("update");
    if (!sub) throw new ReviewError(404, "提交不存在");
    if (sub.status !== "pending") {
      throw new ReviewError(409, `提交已进入终态（${sub.status}），不能再投票`);
    }

    const [existingVote] = await tx
      .select({ id: submissionVotes.id })
      .from(submissionVotes)
      .where(
        and(
          eq(submissionVotes.submissionId, submissionId),
          eq(submissionVotes.adminId, actor.id),
        ),
      )
      .limit(1);
    if (existingVote) throw new ReviewError(409, "已对该提交投过票");

    if (action === "reject") {
      const trimmed = reason?.trim() ?? "";
      if (!trimmed) throw new ReviewError(400, "驳回必须填写理由");
      await tx.insert(submissionVotes).values({
        submissionId,
        adminId: actor.id,
        vote: "reject",
        reason: trimmed,
      });
      await tx
        .update(submissions)
        .set({ status: "rejected", rejectionReason: trimmed, decidedAt: new Date() })
        .where(eq(submissions.id, submissionId));
      return { outcome: "rejected", staleBase: false, message: "已驳回" };
    }

    if (sub.submittedBy === actor.id) {
      throw new ReviewError(403, "不能受理自己提交的内容");
    }

    // 并发防护（ADR-0004 #2）：受理时页面 head ≠ base → 该票无法通过，
    // 自动驳回并提示提交者基于新版重新提交（rebase）。系统驳回不记投票。
    if (sub.kind === "edit") {
      const headId = await headRevisionId(tx, sub.pageId!);
      if (headId !== sub.baseRevisionId) {
        const message =
          "页面在提交后已有新的修订（base 过期）：请基于当前版本修改后重新提交。";
        await tx
          .update(submissions)
          .set({ status: "rejected", rejectionReason: message, decidedAt: new Date() })
          .where(eq(submissions.id, submissionId));
        return { outcome: "rejected", staleBase: true, message };
      }
    }

    await tx
      .insert(submissionVotes)
      .values({ submissionId, adminId: actor.id, vote: "approve" });
    const approveCount = await approveCountOf(tx, submissionId);
    if (approveCount < sub.quorum) {
      return { outcome: "pending", approveCount, quorum: sub.quorum };
    }

    // quorum 凑满：即时生效（产生修订 → 重建 links），提交进入 approved 终态
    await applySubmission(tx, sub);
    await tx
      .update(submissions)
      .set({ status: "approved", decidedAt: new Date() })
      .where(eq(submissions.id, submissionId));
    return { outcome: "approved" };
  });
}

// ---------------------------------------------------------------------------
// 生效管线：产生修订 → 重建 links（受理与管理员直编共用，ADR-0004 #9）
// ---------------------------------------------------------------------------

interface AppliableSubmission {
  kind: SubmissionKind;
  pageId: number | null;
  content: string;
  title: string | null;
  summary: string | null;
  termId: number | null;
  interpreterId: number | null;
  submittedBy: string;
}

/** 产生一个全量修订快照并重建该页 links。返回新修订 id。 */
async function applyContentChange(
  tx: Tx,
  pageId: number,
  content: string,
): Promise<number> {
  const [revision] = await tx
    .insert(revisions)
    .values({ pageId, content })
    .returning({ id: revisions.id });
  await rebuildPageLinks(tx, pageId, content);
  await tx.update(pages).set({ updatedAt: new Date() }).where(eq(pages.id, pageId));
  return revision.id;
}

/** 把一条（已验证的）提议落为现实：建页/产生修订/重建 links。 */
async function applySubmission(
  tx: Tx,
  sub: AppliableSubmission,
): Promise<{ pageId: number }> {
  switch (sub.kind) {
    case "edit": {
      await applyContentChange(tx, sub.pageId!, sub.content);
      return { pageId: sub.pageId! };
    }
    case "new_term": {
      const [page] = await tx
        .insert(pages)
        .values({
          type: "term",
          title: sub.title!,
          slug: slugifyTitle(sub.title!),
          createdBy: sub.submittedBy,
        })
        .returning({ id: pages.id });
      await tx.insert(terms).values({ pageId: page.id, summary: sub.summary ?? "" });
      return { pageId: page.id };
    }
    case "new_interpreter": {
      const [page] = await tx
        .insert(pages)
        .values({
          type: "interpreter",
          title: sub.title!,
          slug: slugifyTitle(sub.title!),
          createdBy: sub.submittedBy,
        })
        .returning({ id: pages.id });
      await tx
        .insert(interpreters)
        .values({ pageId: page.id, summary: sub.summary ?? "" });
      return { pageId: page.id };
    }
    case "new_perspective": {
      const [termPage] = await tx
        .select({ title: pages.title })
        .from(pages)
        .where(eq(pages.id, sub.termId!))
        .limit(1);
      const [interpreterPage] = await tx
        .select({ title: pages.title })
        .from(pages)
        .where(eq(pages.id, sub.interpreterId!))
        .limit(1);
      const title = `${interpreterPage.title}论${termPage.title}`;
      const [page] = await tx
        .insert(pages)
        .values({
          type: "perspective",
          title,
          slug: slugifyTitle(title),
          createdBy: sub.submittedBy,
        })
        .returning({ id: pages.id });
      await tx.insert(perspectives).values({
        pageId: page.id,
        termId: sub.termId!,
        interpreterId: sub.interpreterId!,
      });
      await applyContentChange(tx, page.id, sub.content);
      return { pageId: page.id };
    }
  }
}

/**
 * 重建一页的全部双链（保存时解析，ADR-0003 #4）：
 * 先清旧链，再按新正文解析落库——默认链接落词条枢纽（无同名词条时落消歧义页），
 * 显式视角链接按「词条 × 诠释者」定位视角页；未命中留名称快照即红链。
 */
export async function rebuildPageLinks(
  tx: Tx,
  pageId: number,
  content: string,
): Promise<void> {
  const refs = parseWikiLinks(content);
  await tx.delete(links).where(eq(links.sourcePageId, pageId));
  if (refs.length === 0) return;

  const targetIds = await Promise.all(refs.map((ref) => resolveLinkTarget(tx, ref)));
  await tx.insert(links).values(
    refs.map((ref, index) => ({
      sourcePageId: pageId,
      targetPageId: targetIds[index],
      targetName: wikiLinkKey(ref),
    })),
  );
}

async function resolveLinkTarget(
  tx: Tx,
  ref: ParsedWikiLink,
): Promise<number | null> {
  if (ref.interpreter === null) {
    // 精确同名词条优先（主词条），否则消歧义页（同名多义的分流入口）
    const [row] = await tx
      .select({ id: pages.id })
      .from(pages)
      .where(
        and(
          eq(pages.title, ref.term),
          isNull(pages.deletedAt),
          inArray(pages.type, ["term", "disambiguation"]),
        ),
      )
      .orderBy(desc(sql`${pages.type} = 'term'`))
      .limit(1);
    return row?.id ?? null;
  }

  const termPage = alias(pages, "link_term_page");
  const interpreterPage = alias(pages, "link_interpreter_page");
  const perspectivePage = alias(pages, "link_perspective_page");
  const [row] = await tx
    .select({ id: perspectives.pageId })
    .from(perspectives)
    .innerJoin(termPage, eq(termPage.id, perspectives.termId))
    .innerJoin(interpreterPage, eq(interpreterPage.id, perspectives.interpreterId))
    .innerJoin(perspectivePage, eq(perspectivePage.id, perspectives.pageId))
    .where(
      and(
        eq(termPage.title, ref.term),
        eq(interpreterPage.title, ref.interpreter),
        isNull(termPage.deletedAt),
        isNull(interpreterPage.deletedAt),
        isNull(perspectivePage.deletedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// 审核队列（读路径）
// ---------------------------------------------------------------------------

export interface QueueItem {
  id: number;
  kind: SubmissionKind;
  status: SubmissionStatus;
  submitterName: string;
  createdAt: Date;
  quorum: number;
  /** 已投的批准票（pending 下投票只能是批准票） */
  approverNames: string[];
  /** kind=edit：目标页信息与链接；新建类为 null */
  targetTitle: string | null;
  targetHref: string | null;
  baseRevisionId: number | null;
  /** base 过期（head ≠ base）：受理将自动驳回并提示重新提交 */
  staleBase: boolean;
  /** 编辑对象的当前内容（diff 的「当前版」一侧）；新建类为 null */
  currentContent: string | null;
  content: string;
  title: string | null;
  summary: string | null;
  /** kind=new_perspective：挂载描述 */
  termTitle: string | null;
  interpreterName: string | null;
}

/** 审核队列：全部 pending 提交（含 diff 两侧内容、票数与 base 过期标记）。 */
export async function listQueue(): Promise<QueueItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: submissions.id,
      kind: submissions.kind,
      status: submissions.status,
      submitterName: user.name,
      createdAt: submissions.createdAt,
      quorum: submissions.quorum,
      pageId: submissions.pageId,
      baseRevisionId: submissions.baseRevisionId,
      content: submissions.content,
      title: submissions.title,
      summary: submissions.summary,
      termId: submissions.termId,
      interpreterId: submissions.interpreterId,
    })
    .from(submissions)
    .innerJoin(user, eq(user.id, submissions.submittedBy))
    .where(eq(submissions.status, "pending"))
    .orderBy(asc(submissions.id));
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const votes = await db
    .select({ submissionId: submissionVotes.submissionId, adminName: user.name })
    .from(submissionVotes)
    .innerJoin(user, eq(user.id, submissionVotes.adminId))
    .where(
      and(
        inArray(submissionVotes.submissionId, ids),
        eq(submissionVotes.vote, "approve"),
      ),
    );
  const approvers = new Map<number, string[]>();
  for (const vote of votes) {
    approvers.set(vote.submissionId, [...(approvers.get(vote.submissionId) ?? []), vote.adminName]);
  }

  // 编辑类的目标页 + head 修订（staleness 与 diff 旧侧）
  const editPageIds = rows
    .filter((row) => row.kind === "edit" && row.pageId !== null)
    .map((row) => row.pageId!);
  const editPages = editPageIds.length
    ? await db
        .select({
          id: pages.id,
          type: pages.type,
          title: pages.title,
          slug: pages.slug,
        })
        .from(pages)
        .where(inArray(pages.id, editPageIds))
    : [];
  const pageById = new Map(editPages.map((page) => [page.id, page]));
  const headIds = editPageIds.length
    ? await db
        .select({
          pageId: revisions.pageId,
          id: sql<number>`max(${revisions.id})`.mapWith(Number),
        })
        .from(revisions)
        .where(inArray(revisions.pageId, editPageIds))
        .groupBy(revisions.pageId)
    : [];
  const headByPage = new Map(headIds.map((row) => [row.pageId, row.id]));
  const headContents = headIds.length
    ? await db
        .select({ id: revisions.id, content: revisions.content })
        .from(revisions)
        .where(
          inArray(
            revisions.id,
            headIds.map((row) => row.id),
          ),
        )
    : [];
  const contentByRevision = new Map(headContents.map((row) => [row.id, row.content]));

  // new_perspective 的挂载名称
  const mountPageIds = rows
    .flatMap((row) => [row.termId, row.interpreterId])
    .filter((id): id is number => id !== null);
  const mountPages = mountPageIds.length
    ? await db
        .select({ id: pages.id, title: pages.title })
        .from(pages)
        .where(inArray(pages.id, mountPageIds))
    : [];
  const titleById = new Map(mountPages.map((page) => [page.id, page.title]));

  return rows.map((row) => {
    const page = row.pageId !== null ? pageById.get(row.pageId) : undefined;
    const headId = row.pageId !== null ? headByPage.get(row.pageId) : undefined;
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      submitterName: row.submitterName,
      createdAt: row.createdAt,
      quorum: row.quorum,
      approverNames: approvers.get(row.id) ?? [],
      targetTitle: page?.title ?? null,
      targetHref: page
        ? pagePath(page.type, page.slug, page.id)
        : null,
      baseRevisionId: row.baseRevisionId,
      staleBase: row.kind === "edit" && headId !== row.baseRevisionId,
      currentContent:
        row.kind === "edit" && headId !== undefined
          ? contentByRevision.get(headId) ?? null
          : null,
      content: row.content,
      title: row.title,
      summary: row.summary,
      termTitle: row.termId !== null ? titleById.get(row.termId) ?? null : null,
      interpreterName:
        row.interpreterId !== null
          ? titleById.get(row.interpreterId) ?? null
          : null,
    };
  });
}
