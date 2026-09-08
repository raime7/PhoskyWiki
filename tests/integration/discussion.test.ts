// T13 讨论区（主缝 = route handlers 直调 + lib 组合）：词条级楼层 + 一层嵌套回复、
// 游客只读/编者可发言（权限验收）、视角锚点、版务软删/锁定、讨论帖进搜索索引
// （FakeSearchIndex 注入，真 Meili 由契约测试覆盖）。
// 种子自灌；测试用户按 email 删除（discussion_posts.author_id 无级联，先清楼层）。

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as createPostRoute } from "@/app/api/discussion/posts/route";
import { DELETE as deletePostRoute } from "@/app/api/discussion/posts/[postId]/route";
import { POST as lockRoute } from "@/app/api/admin/discussion/[termId]/lock/route";
import { DELETE as unlockRoute } from "@/app/api/admin/discussion/[termId]/lock/route";
import { POST as pageActionRoute } from "@/app/api/admin/pages/[pageId]/route";
import { auth } from "@/lib/auth";
import { seedDatabase } from "@/db/seed";
import { getDb } from "@/db";
import { discussionPosts, pages, termDiscussions, user } from "@/db/schema";
import {
  countDiscussionPosts,
  DISCUSSION_CONTENT_MAX_LENGTH,
  isDiscussionLocked,
  listDiscussionFloors,
} from "@/lib/discussion";
import { listTerms } from "@/lib/content";
import { FakeSearchIndex } from "@/lib/search/fake-index";
import { injectSearchIndex, resetSearchIndex } from "@/lib/search/search-service";
import { reindexAll } from "@/lib/search/search-sync";
import { discussionDocId, searchHitHref } from "@/lib/search/search-types";

interface TestUser {
  id: string;
  cookie: string;
}

const createdEmails: string[] = [];
let admin: TestUser;
let editor: TestUser;
let index: FakeSearchIndex;

async function createUser(role: "editor" | "admin", name: string): Promise<TestUser> {
  const email = `t13-${randomUUID()}@example.com`;
  createdEmails.push(email);
  const password = "t13-pass-123";
  const signUp = await auth.api.signUpEmail({ body: { name, email, password } });
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

async function termIdByTitle(title: string): Promise<number> {
  const term = (await listTerms()).find((row) => row.title === title);
  if (!term) throw new Error(`种子缺少词条：${title}`);
  return term.id;
}

/** 「主体性」下拉康视角的 page id（种子里固定存在）。 */
async function lacanPerspectiveId(): Promise<number> {
  const floors = await getDb().select().from(pages).where(eq(pages.title, "拉康论主体性"));
  if (floors.length === 0) throw new Error("种子缺少视角：拉康论主体性");
  return floors[0].id;
}

function postRequest(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/discussion/posts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

function deleteRequest(postId: number, cookie?: string): Request {
  return new Request(`http://localhost/api/discussion/posts/${postId}`, {
    method: "DELETE",
    headers: cookie === undefined ? {} : { cookie },
  });
}

function lockRequest(termId: number, lock: boolean, cookie?: string): Request {
  return new Request(`http://localhost/api/admin/discussion/${termId}/lock`, {
    method: lock ? "POST" : "DELETE",
    headers: cookie === undefined ? {} : { cookie },
  });
}

/** 动态路由 handler 直调需要 ctx.params（其余静态路由只传 Request）。 */
async function callDelete(postId: number, cookie?: string): Promise<Response> {
  return deletePostRoute(deleteRequest(postId, cookie), {
    params: Promise.resolve({ postId: String(postId) }),
  });
}

async function callLock(termId: number, lock: boolean, cookie?: string): Promise<Response> {
  const handler = lock ? lockRoute : unlockRoute;
  return handler(lockRequest(termId, lock, cookie), {
    params: Promise.resolve({ termId: String(termId) }),
  });
}

/** 经主缝发帖（默认以 editor 身份；null = 游客），返回 { status, data }。 */
async function postFloor(
  body: Record<string, unknown>,
  cookie: string | null = editor.cookie,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await createPostRoute(postRequest(body, cookie ?? undefined));
  return {
    status: res.status,
    data: res.status === 204 ? {} : ((await res.json()) as Record<string, unknown>),
  };
}

beforeAll(async () => {
  await seedDatabase();
  admin = await createUser("admin", "T13 管理员");
  editor = await createUser("editor", "T13 编者");
});

beforeEach(async () => {
  const db = getDb();
  await db.delete(discussionPosts);
  await db.delete(termDiscussions);
  index = new FakeSearchIndex();
  injectSearchIndex(index);
});

afterAll(async () => {
  resetSearchIndex();
  const db = getDb();
  const testIds = (
    await db.select({ id: user.id }).from(user).where(inArray(user.email, createdEmails))
  ).map((row) => row.id);
  // 测试用户创建的楼层没有 user 级联，先清掉再删号
  if (testIds.length > 0) {
    await db.delete(discussionPosts).where(inArray(discussionPosts.authorId, testIds));
    await db.delete(user).where(inArray(user.id, testIds));
  }
});

describe("POST /api/discussion/posts（发言权限与校验）", () => {
  it("游客 401（只读），不落任何楼层", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const res = await postFloor({ termId: subjectivity, content: "游客想发言" }, null);
    expect(res.status).toBe(401);
    expect(await countDiscussionPosts(subjectivity)).toBe(0);
  });

  it("编者发楼层 201；内容 trim 后落库；计数与列表可见", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const res = await postFloor({
      termId: subjectivity,
      content: "  这个词条的拉康视角值得展开  ",
    });
    expect(res.status).toBe(201);
    const postId = res.data.id as number;
    expect(postId).toBeGreaterThan(0);

    expect(await countDiscussionPosts(subjectivity)).toBe(1);
    const floors = await listDiscussionFloors(subjectivity);
    expect(floors).toHaveLength(1);
    expect(floors[0].content).toBe("这个词条的拉康视角值得展开");
    expect(floors[0].deleted).toBe(false);
    expect(floors[0].replies).toEqual([]);
  });

  it("空内容或超长内容 400", async () => {
    const subjectivity = await termIdByTitle("主体性");
    expect((await postFloor({ termId: subjectivity, content: "   " })).status).toBe(400);
    expect(
      (await postFloor({ termId: subjectivity, content: "字".repeat(DISCUSSION_CONTENT_MAX_LENGTH + 1) })).status,
    ).toBe(400);
  });

  it("词条不存在或已软删除 404", async () => {
    expect((await postFloor({ termId: 999_999, content: "无的放矢" })).status).toBe(404);
    expect((await postFloor({ termId: "abc", content: "非法 id" })).status).toBe(400);
  });
});

describe("一层嵌套回复", () => {
  it("对楼层的回复 201 并嵌套在其下；「回复的回复」400；回复不计入楼层数", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const floor = await postFloor({ termId: subjectivity, content: "开个楼" });
    const reply = await postFloor({
      termId: subjectivity,
      parentId: floor.data.id,
      content: "一层回复",
    });
    expect(reply.status).toBe(201);
    // 楼层数只数顶层开楼（与讨论区页内「N 楼」编号同口径）
    expect(await countDiscussionPosts(subjectivity)).toBe(1);

    const nested = await postFloor({
      termId: subjectivity,
      parentId: reply.data.id,
      content: "想再套一层",
    });
    expect(nested.status).toBe(400);

    const floors = await listDiscussionFloors(subjectivity);
    expect(floors).toHaveLength(1);
    expect(floors[0].replies.map((r) => r.content)).toEqual(["一层回复"]);
  });

  it("跨讨论区回复 400；回复已删除楼层 400", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const alienation = await termIdByTitle("异化");
    const floor = await postFloor({ termId: subjectivity, content: "本区楼层" });

    const cross = await postFloor({
      termId: alienation,
      parentId: floor.data.id,
      content: "跨区回复",
    });
    expect(cross.status).toBe(400);

    const deleted = await callDelete(floor.data.id as number, admin.cookie);
    expect(deleted.status).toBe(204);
    const toDeleted = await postFloor({
      termId: subjectivity,
      parentId: floor.data.id,
      content: "回复已删楼层",
    });
    expect(toDeleted.status).toBe(400);
  });
});

describe("视角锚点", () => {
  it("锚点必须指向该词条的在线视角：本词条视角 201，他词条视角 400", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const lacan = await lacanPerspectiveId();
    // 异化 的拉康？种子里没有；取 异化 下任意视角（马克思论异化）
    const alienationPerspective = (
      await getDb().select().from(pages).where(eq(pages.title, "马克思论异化"))
    )[0].id;

    const ok = await postFloor({
      termId: subjectivity,
      perspectiveId: lacan,
      content: "就拉康的视角讨论",
    });
    expect(ok.status).toBe(201);
    expect(ok.data.perspectiveId).toBe(lacan);

    const wrongTerm = await postFloor({
      termId: subjectivity,
      perspectiveId: alienationPerspective,
      content: "锚点不属于本词条",
    });
    expect(wrongTerm.status).toBe(400);

    const floors = await listDiscussionFloors(subjectivity);
    expect(floors[0].perspective?.title).toBe("拉康论主体性");
    expect(floors[0].perspective?.live).toBe(true);
  });

  it("锚点只能随顶层楼层：回复携带锚点 400", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const lacan = await lacanPerspectiveId();
    const floor = await postFloor({ termId: subjectivity, content: "开楼" });
    const res = await postFloor({
      termId: subjectivity,
      parentId: floor.data.id,
      perspectiveId: lacan,
      content: "带锚点的回复",
    });
    expect(res.status).toBe(400);
  });

  it("软删除的视角不能作锚点 400", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const lacan = await lacanPerspectiveId();
    // 直接软删除视角页（复用管理员页面操作路由，测试末恢复）
    const res = await pageActionRoute(
      new Request(`http://localhost/api/admin/pages/${lacan}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin.cookie },
        body: JSON.stringify({ action: "delete" }),
      }),
      { params: Promise.resolve({ pageId: String(lacan) }) },
    );
    expect(res.status).toBe(200);
    try {
      const anchored = await postFloor({
        termId: subjectivity,
        perspectiveId: lacan,
        content: "锚到已删视角",
      });
      expect(anchored.status).toBe(400);
    } finally {
      await pageActionRoute(
        new Request(`http://localhost/api/admin/pages/${lacan}`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: admin.cookie },
          body: JSON.stringify({ action: "restore" }),
        }),
        { params: Promise.resolve({ pageId: String(lacan) }) },
      );
    }
  });
});

describe("版务：软删楼层与锁定讨论", () => {
  it("游客 401、编者 403、管理员 204；软删后渲染占位、正文不外发", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const floor = await postFloor({ termId: subjectivity, content: "待删的楼层" });
    const postId = floor.data.id as number;

    expect((await callDelete(postId)).status).toBe(401);
    expect((await callDelete(postId, editor.cookie)).status).toBe(403);

    const deleted = await callDelete(postId, admin.cookie);
    expect(deleted.status).toBe(204);
    // 幂等：重复删除仍 204；不存在 404
    expect((await callDelete(postId, admin.cookie)).status).toBe(204);
    expect((await callDelete(999_999, admin.cookie)).status).toBe(404);

    const floors = await listDiscussionFloors(subjectivity);
    expect(floors).toHaveLength(1);
    expect(floors[0].deleted).toBe(true);
    expect(floors[0].content).toBe("");
    expect(await countDiscussionPosts(subjectivity)).toBe(0);
  });

  it("锁定讨论区：编者与管理员都不能发言；解锁后恢复", async () => {
    const subjectivity = await termIdByTitle("主体性");
    expect((await callLock(subjectivity, true)).status).toBe(401);
    expect((await callLock(subjectivity, true, editor.cookie)).status).toBe(403);

    expect((await callLock(subjectivity, true, admin.cookie)).status).toBe(204);
    expect(await isDiscussionLocked(subjectivity)).toBe(true);
    expect((await postFloor({ termId: subjectivity, content: "编辑想发言" })).status).toBe(403);
    expect(
      (await postFloor({ termId: subjectivity, content: "管理员也被锁" }, admin.cookie)).status,
    ).toBe(403);

    expect((await callLock(subjectivity, false, admin.cookie)).status).toBe(204);
    expect(await isDiscussionLocked(subjectivity)).toBe(false);
    expect((await postFloor({ termId: subjectivity, content: "解锁后恢复" })).status).toBe(201);
  });

  it("锁定不存在的词条 404", async () => {
    expect((await callLock(999_999, true, admin.cookie)).status).toBe(404);
  });
});

describe("讨论帖进搜索索引（派生索引，ADR-0002）", () => {
  it("发楼即 upsert（type=discussion、偏移主键、slug 为词条 pageKey）；命中 href 指向讨论区楼层锚点", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const lacan = await lacanPerspectiveId();
    const res = await postFloor({
      termId: subjectivity,
      perspectiveId: lacan,
      content: "齐泽克对拉康的读法同样值得收录",
    });
    expect(res.status).toBe(201);
    const postId = res.data.id as number;

    const doc = index.docs.get(discussionDocId(postId));
    expect(doc).toMatchObject({ type: "discussion", body: "齐泽克对拉康的读法同样值得收录" });
    expect(doc?.title).toBe("「主体性」的讨论");

    // 纯词唯一，直接命中
    const hit = (await index.search("齐泽克")).hits[0];
    expect(hit.type).toBe("discussion");
    expect(searchHitHref(hit)).toBe(
      `/term/${doc?.slug}/discussion#floor-${postId}`,
    );
  });

  it("软删楼层即从索引移除", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const floor = await postFloor({ termId: subjectivity, content: "即将被删除的索引内容" });
    const postId = floor.data.id as number;
    expect(index.has(discussionDocId(postId))).toBe(true);

    expect((await callDelete(postId, admin.cookie)).status).toBe(204);
    expect(index.has(discussionDocId(postId))).toBe(false);
  });

  it("词条软删除连带其讨论楼层出索引；恢复后回来（与读路径同口径）", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const floor = await postFloor({ termId: subjectivity, content: "随词条沉浮的楼层" });
    const postId = floor.data.id as number;
    expect(index.has(discussionDocId(postId))).toBe(true);

    const deleteTerm = await pageActionRoute(
      new Request(`http://localhost/api/admin/pages/${subjectivity}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin.cookie },
        body: JSON.stringify({ action: "delete" }),
      }),
      { params: Promise.resolve({ pageId: String(subjectivity) }) },
    );
    expect(deleteTerm.status).toBe(200);
    expect(index.has(discussionDocId(postId))).toBe(false);

    const restoreTerm = await pageActionRoute(
      new Request(`http://localhost/api/admin/pages/${subjectivity}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin.cookie },
        body: JSON.stringify({ action: "restore" }),
      }),
      { params: Promise.resolve({ pageId: String(subjectivity) }) },
    );
    expect(restoreTerm.status).toBe(200);
    expect(index.has(discussionDocId(postId))).toBe(true);
  });

  it("全量校对重灌包含讨论楼层", async () => {
    const alienation = await termIdByTitle("异化");
    const floor = await postFloor({ termId: alienation, content: "全量校对的样本楼层" });
    const postId = floor.data.id as number;

    // 人为制造漂移（清空索引），reindexAll 修复
    await index.replaceAll([]);
    expect(index.has(discussionDocId(postId))).toBe(false);

    const { indexed } = await reindexAll();
    expect(index.has(discussionDocId(postId))).toBe(true);
    expect(indexed).toBeGreaterThan(0);
  });
});
