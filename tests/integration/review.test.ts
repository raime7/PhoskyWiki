// 审核流核心集成测试（T06 验收）：提交状态机全转移、两票受理（含冷启动退化与
// quorum 快照）、base 过期并发防护、驳回必填理由、受理产生修订并重建 links、
// 新建页（词条/视角/诠释者）同样进队列、管理员直编。主缝 = route handlers 直调，
// 连真实 PG。管理员数量用 setAdminsExactly 精确控制（quorum 依赖它），恢复原状后清理。

import { randomUUID } from "node:crypto";

import { and, eq, inArray, notInArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as submitRoute } from "@/app/api/submissions/route";
import { POST as reviewRoute } from "@/app/api/admin/submissions/[id]/review/route";
import { auth } from "@/lib/auth";
import { seedDatabase } from "@/db/seed";
import { getDb } from "@/db";
import {
  links,
  pages,
  revisions,
  submissions,
  submissionVotes,
  user,
} from "@/db/schema";
import {
  getHeadContent,
  getHeadRevisionId,
  getPerspectiveDetail,
  listInterpreters,
  listPerspectivesOfTerm,
  listTerms,
} from "@/lib/content";
import { listQueue } from "@/lib/review";

interface TestUser {
  id: string;
  email: string;
  cookie: string;
}

const createdEmails: string[] = [];
/** setAdminsExactly 动过的非测试用户，按原角色恢复（测试用户随 afterAll 删除）。 */
const roleBackup: { id: string; role: string }[] = [];

let editor1: TestUser;
let editor2: TestUser;
let admin1: TestUser;
let admin2: TestUser;

async function createUser(
  role: "editor" | "admin",
  password: string,
  name: string,
): Promise<TestUser> {
  const email = `t06-${randomUUID()}@example.com`;
  createdEmails.push(email);
  const signUp = await auth.api.signUpEmail({ body: { name, email, password } });
  if (role === "admin") {
    await getDb().update(user).set({ role: "admin" }).where(eq(user.id, signUp.user.id));
  }
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const cookie = signIn.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  return { id: signUp.user.id, email, cookie };
}

/** 把站内管理员精确设置为一组 id（quorum 快照的前置条件），非测试用户记录原角色。 */
async function setAdminsExactly(ids: string[]): Promise<void> {
  const db = getDb();
  const testIds = (
    await db.select({ id: user.id }).from(user).where(inArray(user.email, createdEmails))
  ).map((row) => row.id);
  const admins = await db.select({ id: user.id }).from(user).where(eq(user.role, "admin"));
  for (const admin of admins) {
    if (
      !ids.includes(admin.id) &&
      !testIds.includes(admin.id) &&
      !roleBackup.some((row) => row.id === admin.id)
    ) {
      const [row] = await db
        .select({ role: user.role })
        .from(user)
        .where(eq(user.id, admin.id));
      roleBackup.push({ id: admin.id, role: row.role });
    }
  }
  await db
    .update(user)
    .set({ role: "editor" })
    .where(
      ids.length
        ? and(eq(user.role, "admin"), notInArray(user.id, ids))
        : eq(user.role, "admin"),
    );
  if (ids.length) {
    await db.update(user).set({ role: "admin" }).where(inArray(user.id, ids));
  }
}

beforeAll(async () => {
  await seedDatabase();
  editor1 = await createUser("editor", "editor1-pass-123", "T06 编者一");
  editor2 = await createUser("editor", "editor2-pass-123", "T06 编者二");
  admin1 = await createUser("admin", "admin1-pass-123", "T06 管理员一");
  admin2 = await createUser("admin", "admin2-pass-123", "T06 管理员二");
});

afterAll(async () => {
  const db = getDb();
  for (const { id, role } of roleBackup) {
    await db
      .update(user)
      .set({ role: role as "editor" | "admin" | "trusted" })
      .where(eq(user.id, id));
  }
  // 测试用户建过的页面与提交先清（submittedBy/createdBy 无级联），再删用户
  const testIds = (
    await db.select({ id: user.id }).from(user).where(inArray(user.email, createdEmails))
  ).map((row) => row.id);
  if (testIds.length) {
    await db.delete(pages).where(inArray(pages.createdBy, testIds));
    await db.delete(submissionVotes).where(inArray(submissionVotes.adminId, testIds));
    await db.delete(submissions).where(inArray(submissions.submittedBy, testIds));
    await db.delete(user).where(inArray(user.id, testIds));
  }
});

// ---- 主缝调用助手 -----------------------------------------------------------

/** 路由响应体的宽松形状（只取测试断言用到的字段；submissionId 只在 201 路径读取）。 */
interface RouteData {
  submissionId: number;
  outcome?: string;
  quorum?: number;
  approveCount?: number;
  error?: string;
  href?: string;
}

async function submit(
  body: unknown,
  cookie?: string,
): Promise<{ status: number; data: RouteData }> {
  const res = await submitRoute(
    new Request("http://localhost/api/submissions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, data: (await res.json().catch(() => null)) ?? {} };
}

async function review(
  id: number,
  body: unknown,
  cookie?: string,
): Promise<{ status: number; data: RouteData & { staleBase?: boolean; message?: string } }> {
  const res = await reviewRoute(
    new Request(`http://localhost/api/admin/submissions/${id}/review`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: res.status, data: (await res.json().catch(() => null)) ?? {} };
}

// ---- 内容夹具 ---------------------------------------------------------------

async function termIdByTitle(title: string): Promise<number> {
  const term = (await listTerms()).find((row) => row.title === title);
  if (!term) throw new Error(`种子缺少词条：${title}`);
  return term.id;
}

/** 词条下某诠释者的视角页 id。 */
async function perspectiveIdOf(termTitle: string, interpreterName: string): Promise<number> {
  const perspectives = await listPerspectivesOfTerm(await termIdByTitle(termTitle));
  const match = perspectives.find((row) => row.interpreterName === interpreterName);
  if (!match) throw new Error(`种子缺少视角：${interpreterName}论${termTitle}`);
  return match.pageId;
}

/** 对某视角页发起编辑提交，base 取当前 head（编辑提交的常规形态）。 */
async function submitEdit(
  actor: TestUser,
  pageId: number,
  content: string,
  supersedes?: number,
): Promise<{ status: number; data: RouteData }> {
  return submit(
    {
      kind: "edit",
      pageId,
      content,
      baseRevisionId: await getHeadRevisionId(pageId),
      ...(supersedes !== undefined ? { supersedes } : {}),
    },
    actor.cookie,
  );
}

async function submissionRow(id: number) {
  const [row] = await getDb()
    .select()
    .from(submissions)
    .where(eq(submissions.id, id))
    .limit(1);
  return row;
}

// ---- 测试 -------------------------------------------------------------------

describe("提交状态机（T06：pending → approved/rejected 均终态，重提 = 新建）", () => {
  it("编者提交进 pending（quorum 快照随创建）；受理后产生修订进入读路径；终态再投 409", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("主体性", "福柯");

    const created = await submitEdit(editor1, pageId, "福柯视角的受理版内容。");
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ outcome: "pending", quorum: 1 });
    expect((await submissionRow(created.data.submissionId)).status).toBe("pending");

    const approved = await review(created.data.submissionId, { action: "approve" }, admin1.cookie);
    expect(approved.status).toBe(200);
    expect(approved.data).toEqual({ outcome: "approved" });

    // 受理后的内容立即进入读路径
    expect(await getHeadContent(pageId)).toBe("福柯视角的受理版内容。");
    const row = await submissionRow(created.data.submissionId);
    expect(row.status).toBe("approved");
    expect(row.decidedAt).not.toBeNull();

    // 终态不可再投
    const again = await review(created.data.submissionId, { action: "approve" }, admin1.cookie);
    expect(again.status).toBe(409);
  });

  it("驳回必填理由；驳回是终态；修改重提 = 新建提交（supersedes 谱系）", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("主体性", "福柯");
    const before = await getHeadContent(pageId);

    const created = await submitEdit(editor1, pageId, "有争议的重写版本。");
    const id = created.data.submissionId as number;

    const noReason = await review(id, { action: "reject" }, admin1.cookie);
    expect(noReason.status).toBe(400);
    expect(noReason.data.error).toContain("理由");

    const rejected = await review(id, { action: "reject", reason: "论据不足，请补充文献。" }, admin1.cookie);
    expect(rejected.data).toMatchObject({ outcome: "rejected", staleBase: false });
    expect(await getHeadContent(pageId)).toBe(before); // 未生效
    expect((await submissionRow(id)).rejectionReason).toBe("论据不足，请补充文献。");

    // 终态后再投 409
    expect((await review(id, { action: "approve" }, admin1.cookie)).status).toBe(409);

    // 修改重提 = 新建提交，旧提交保持 rejected
    const resubmitted = await submitEdit(editor1, pageId, "补充论据后的重提版本。", id);
    expect(resubmitted.status).toBe(201);
    const newId = resubmitted.data.submissionId as number;
    expect(newId).not.toBe(id);
    expect((await submissionRow(newId)).supersedesId).toBe(id);
    expect((await submissionRow(id)).status).toBe("rejected");

    const approved = await review(newId, { action: "approve" }, admin1.cookie);
    expect(approved.data).toEqual({ outcome: "approved" });
    expect(await getHeadContent(pageId)).toBe("补充论据后的重提版本。");
  });

  it("输入校验：非法 kind / 空 content / 缺 base / 非视角页目标", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("主体性", "福柯");
    const termId = await termIdByTitle("主体性");

    expect((await submit({ kind: "bogus" }, editor1.cookie)).status).toBe(400);
    expect(
      (
        await submit(
          { kind: "edit", pageId, content: "  ", baseRevisionId: await getHeadRevisionId(pageId) },
          editor1.cookie,
        )
      ).status,
    ).toBe(400);
    expect((await submit({ kind: "edit", pageId, content: "x" }, editor1.cookie)).status).toBe(400);
    // 词条是聚合枢纽，正文在视角页里（一期编辑对象只有视角页）
    expect(
      (
        await submit(
          { kind: "edit", pageId: termId, content: "x", baseRevisionId: 1 },
          editor1.cookie,
        )
      ).status,
    ).toBe(400);
    // supersedes 只能指向已驳回的提交
    expect(
      (
        await submit(
          {
            kind: "edit",
            pageId,
            content: "x",
            baseRevisionId: await getHeadRevisionId(pageId),
            supersedes: 999999,
          },
          editor1.cookie,
        )
      ).status,
    ).toBe(400);
  });
});

describe("两票受理（顺序批准、任一驳回即终态）", () => {
  it("quorum=2：首票记票不生效，第二票凑满生效；同一管理员重复投票 409", async () => {
    await setAdminsExactly([admin1.id, admin2.id]);
    const pageId = await perspectiveIdOf("意识形态", "编委会");

    const created = await submitEdit(editor1, pageId, "意识形态：两票受理版。");
    expect(created.data.quorum).toBe(2);
    const id = created.data.submissionId as number;
    const before = await getHeadContent(pageId);

    const first = await review(id, { action: "approve" }, admin1.cookie);
    expect(first.data).toEqual({ outcome: "pending", approveCount: 1, quorum: 2 });
    expect(await getHeadContent(pageId)).toBe(before); // 记票未生效

    const dup = await review(id, { action: "approve" }, admin1.cookie);
    expect(dup.status).toBe(409);

    const second = await review(id, { action: "approve" }, admin2.cookie);
    expect(second.data).toEqual({ outcome: "approved" });
    expect(await getHeadContent(pageId)).toBe("意识形态：两票受理版。");

    const votes = await getDb()
      .select()
      .from(submissionVotes)
      .where(eq(submissionVotes.submissionId, id));
    expect(votes).toHaveLength(2);
    expect(votes.every((vote) => vote.vote === "approve")).toBe(true);
  });

  it("一准一驳 = 驳回终态：先投的批准票作废，内容不生效", async () => {
    await setAdminsExactly([admin1.id, admin2.id]);
    const pageId = await perspectiveIdOf("意识形态", "编委会");
    const before = await getHeadContent(pageId);

    const created = await submitEdit(editor1, pageId, "一准一驳的版本。");
    const id = created.data.submissionId as number;

    expect((await review(id, { action: "approve" }, admin1.cookie)).data.outcome).toBe("pending");
    const rejected = await review(id, { action: "reject", reason: "口径与词条定位不符。" }, admin2.cookie);
    expect(rejected.data).toMatchObject({ outcome: "rejected", staleBase: false });

    expect(await getHeadContent(pageId)).toBe(before);
    expect((await submissionRow(id)).status).toBe("rejected");
    expect((await review(id, { action: "approve" }, admin2.cookie)).status).toBe(409);
  });

  it("准入：游客提交 401；编者审核 403；不存在的提交 404", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("意识形态", "编委会");

    expect(
      (await submit({ kind: "edit", pageId, content: "x", baseRevisionId: 1 })).status,
    ).toBe(401);
    const created = await submitEdit(editor1, pageId, "准入测试版本。");
    expect((await review(created.data.submissionId, { action: "approve" }, editor2.cookie)).status).toBe(403);
    expect((await review(999_999, { action: "approve" }, admin1.cookie)).status).toBe(404);
  });

  it("晋升为管理员的提交者不能受理自己的提交（403），他人可受理", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("意识形态", "编委会");
    const created = await submitEdit(editor2, pageId, "等待自己被晋升的版本。");
    const id = created.data.submissionId as number;

    // 提交后提交者被晋升为管理员——仍不能自审
    await setAdminsExactly([admin1.id, editor2.id]);
    expect((await review(id, { action: "approve" }, editor2.cookie)).status).toBe(403);

    const approved = await review(id, { action: "approve" }, admin1.cookie);
    expect(approved.data).toEqual({ outcome: "approved" });
  });
});

describe("冷启动退化与 quorum 快照（min(2, 管理员数)，创建时定格）", () => {
  it("恰一名管理员：quorum=1，单票即生效", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("异化", "编委会");

    const created = await submitEdit(editor1, pageId, "冷启动单管理员版。");
    expect(created.data.quorum).toBe(1);
    const approved = await review(created.data.submissionId, { action: "approve" }, admin1.cookie);
    expect(approved.data).toEqual({ outcome: "approved" });
    expect(await getHeadContent(pageId)).toBe("冷启动单管理员版。");
  });

  it("quorum 在提交创建时快照：之后管理员人数增减不追溯已存在的提交", async () => {
    const pageId = await perspectiveIdOf("异化", "编委会");

    // 提交时只有一名管理员（quorum=1）——之后增员，一票仍生效
    await setAdminsExactly([admin1.id]);
    const submittedWhenOne = await submitEdit(editor1, pageId, "单管理员期提交的内容。");
    expect(submittedWhenOne.data.quorum).toBe(1);
    await setAdminsExactly([admin1.id, admin2.id]);
    const promoted = await review(
      submittedWhenOne.data.submissionId,
      { action: "approve" },
      admin1.cookie,
    );
    expect(promoted.data).toEqual({ outcome: "approved" });

    // 反向：两名管理员期提交（quorum=2）——之后减员，仍差一票、保持 pending
    const submittedWhenTwo = await submitEdit(editor2, pageId, "双管理员期提交的内容。");
    expect(submittedWhenTwo.data.quorum).toBe(2);
    await setAdminsExactly([admin1.id]);
    const partial = await review(
      submittedWhenTwo.data.submissionId,
      { action: "approve" },
      admin1.cookie,
    );
    expect(partial.data).toEqual({ outcome: "pending", approveCount: 1, quorum: 2 });
    expect((await submissionRow(submittedWhenTwo.data.submissionId)).status).toBe("pending");
  });
});

describe("并发防护（base 过期自动驳回，ADR-0004 #2）", () => {
  it("页面 head 越过 base 后受理：自动驳回并提示基于新版重新提交", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("剩余价值", "编委会");
    const base = await getHeadRevisionId(pageId);

    // 编者基于 r1 提交；随后管理员直编使页面前进到 r2
    const created = await submit(
      {
        kind: "edit",
        pageId,
        content: "编者基于旧版的内容。",
        baseRevisionId: base,
      },
      editor1.cookie,
    );
    const direct = await submit(
      {
        kind: "edit",
        pageId,
        content: "管理员抢先直编的内容。",
        baseRevisionId: base,
      },
      admin1.cookie,
    );
    expect(direct.data.outcome).toBe("direct");
    expect(await getHeadRevisionId(pageId)).not.toBe(base);

    // 受理编者的提交：base 过期 → 该票无法通过，自动驳回
    const outcome = await review(created.data.submissionId, { action: "approve" }, admin1.cookie);
    expect(outcome.data).toMatchObject({ outcome: "rejected", staleBase: true });
    expect(outcome.data.message).toContain("重新提交");

    const row = await submissionRow(created.data.submissionId);
    expect(row.status).toBe("rejected");
    expect(row.rejectionReason).toContain("重新提交");
    // 读路径保持管理员的版本，编者的旧 base 内容未覆盖
    expect(await getHeadContent(pageId)).toBe("管理员抢先直编的内容。");

    // 编者基于新版（当前 head）重提 → 正常受理生效
    const resubmitted = await submitEdit(editor1, pageId, "编者基于新版的内容。");
    const approved = await review(resubmitted.data.submissionId, { action: "approve" }, admin1.cookie);
    expect(approved.data).toEqual({ outcome: "approved" });
    expect(await getHeadContent(pageId)).toBe("编者基于新版的内容。");
  });

  it("base 未过期（head == base）时正常通过", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("剩余价值", "编委会");
    const created = await submitEdit(editor1, pageId, "base 未过期的正常受理。");
    const outcome = await review(created.data.submissionId, { action: "approve" }, admin1.cookie);
    expect(outcome.data).toEqual({ outcome: "approved" });
  });
});

describe("管理员直编（不经队列，与受理共用修订管线）", () => {
  it("同一端点：管理员提交直接生效，不产生提交行", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("价值（哲学）", "编委会");
    const pendingBefore = await getDb().$count(submissions, eq(submissions.status, "pending"));

    const result = await submitEdit(admin1, pageId, "管理员直编的通俗视角。");
    expect(result.status).toBe(201);
    expect(result.data.outcome).toBe("direct");
    expect(result.data.href).toMatch(new RegExp(`/perspective/.+-${pageId}$`));
    expect(await getHeadContent(pageId)).toBe("管理员直编的通俗视角。");
    expect(
      await getDb().$count(submissions, eq(submissions.status, "pending")),
    ).toBe(pendingBefore);
  });
});

describe("受理产生修订快照并重建 links（视角热度随之更新）", () => {
  it("受理后：新修订落库、旧 links 清空重解析、目标视角热度 +1 且排序前移", async () => {
    await setAdminsExactly([admin1.id]);
    const subjectivity = await termIdByTitle("主体性");
    // 本测试之前的用例已重写过 剩余价值/意识形态 等页的 links，选一个尚未动过的种子视角
    const sourcePageId = await perspectiveIdOf("价值（政治经济学）", "编委会");
    const foucault = (await listPerspectivesOfTerm(subjectivity)).find(
      (row) => row.title === "福柯论主体性",
    )!;
    const revisionCountBefore = await getDb()
      .select()
      .from(revisions)
      .where(eq(revisions.pageId, sourcePageId));
    const sourceLinksBefore = await getDb()
      .select()
      .from(links)
      .where(eq(links.sourcePageId, sourcePageId));
    // 种子里该视角有已解析的旧链（[[异化]] 等），受理后应被整套替换
    expect(sourceLinksBefore.map((row) => row.targetName)).toContain("异化");

    const created = await submitEdit(
      editor1,
      sourcePageId,
      "剥削机制参见[[剩余价值]]词条；主体问题参见[[主体性|福柯论主体性@福柯]]。",
    );
    expect((await review(created.data.submissionId, { action: "approve" }, admin1.cookie)).data).toEqual({
      outcome: "approved",
    });

    // 修订快照：多了一个全量修订
    const revisionCountAfter = await getDb()
      .select()
      .from(revisions)
      .where(eq(revisions.pageId, sourcePageId));
    expect(revisionCountAfter.length).toBe(revisionCountBefore.length + 1);

    // links 重建：旧的（[[异化]] 等）不在了，只剩新正文的解析结果
    const sourceLinksAfter = await getDb()
      .select()
      .from(links)
      .where(eq(links.sourcePageId, sourcePageId));
    expect(sourceLinksAfter).toHaveLength(2);
    expect(sourceLinksAfter.map((row) => row.targetName).sort()).toEqual(
      ["剩余价值", "主体性@福柯"].sort(),
    );
    const explicit = sourceLinksAfter.find((row) => row.targetName === "主体性@福柯")!;
    expect(explicit.targetPageId).toBe(foucault.pageId);

    // 视角热度随之更新：福柯视角 +1 条入链，排到零引用视角之前
    const reordered = await listPerspectivesOfTerm(subjectivity);
    const foucaultAfter = reordered.find((row) => row.title === "福柯论主体性")!;
    expect(foucaultAfter.linkCount).toBe(foucault.linkCount + 1);
    const afterFoucault = reordered.slice(reordered.indexOf(foucaultAfter) + 1);
    expect(afterFoucault.every((row) => row.linkCount <= foucaultAfter.linkCount)).toBe(true);
  });
});

describe("新建页同样进队列（词条/视角/诠释者）", () => {
  it("新建视角：受理后建页 + 负载 + 修订 + 解析双链，进入读路径", async () => {
    await setAdminsExactly([admin1.id]);
    const surplusId = await termIdByTitle("剩余价值");
    const deleuze = (await listInterpreters()).find((row) => row.name === "德勒兹")!;

    const created = await submit(
      {
        kind: "new_perspective",
        termId: surplusId,
        interpreterId: deleuze.pageId,
        content: "德勒兹论剩余价值：欲望生产视角，另见[[异化]]。",
      },
      editor1.cookie,
    );
    expect(created.status).toBe(201);
    expect((await review(created.data.submissionId, { action: "approve" }, admin1.cookie)).data).toEqual({
      outcome: "approved",
    });

    const newPerspective = (await listPerspectivesOfTerm(surplusId)).find(
      (row) => row.title === "德勒兹论剩余价值",
    )!;
    expect(newPerspective).toBeDefined();
    const detail = await getPerspectiveDetail(newPerspective.pageId);
    expect(detail).toMatchObject({ termTitle: "剩余价值", interpreterName: "德勒兹" });
    expect(await getHeadContent(newPerspective.pageId)).toContain("欲望生产");

    const targets = await getDb()
      .select()
      .from(links)
      .where(eq(links.sourcePageId, newPerspective.pageId));
    expect(targets).toHaveLength(1);
    expect(targets[0].targetName).toBe("异化");
    expect(targets[0].targetPageId).toBe(await termIdByTitle("异化"));
  });

  it("新建词条与新建诠释者：受理后可读；撞名/重复挂载预检 400", async () => {
    await setAdminsExactly([admin1.id]);

    const term = await submit(
      { kind: "new_term", title: "物化（T06 测试）", summary: "测试用新词条。" },
      editor1.cookie,
    );
    expect(term.status).toBe(201);
    expect(
      (await review(term.data.submissionId, { action: "approve" }, admin1.cookie)).data,
    ).toEqual({ outcome: "approved" });
    expect(
      (await listTerms()).some((row) => row.title === "物化（T06 测试）"),
    ).toBe(true);

    const interpreter = await submit(
      { kind: "new_interpreter", title: "卢卡奇（T06 测试）", summary: "测试用新诠释者。" },
      editor1.cookie,
    );
    expect(interpreter.status).toBe(201);
    expect(
      (await review(interpreter.data.submissionId, { action: "approve" }, admin1.cookie)).data,
    ).toEqual({ outcome: "approved" });
    expect(
      (await listInterpreters()).some((row) => row.name === "卢卡奇（T06 测试）"),
    ).toBe(true);

    // 撞名预检：同名词典（含软删除占位）、重复的（词条 × 诠释者）挂载
    expect(
      (await submit({ kind: "new_term", title: "主体性", summary: "" }, editor1.cookie)).status,
    ).toBe(400);
    const subjectivity = await termIdByTitle("主体性");
    const lacan = (await listInterpreters()).find((row) => row.name === "拉康")!;
    expect(
      (
        await submit(
          { kind: "new_perspective", termId: subjectivity, interpreterId: lacan.pageId, content: "x" },
          editor1.cookie,
        )
      ).status,
    ).toBe(400);
  });
});

describe("审核队列读路径（listQueue）", () => {
  it("待审列表带票数、base 过期标记与 diff 两侧内容", async () => {
    await setAdminsExactly([admin1.id, admin2.id]);
    const pageId = await perspectiveIdOf("主体性", "拉康");
    const created = await submitEdit(editor1, pageId, "队列展示用的提案内容。");
    const id = created.data.submissionId as number;

    await review(id, { action: "approve" }, admin1.cookie);

    // 制造 base 过期：管理员直编推进 head
    await submitEdit(admin2, pageId, "直编推进 head。");
    await submitEdit(editor2, pageId, "第二条待审提交。");

    const queue = await listQueue();
    const item = queue.find((row) => row.id === id);
    expect(item).toBeDefined();
    expect(item!.kind).toBe("edit");
    expect(item!.quorum).toBe(2);
    expect(item!.approverNames).toEqual(["T06 管理员一"]);
    expect(item!.staleBase).toBe(true); // head 已被直编推进
    expect(item!.currentContent).toBe("直编推进 head。");
    expect(item!.content).toBe("队列展示用的提案内容。");
    expect(item!.targetTitle).toBe("拉康论主体性");

    const other = queue.find((row) => row.content === "第二条待审提交。");
    expect(other?.staleBase).toBe(false);

    // 清理：把两条都驳回，避免影响后续文件的种子断言（下一个文件会重新灌种子）
    await review(id, { action: "reject", reason: "测试清理" }, admin2.cookie);
  });
});
