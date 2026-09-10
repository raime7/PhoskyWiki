import { fixtureSignUp } from "./auth-fixture";
// 全站搜索集成测试（T10 验收，主缝）：写路径经真实 route handlers（受理/直编/回滚/
// 软删除/恢复），搜索索引用注入的 FakeSearchIndex——真 Meilisearch 由契约测试覆盖。
// 验证：生效事件驱动增量同步（ADR-0004 #8）、索引故障不阻断写路径、
// 全量校对修复漂移、类型分面、即打即搜联想。
// 每个测试用独立命名的夹具（词条标题部分唯一，软删除仍占名），互不串扰。

import { randomUUID } from "node:crypto";

import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as submitRoute } from "@/app/api/submissions/route";
import { POST as reviewRoute } from "@/app/api/admin/submissions/[id]/review/route";
import { POST as pageActionRoute } from "@/app/api/admin/pages/[pageId]/route";
import { POST as reindexRoute } from "@/app/api/admin/search/reindex/route";
import { GET as searchRoute } from "@/app/api/search/route";
import { GET as suggestRoute } from "@/app/api/search/suggest/route";
import { auth } from "@/lib/auth";
import { seedDatabase } from "@/db/seed";
import { getDb } from "@/db";
import { pages, revisions, submissions, user } from "@/db/schema";
import { getHeadRevisionId } from "@/lib/content";
import { FakeSearchIndex } from "@/lib/search/fake-index";
import { injectSearchIndex, resetSearchIndex } from "@/lib/search/search-service";
import { reindexAll } from "@/lib/search/search-sync";

interface TestUser {
  id: string;
  cookie: string;
}

const createdEmails: string[] = [];
let admin: TestUser;
let editor: TestUser;

/** setAdminsExactly 动过的非测试用户，按原角色恢复（测试用户随 afterAll 删除）。 */
const roleBackup: { id: string; role: string }[] = [];

/** 搜索索引在 beforeEach 注入新 fake（主缝替身），测试直接读取/篡改其内容。 */
let index: FakeSearchIndex;

async function createUser(role: "editor" | "admin", name: string): Promise<TestUser> {
  const email = `t10-${randomUUID()}@example.com`;
  createdEmails.push(email);
  const password = "t10-pass-123";
  const signUp = await fixtureSignUp({ body: { name, email, password } });
  if (role === "admin") {
    await getDb().update(user).set({ role: "admin" }).where(eq(user.id, signUp.user.id));
  }
  const signIn = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const cookie = signIn.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  return { id: signUp.user.id, cookie };
}

/** 冷启动单管理员：quorum = min(2, 1) = 1，一票受理（其余管理员降为编者，afterAll 恢复）。 */
async function setAdminsExactly(id: string): Promise<void> {
  const db = getDb();
  const testIds = (
    await db.select({ id: user.id }).from(user).where(inArray(user.email, createdEmails))
  ).map((row) => row.id);
  for (const row of await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(eq(user.role, "admin"))) {
    if (
      row.id !== id &&
      !testIds.includes(row.id) &&
      !roleBackup.some((backup) => backup.id === row.id)
    ) {
      roleBackup.push({ id: row.id, role: row.role });
    }
  }
  await db.update(user).set({ role: "editor" }).where(eq(user.role, "admin"));
  await db.update(user).set({ role: "admin" }).where(eq(user.id, id));
}

beforeAll(async () => {
  await seedDatabase();
  admin = await createUser("admin", "T10 管理员");
  editor = await createUser("editor", "T10 编者");
  await setAdminsExactly(admin.id);
});

beforeEach(() => {
  index = new FakeSearchIndex();
  injectSearchIndex(index);
});

afterAll(async () => {
  const db = getDb();
  for (const { id, role } of roleBackup) {
    await db
      .update(user)
      .set({ role: role as "editor" | "admin" | "trusted" })
      .where(eq(user.id, id));
  }
  const testIds = (
    await db.select({ id: user.id }).from(user).where(inArray(user.email, createdEmails))
  ).map((row) => row.id);
  if (testIds.length) {
    await db.delete(pages).where(inArray(pages.createdBy, testIds));
    await db.delete(submissions).where(inArray(submissions.submittedBy, testIds));
    await db.delete(user).where(inArray(user.id, testIds));
  }
});

// ---- 主缝调用助手 -----------------------------------------------------------

async function postJson<P extends Record<string, string> = Record<string, string>>(
  handler: (req: Request, ctx: { params: Promise<P> }) => Promise<Response>,
  path: string,
  body: unknown,
  cookie?: string,
  params?: P,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params ?? ({} as P)) },
  );
  return { status: res.status, data: (await res.json().catch(() => ({}))) };
}

async function getJson(
  handler: (req: Request) => Promise<Response>,
  path: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await handler(new Request(`http://localhost${path}`));
  return { status: res.status, data: (await res.json().catch(() => ({}))) };
}

async function submit(body: unknown, actor: TestUser) {
  return postJson(submitRoute, "/api/submissions", body, actor.cookie);
}

async function approve(submissionId: number) {
  return postJson(
    reviewRoute,
    `/api/admin/submissions/${submissionId}/review`,
    { action: "approve" },
    admin.cookie,
    { id: String(submissionId) },
  );
}

async function pageAction(pageId: number, body: unknown) {
  return postJson(
    pageActionRoute,
    `/api/admin/pages/${pageId}`,
    body,
    admin.cookie,
    { pageId: String(pageId) },
  );
}

async function pageIdByTitle(title: string): Promise<number> {
  const [row] = await getDb().select({ id: pages.id }).from(pages).where(eq(pages.title, title)).limit(1);
  if (!row) throw new Error(`夹具页面不存在：${title}`);
  return row.id;
}

// ---- 内容夹具 ---------------------------------------------------------------

let fixtureSeq = 0;

interface Fixture {
  tag: string;
  termId: number;
  interpreterId: number;
  perspectiveId: number;
  interpreterTitle: string;
  perspectiveTitle: string;
  firstPerspectiveContent: string;
}

/** 建词条 + 诠释者 + 视角（编者提交、管理员受理）。tag 保证跨测试唯一。 */
async function createIndexedContent(prefix: string): Promise<Fixture> {
  const tag = `${prefix}${String(++fixtureSeq).padStart(2, "0")}`;
  const termTitle = `语义场${tag}`;
  const interpreterTitle = `特里尔${tag}`;
  const firstPerspectiveContent = `${interpreterTitle}的视角：场内互相定义，场界随视角移动。${tag}`;

  const term = await submit(
    { kind: "new_term", title: termTitle, summary: `词义在系统中的位置与相互关系。${tag}` },
    editor,
  );
  expect(term.status).toBe(201);
  expect((await approve(term.data.submissionId as number)).status).toBe(200);

  const interpreter = await submit(
    { kind: "new_interpreter", title: interpreterTitle, summary: `语义场理论的提出者。${tag}` },
    editor,
  );
  expect(interpreter.status).toBe(201);
  expect((await approve(interpreter.data.submissionId as number)).status).toBe(200);

  const perspective = await submit(
    {
      kind: "new_perspective",
      termId: await pageIdByTitle(termTitle),
      interpreterId: await pageIdByTitle(interpreterTitle),
      content: firstPerspectiveContent,
    },
    editor,
  );
  expect(perspective.status).toBe(201);
  expect((await approve(perspective.data.submissionId as number)).status).toBe(200);

  const perspectiveTitle = `${interpreterTitle}论${termTitle}`;
  return {
    tag,
    termId: await pageIdByTitle(termTitle),
    interpreterId: await pageIdByTitle(interpreterTitle),
    perspectiveId: await pageIdByTitle(perspectiveTitle),
    interpreterTitle,
    perspectiveTitle,
    firstPerspectiveContent,
  };
}

/** 管理员直编一版新内容。 */
async function directEdit(pageId: number, content: string) {
  const edited = await submit(
    {
      kind: "edit",
      pageId,
      content,
      baseRevisionId: await getHeadRevisionId(pageId),
    },
    admin,
  );
  expect(edited.status).toBe(201);
  expect(edited.data.outcome).toBe("direct");
}

async function searchIds(query: string): Promise<number[]> {
  const result = await getJson(searchRoute, `/api/search?q=${encodeURIComponent(query)}`);
  expect(result.status).toBe(200);
  return (result.data.hits as { pageId: number }[]).map(hit => hit.pageId);
}

// ---- 测试 -------------------------------------------------------------------

describe("生效事件驱动的增量同步（T10）", () => {
  it("受理后内容可被搜到：新建词条/诠释者/视角进索引", async () => {
    const fixture = await createIndexedContent("受理");

    const search = await getJson(searchRoute, `/api/search?q=${encodeURIComponent(fixture.tag)}`);
    expect(search.status).toBe(200);
    const hitIds = (search.data.hits as { pageId: number }[]).map((hit) => hit.pageId).sort();
    expect(hitIds).toEqual([fixture.termId, fixture.interpreterId, fixture.perspectiveId].sort());
  });

  it("管理员直编生效后索引同步更新（ADR-0004 #9，跳过排队共用管线）", async () => {
    const fixture = await createIndexedContent("直编");

    await directEdit(fixture.perspectiveId, `直编后的正文 DISTINCTIVE-EDIT-ZZ ${fixture.tag}`);

    expect(await searchIds("DISTINCTIVE-EDIT-ZZ")).toContain(fixture.perspectiveId);
  });

  it("回滚生成新修订，索引内容随之回退（ADR-0004 #7）", async () => {
    const fixture = await createIndexedContent("回滚");
    const [firstRevision] = await getDb()
      .select({ id: revisions.id })
      .from(revisions)
      .where(eq(revisions.pageId, fixture.perspectiveId))
      .orderBy(asc(revisions.id))
      .limit(1);

    await directEdit(fixture.perspectiveId, `被回滚掉的坏内容 ROLLBACK-AWAY-ZZ ${fixture.tag}`);
    expect(await searchIds("ROLLBACK-AWAY-ZZ")).toContain(fixture.perspectiveId);

    const rolled = await pageAction(fixture.perspectiveId, {
      action: "rollback",
      revisionId: firstRevision.id,
    });
    expect(rolled.status).toBe(200);
    expect(await searchIds("ROLLBACK-AWAY-ZZ")).not.toContain(fixture.perspectiveId);
    expect(await searchIds(fixture.tag)).toContain(fixture.perspectiveId);
  });

  it("软删除把页面移出索引，恢复后重新可搜", async () => {
    const fixture = await createIndexedContent("删除");

    const deleted = await pageAction(fixture.perspectiveId, { action: "delete" });
    expect(deleted.status).toBe(200);
    expect(await searchIds(fixture.tag)).not.toContain(fixture.perspectiveId);
    const search = await getJson(searchRoute, `/api/search?q=${encodeURIComponent(fixture.perspectiveTitle)}`);
    expect((search.data.hits as unknown[]).length).toBe(0);

    const restored = await pageAction(fixture.perspectiveId, { action: "restore" });
    expect(restored.status).toBe(200);
    expect(await searchIds(fixture.tag)).toContain(fixture.perspectiveId);
  });

  it("视角所属词条被软删除 → 视角同步移出（与读路径可见性同口径）", async () => {
    const fixture = await createIndexedContent("词条删");
    expect(await searchIds(fixture.tag)).toContain(fixture.perspectiveId);

    await pageAction(fixture.termId, { action: "delete" });
    expect(await searchIds(fixture.tag)).not.toContain(fixture.termId);
    expect(await searchIds(fixture.tag)).not.toContain(fixture.perspectiveId);
    expect(await searchIds(fixture.tag)).toContain(fixture.interpreterId);
  });
});

describe("全量校对（T10：手动触发，修复漂移）", () => {
  it("管理员路由触发全量重建，改写被篡改的文档并清掉幽灵文档", async () => {
    const fixture = await createIndexedContent("校对");

    // 漂移一：真实文档被篡改；漂移二：PG 里不存在的幽灵文档
    index.docs.set(fixture.termId, {
      pageId: fixture.termId,
      type: "term",
      title: `语义场${fixture.tag}`,
      slug: "x",
      body: "被污染的正文",
    });
    index.docs.set(424242, {
      pageId: 424242,
      type: "term",
      title: "幽灵词条",
      slug: "ghost",
      body: "ghost",
    });

    const reindexed = await postJson(reindexRoute, "/api/admin/search/reindex", {}, admin.cookie);
    expect(reindexed.status).toBe(200);
    expect(Number(reindexed.data.indexed)).toBeGreaterThan(0);

    expect(await searchIds(fixture.tag)).toContain(fixture.termId);
    expect(await searchIds("幽灵词条")).not.toContain(424242);
    // 种子内容也一并入索引
    const seeded = await getJson(searchRoute, `/api/search?q=${encodeURIComponent("主体性")}&type=term`);
    expect((seeded.data.hits as unknown[]).length).toBeGreaterThan(0);
  });

  it("lib 层 reindexAll 等价可用（供 cron 脚本调用）", async () => {
    const fixture = await createIndexedContent("定时");
    index.docs.clear();
    const { indexed } = await reindexAll();
    expect(indexed).toBeGreaterThan(0);
    expect(await searchIds(fixture.tag)).toContain(fixture.termId);
  });
});

describe("类型分面与联想（T10）", () => {
  it("type 过滤只出该类型命中，分面计数仍统计全部类型", async () => {
    const fixture = await createIndexedContent("分面");

    const filtered = await getJson(
      searchRoute,
      `/api/search?q=${encodeURIComponent(fixture.tag)}&type=perspective`,
    );
    expect((filtered.data.hits as { pageId: number }[]).map((hit) => hit.pageId)).toEqual([
      fixture.perspectiveId,
    ]);
    expect(filtered.data.facets).toMatchObject({ term: 1, interpreter: 1, perspective: 1 });
    expect(filtered.data.total).toBe(1);
  });

  it("联想接口返回小结果集，命中视角与诠释者", async () => {
    const fixture = await createIndexedContent("联想");

    const suggestions = await getJson(
      suggestRoute,
      `/api/search/suggest?q=${encodeURIComponent(fixture.interpreterTitle)}`,
    );
    expect(suggestions.status).toBe(200);
    const hits = suggestions.data.suggestions as { pageId: number; title: string; type: string }[];
    const ids = hits.map((hit) => hit.pageId);
    expect(ids).toContain(fixture.interpreterId);
    expect(ids).toContain(fixture.perspectiveId);
    expect(hits.length).toBeLessThanOrEqual(8);
  });

  it("空查询返回空结果", async () => {
    const empty = await getJson(searchRoute, "/api/search?q=");
    expect(empty.data).toEqual({ hits: [], total: 0, facets: {} });
  });
});

describe("索引故障隔离（ADR-0002：索引是可丢派生数据）", () => {
  it("索引写入失败不影响写路径：受理照常落库", async () => {
    resetSearchIndex();
    injectSearchIndex(
      Object.assign(new FakeSearchIndex(), {
        async upsert(): Promise<void> {
          throw new Error("meili down");
        },
      }),
    );

    const fixture = await createIndexedContent("故障");
    // PG 是真相：内容已落库，索引缺失只待全量校对
    expect(await getHeadRevisionId(fixture.perspectiveId)).not.toBeNull();
  });
});
