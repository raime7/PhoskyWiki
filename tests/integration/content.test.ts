// 读路径数据层集成测试：连真实 PG（docker），种子自灌（幂等）。
// 注意：seedDatabase 会 TRUNCATE 内容表——同批并行的测试文件不得依赖既有内容行
//（healthz 只碰 pg_extension 与探活路由，不受影响）。T04 的反链/消歧义/置顶
// 测试也放在本文件：共享同一份种子，避免并行 TRUNCATE 互踩。

import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DELETE, POST } from "@/app/api/admin/perspectives/[pageId]/pin/route";
import { auth } from "@/lib/auth";
import { seedDatabase } from "@/db/seed";
import { seedAdminAccount } from "@/db/seed-admin";
import { getDb } from "@/db";
import { links, pages, terms, user } from "@/db/schema";
import {
  getDisambiguationDetail,
  getHeadContent,
  getInterpreterDetail,
  getLivePage,
  getPerspectiveDetail,
  getTermDisambiguation,
  getWikiLinkTargets,
  listBacklinks,
  listPerspectivesOfInterpreter,
  listPerspectivesOfTerm,
  listTerms,
} from "@/lib/content";
import { setPerspectivePinned } from "@/lib/pinning";
import { pagePath } from "@/lib/slug";

beforeAll(async () => {
  await seedDatabase();
});

// 便捷取种子里词条的 id（不硬编码数据库自增 id）
async function termIdByTitle(title: string): Promise<number> {
  const all = await listTerms();
  const term = all.find((t) => t.title === title);
  if (!term) throw new Error(`种子缺少词条：${title}`);
  return term.id;
}

describe("种子完整性（T02 验收：≥3 词条、≥3 诠释者、≥4 视角、跨词条双链 + 红链）", () => {
  it("词条 ≥3 且带简介与视角数", async () => {
    const all = await listTerms();
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const term of all) {
      expect(term.summary.length).toBeGreaterThan(0);
      expect(term.perspectiveCount).toBeGreaterThan(0);
    }
    expect(all.map((t) => t.title)).toContain("主体性");
  });

  it("视角 ≥4：主体性 词条下编委会通俗视角 + 多个诠释者视角", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const perspectives = await listPerspectivesOfTerm(subjectivity);
    expect(perspectives.length).toBeGreaterThanOrEqual(4);
    expect(perspectives[0].isBoard).toBe(true);
    expect(perspectives[0].interpreterName).toBe("编委会");
    const titles = perspectives.map((p) => p.title);
    expect(titles).toContain("拉康论主体性");
    expect(titles).toContain("福柯论主体性");
  });

  it("每个视角都有 head 修订内容（Markdown 源文本）", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const perspectives = await listPerspectivesOfTerm(subjectivity);
    for (const p of perspectives) {
      const content = await getHeadContent(p.pageId);
      expect(content?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it("跨词条双链已解析落 page_id，未创建词条为红链（target 为空 + 名称快照）", async () => {
    const db = getDb();
    const resolvedCount = await db.$count(links, isNotNull(links.targetPageId));
    const redCount = await db.$count(links, isNull(links.targetPageId));
    expect(resolvedCount).toBeGreaterThanOrEqual(10);
    expect(redCount).toBeGreaterThanOrEqual(1);

    // 拉康论主体性：意识形态/异化 已解析，镜像阶段 红链
    const subjectivity = await termIdByTitle("主体性");
    const lacan = (await listPerspectivesOfTerm(subjectivity)).find(
      (p) => p.interpreterName === "拉康",
    )!;
    const targets = await getWikiLinkTargets(lacan.pageId);

    const ideology = targets.get("意识形态")!;
    expect(ideology.exists).toBe(true);
    expect(ideology.href).toBe(pagePath("term", "意识形态", await termIdByTitle("意识形态")));

    expect(targets.get("异化")!.exists).toBe(true);
    expect(targets.get("镜像阶段")).toEqual({ href: "", exists: false });
  });

  it("视角排序：编委会第一，其余按引用热度（links 统计）降序、并列按创建序", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const perspectives = await listPerspectivesOfTerm(subjectivity);
    expect(perspectives[0].isBoard).toBe(true);
    expect(perspectives.slice(1).every((p) => !p.isBoard)).toBe(true);

    const rest = perspectives.slice(1).map((p) => p.linkCount);
    for (let i = 1; i < rest.length; i++) {
      expect(rest[i - 1]).toBeGreaterThanOrEqual(rest[i]);
    }
  });

  it("视角排序：被站内双链引用的视角排在同词条其他视角之前", async () => {
    const db = getDb();
    const subjectivity = await termIdByTitle("主体性");
    const perspectives = await listPerspectivesOfTerm(subjectivity);
    const byTitle = new Map(perspectives.map((p) => [p.title, p]));
    const source = byTitle.get("拉康论主体性")!;
    const hot = byTitle.get("德勒兹论主体性")!; // 种子里引用数为 0

    // 造一条指向德勒兹视角的入链，使其与种子里已有 1 条引用的阿尔都塞视角并列
    await db.insert(links).values({
      sourcePageId: source.pageId,
      targetPageId: hot.pageId,
      targetName: `德勒兹论主体性-${hot.pageId}`,
    });
    try {
      const reordered = await listPerspectivesOfTerm(subjectivity);
      expect(reordered[0].isBoard).toBe(true);
      // 并列热度 1，按创建序：阿尔都塞（种子早于新增入链目标）在前
      expect(reordered[1].title).toBe("阿尔都塞论主体性");
      expect(reordered[2].title).toBe("德勒兹论主体性");
      expect(reordered[2].linkCount).toBe(1);
      expect(reordered.slice(3).map((p) => p.linkCount)).toEqual(
        reordered.slice(3).map(() => 0),
      );
    } finally {
      await db
        .delete(links)
        .where(eq(links.targetPageId, hot.pageId));
    }
  });
});

describe("页面解析与软删除", () => {
  it("getLivePage 返回在线页面；软删除后不可见", async () => {
    const db = getDb();
    const [fixture] = await db
      .insert(pages)
      .values({
        type: "term",
        title: "测试词条（集成自建）",
        slug: "ce-shi-ci-tiao",
        deletedAt: new Date(),
      })
      .returning({ id: pages.id });
    await db.insert(terms).values({ pageId: fixture.id, summary: "" });

    try {
      expect(await getLivePage(fixture.id)).toBeNull();
      expect((await listTerms()).map((t) => t.title)).not.toContain(
        "测试词条（集成自建）",
      );

      // 恢复（清除标记）后可见，再验证在线路径
      await db.update(pages).set({ deletedAt: null }).where(eq(pages.id, fixture.id));
      const live = await getLivePage(fixture.id);
      expect(live?.title).toBe("测试词条（集成自建）");
      expect((await listTerms()).map((t) => t.title)).toContain("测试词条（集成自建）");
    } finally {
      await db.delete(pages).where(eq(pages.id, fixture.id));
    }
  });

  it("类型不匹配的详情查询返回 null", async () => {
    const subjectivity = await termIdByTitle("主体性");
    expect(await getPerspectiveDetail(subjectivity)).toBeNull();
    expect(await getInterpreterDetail(subjectivity)).toBeNull();
    expect(await getDisambiguationDetail(subjectivity)).toBeNull();
  });
});

describe("诠释者轴读路径", () => {
  it("诠释者详情 + 全部视角索引", async () => {
    const db = getDb();
    const [lacanPage] = await db
      .select({ id: pages.id, slug: pages.slug })
      .from(pages)
      .where(eq(pages.title, "拉康"))
      .limit(1);

    const detail = await getInterpreterDetail(lacanPage.id);
    expect(detail?.birthYear).toBe(1901);
    expect(detail?.deathYear).toBe(1981);
    expect(detail?.isBoard).toBe(false);

    const index = await listPerspectivesOfInterpreter(lacanPage.id);
    expect(index.map((p) => p.title)).toEqual(["拉康论主体性"]);
    expect(index[0].termTitle).toBe("主体性");

    // 拉康论主体性 的详情反向联到词条与诠释者
    const perspectiveDetail = await getPerspectiveDetail(index[0].pageId);
    expect(perspectiveDetail?.termTitle).toBe("主体性");
    expect(perspectiveDetail?.interpreterName).toBe("拉康");
  });

  it("编委会是特殊诠释者", async () => {
    const db = getDb();
    const [boardPage] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.title, "编委会"))
      .limit(1);
    const detail = await getInterpreterDetail(boardPage.id);
    expect(detail?.isBoard).toBe(true);
    // 编委会对每个词条（含两个「价值」词条）都有通俗视角
    expect((await listPerspectivesOfInterpreter(boardPage.id)).length).toBe(6);
  });
});

describe("反链面板（T04：词条页与视角页共用 links 直查）", () => {
  it("词条反链 = 引用该词条的视角列表，含所属词条上下文", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const backlinks = await listBacklinks(subjectivity);

    const titles = backlinks.map((b) => b.title);
    expect(titles).toContain("编委会论异化");
    expect(titles).toContain("黑格尔论异化");
    expect(titles).toContain("编委会论价值（哲学）");
    for (const item of backlinks) {
      expect(item.termTitle.length).toBeGreaterThan(0);
      // 反链项可寻址：视角页与所属词条页路径都能生成
      expect(pagePath("perspective", item.slug, item.pageId)).toMatch(/\/perspective\//);
      expect(pagePath("term", item.termSlug, item.termId)).toMatch(/\/term\//);
    }
  });

  it("视角反链 = 显式视角语法的入链（词条@诠释者 键落视角 page_id）", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const althusser = (await listPerspectivesOfTerm(subjectivity)).find(
      (p) => p.title === "阿尔都塞论主体性",
    )!;
    const backlinks = await listBacklinks(althusser.pageId);

    expect(backlinks.map((b) => b.title)).toEqual(["阿尔都塞论意识形态"]);
    expect(backlinks[0].termTitle).toBe("意识形态");

    // 落库形态：阿尔都塞论意识形态 的 links 里，显式键已解析到视角页
    const targets = await getWikiLinkTargets(backlinks[0].pageId);
    expect(targets.get("主体性@阿尔都塞")).toEqual({
      href: pagePath("perspective", althusser.slug, althusser.pageId),
      exists: true,
    });
  });

  it("红链的显式视角语法：诠释者不存在时 target 为空、键保留名称快照", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const lacan = (await listPerspectivesOfTerm(subjectivity)).find(
      (p) => p.interpreterName === "拉康",
    )!;
    const targets = await getWikiLinkTargets(lacan.pageId);
    expect(targets.get("主体性@德里达")).toEqual({ href: "", exists: false });
  });

  it("软删除的引用方不进反链；恢复后重新出现", async () => {
    const db = getDb();
    const subjectivity = await termIdByTitle("主体性");
    const before = await listBacklinks(subjectivity);
    const source = before.find((b) => b.title === "编委会论异化")!;
    expect(source).toBeDefined();

    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, source.pageId));
    try {
      expect(
        (await listBacklinks(subjectivity)).some((b) => b.pageId === source.pageId),
      ).toBe(false);
    } finally {
      await db.update(pages).set({ deletedAt: null }).where(eq(pages.id, source.pageId));
    }
    expect(
      (await listBacklinks(subjectivity)).some((b) => b.pageId === source.pageId),
    ).toBe(true);
  });
});

describe("消歧义（T04：同名多义词条经基准名分流）", () => {
  it("种子双义示例：「价值」聚合两个括号限定词条", async () => {
    const db = getDb();
    const [disambigPage] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.type, "disambiguation"), eq(pages.title, "价值")))
      .limit(1);
    expect(disambigPage).toBeDefined();

    const detail = await getDisambiguationDetail(disambigPage.id);
    expect(detail?.members.map((m) => m.title)).toEqual([
      "价值（哲学）",
      "价值（政治经济学）",
    ]);
    for (const member of detail!.members) {
      expect(member.summary.length).toBeGreaterThan(0);
      expect(member.perspectiveCount).toBe(1);
    }
    // 分流页有自己的导语修订
    expect((await getHeadContent(disambigPage.id))?.length).toBeGreaterThan(20);
  });

  it("括号限定词条反查所属消歧义页；无限定段词条没有", async () => {
    expect(await getTermDisambiguation("价值（政治经济学）")).toMatchObject({
      title: "价值",
    });
    expect(await getTermDisambiguation("价值（哲学）")).toMatchObject({
      title: "价值",
    });
    expect(await getTermDisambiguation("主体性")).toBeNull();
  });

  it("恰好以基准名为题的词条不是分流成员（主词条，不是待分流项）", async () => {
    const db = getDb();
    const [disambigPage] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.type, "disambiguation"), eq(pages.title, "价值")))
      .limit(1);
    const [bareTerm] = await db
      .insert(pages)
      .values({ type: "term", title: "价值", slug: "jia-zhi" })
      .returning({ id: pages.id });
    await db.insert(terms).values({ pageId: bareTerm.id, summary: "主词条" });
    try {
      const detail = await getDisambiguationDetail(disambigPage.id);
      expect(detail?.members.map((m) => m.title)).not.toContain("价值");
      expect(detail?.members.map((m) => m.title)).toEqual([
        "价值（哲学）",
        "价值（政治经济学）",
      ]);
    } finally {
      await db.delete(pages).where(eq(pages.id, bareTerm.id));
    }
  });

  it("指向基准名的双链落消歧义页（分流入口）", async () => {
    const db = getDb();
    const [disambigPage] = await db
      .select({ id: pages.id, slug: pages.slug })
      .from(pages)
      .where(eq(pages.title, "价值"))
      .limit(1);

    // 剩余价值-编委会 正文里的 [[价值]] 已解析到消歧义页
    const surplus = await termIdByTitle("剩余价值");
    const board = (await listPerspectivesOfTerm(surplus)).find((p) => p.isBoard)!;
    const targets = await getWikiLinkTargets(board.pageId);
    expect(targets.get("价值")).toEqual({
      href: pagePath("disambiguation", disambigPage.slug, disambigPage.id),
      exists: true,
    });
  });
});

describe("视角置顶（T04：通俗 → 置顶 → 热度）", () => {
  it("置顶视角紧随通俗视角，取消置顶恢复纯热度序", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const foucault = (await listPerspectivesOfTerm(subjectivity)).find(
      (p) => p.title === "福柯论主体性",
    )!;
    expect(foucault.pinned).toBe(false);

    try {
      expect(await setPerspectivePinned(foucault.pageId, true)).toBe(true);
      let ordered = await listPerspectivesOfTerm(subjectivity);
      expect(ordered[0].isBoard).toBe(true);
      expect(ordered[1].title).toBe("福柯论主体性");
      expect(ordered[1].pinned).toBe(true);
      // 置顶之后仍是热度序（阿尔都塞 1 条引用在前）
      expect(ordered[2].title).toBe("阿尔都塞论主体性");
      expect(ordered.slice(2).every((p) => !p.pinned)).toBe(true);

      expect(await setPerspectivePinned(foucault.pageId, false)).toBe(true);
      ordered = await listPerspectivesOfTerm(subjectivity);
      expect(ordered[0].isBoard).toBe(true);
      expect(ordered[1].title).toBe("阿尔都塞论主体性");
      expect(ordered.every((p) => !p.pinned)).toBe(true);
    } finally {
      await setPerspectivePinned(foucault.pageId, false);
    }
  });

  it("非视角页与不存在页返回 false", async () => {
    const subjectivity = await termIdByTitle("主体性");
    expect(await setPerspectivePinned(subjectivity, true)).toBe(false);
    expect(await setPerspectivePinned(999_999, true)).toBe(false);
  });
});

// 管理员置顶 API（主缝 = route handlers 直调）。准入走 T05 会话角色：
// 未登录 401、editor 403、admin 放行。
describe("POST/DELETE /api/admin/perspectives/:pageId/pin", () => {
  const createdEmails: string[] = [];

  afterAll(async () => {
    // 级联清掉 account/session；user 行按 email 删（内容表种子不碰 user 表）
    const db = getDb();
    for (const email of createdEmails) {
      await db.delete(user).where(eq(user.email, email));
    }
  });

  // 建号 + 登录，把响应的 Set-Cookie 拼成 Cookie 头（cookie 名随 better-auth
  // 配置走，不硬编码）。route handler 直调时 Request 上只有这个头可携带会话。
  async function loginCookie(role: "editor" | "admin", password: string): Promise<string> {
    const email = `t04-pin-${randomUUID()}@example.com`;
    createdEmails.push(email);
    if (role === "admin") {
      await seedAdminAccount({ email, password });
    } else {
      await auth.api.signUpEmail({ body: { name: "测试编者", email, password } });
    }
    const res = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    return res.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  }

  function pinRequest(pageId: string, method: "POST" | "DELETE", cookie?: string) {
    return new Request(`http://localhost/api/admin/perspectives/${pageId}/pin`, {
      method,
      headers: cookie === undefined ? {} : { cookie },
    });
  }

  async function orderOfSubjectivity(): Promise<string[]> {
    const subjectivity = await termIdByTitle("主体性");
    return (await listPerspectivesOfTerm(subjectivity)).map((p) => p.title);
  }

  async function foucaultPageId(): Promise<number> {
    const subjectivity = await termIdByTitle("主体性");
    const foucault = (await listPerspectivesOfTerm(subjectivity)).find(
      (p) => p.title === "福柯论主体性",
    )!;
    return foucault.pageId;
  }

  it("未登录（无会话 cookie）401，不做任何变更", async () => {
    const pageId = String(await foucaultPageId());
    const res = await POST(pinRequest(pageId, "POST"), {
      params: Promise.resolve({ pageId }),
    });
    expect(res.status).toBe(401);
    expect((await orderOfSubjectivity())[1]).not.toBe("福柯论主体性");
  });

  it("editor 会话 403；admin 会话置顶/取消置顶生效", async () => {
    const editorCookie = await loginCookie("editor", "editor-pass-123");
    const adminCookie = await loginCookie("admin", "admin-pass-123");
    const pageId = String(await foucaultPageId());
    const ctx = { params: Promise.resolve({ pageId }) };

    const forbidden = await POST(pinRequest(pageId, "POST", editorCookie), ctx);
    expect(forbidden.status).toBe(403);
    expect((await orderOfSubjectivity())[1]).not.toBe("福柯论主体性");

    try {
      const ok = await POST(pinRequest(pageId, "POST", adminCookie), ctx);
      expect(ok.status).toBe(204);
      expect((await orderOfSubjectivity())[1]).toBe("福柯论主体性");

      const undone = await DELETE(pinRequest(pageId, "DELETE", adminCookie), ctx);
      expect(undone.status).toBe(204);
      expect((await orderOfSubjectivity())[1]).not.toBe("福柯论主体性");
    } finally {
      await setPerspectivePinned(Number(pageId), false);
    }
  });

  it("admin 会话下：非视角页 404；非法 id 400", async () => {
    const adminCookie = await loginCookie("admin", "admin-pass-123");
    const subjectivity = await termIdByTitle("主体性");
    const termRes = await POST(pinRequest(String(subjectivity), "POST", adminCookie), {
      params: Promise.resolve({ pageId: String(subjectivity) }),
    });
    expect(termRes.status).toBe(404);

    const badRes = await POST(pinRequest("abc", "POST", adminCookie), {
      params: Promise.resolve({ pageId: "abc" }),
    });
    expect(badRes.status).toBe(400);
  });
});

// 软删除对读路径计数的影响（ADR-0003 #7 回归）：
// 软删除的视角不得计入任何计数——词条视角数、消歧义成员计数、热度引用数。
describe("软删除视角不出现在任何计数里", () => {
  async function termRow(title: string) {
    const row = (await listTerms()).find((t) => t.title === title);
    if (!row) throw new Error(`种子缺少词条：${title}`);
    return row;
  }

  it("词条视角数（首页列表）与消歧义成员的 perspectiveCount 不含软删除视角", async () => {
    const db = getDb();
    const title = "价值（哲学）";
    const before = await termRow(title);
    expect(before.perspectiveCount).toBeGreaterThanOrEqual(1);

    // 成员本体（词条页）在线，软删除的只是它的视角页
    const disambiguation = await getTermDisambiguation(title);
    expect(disambiguation).not.toBeNull();

    const livePageIds = (await listPerspectivesOfTerm(before.id)).map((p) => p.pageId);
    try {
      await db
        .update(pages)
        .set({ deletedAt: new Date() })
        .where(inArray(pages.id, livePageIds));

      expect((await termRow(title)).perspectiveCount).toBe(0);

      const members = (await getDisambiguationDetail(disambiguation!.id))!.members;
      expect(members.map((m) => m.title)).toContain(title);
      expect(members.find((m) => m.title === title)!.perspectiveCount).toBe(0);
    } finally {
      await db
        .update(pages)
        .set({ deletedAt: null })
        .where(inArray(pages.id, livePageIds));
    }
  });

  it("热度 linkCount 不含软删除引用方的双链（与反链面板同一口径）", async () => {
    const db = getDb();
    const subjectivity = await termIdByTitle("主体性");
    const foucaultBefore = (await listPerspectivesOfTerm(subjectivity)).find(
      (p) => p.title === "福柯论主体性",
    )!;

    // 两个在线夹具视角页各发一条指向福柯视角的双链：热度 +2
    const fixtureIds: number[] = [];
    try {
      for (let i = 0; i < 2; i++) {
        const [fixture] = await db
          .insert(pages)
          .values({
            type: "perspective",
            title: `热度夹具（软删除回归）${i}`,
            slug: `heat-fixture-${Date.now()}-${i}`,
          })
          .returning({ id: pages.id });
        fixtureIds.push(fixture.id);
        await db.insert(links).values({
          sourcePageId: fixture.id,
          targetPageId: foucaultBefore.pageId,
          targetName: `主体性@福柯-${i}`,
        });
      }
      const heated = (await listPerspectivesOfTerm(subjectivity)).find(
        (p) => p.title === "福柯论主体性",
      )!;
      expect(heated.linkCount).toBe(foucaultBefore.linkCount + 2);

      // 软删除一个引用方：它的双链立刻不再加热——软删除页不给别人加热
      await db
        .update(pages)
        .set({ deletedAt: new Date() })
        .where(eq(pages.id, fixtureIds[0]!));
      const cooled = (await listPerspectivesOfTerm(subjectivity)).find(
        (p) => p.title === "福柯论主体性",
      )!;
      expect(cooled.linkCount).toBe(foucaultBefore.linkCount + 1);
    } finally {
      if (fixtureIds.length > 0) {
        await db.delete(links).where(inArray(links.sourcePageId, fixtureIds));
        await db.delete(pages).where(inArray(pages.id, fixtureIds));
      }
    }
  });
});
