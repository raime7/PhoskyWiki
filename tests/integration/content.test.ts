// 读路径数据层集成测试：连真实 PG（docker），种子自灌（幂等）。
// 注意：seedDatabase 会 TRUNCATE 内容表——同批并行的测试文件不得依赖既有内容行
//（healthz 只碰 pg_extension 与探活路由，不受影响）。

import { eq, isNotNull, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { seedDatabase } from "@/db/seed";
import { getDb } from "@/db";
import { links, pages, terms } from "@/db/schema";
import {
  getHeadContent,
  getInterpreterDetail,
  getLivePage,
  getPerspectiveDetail,
  getWikiLinkTargets,
  listPerspectivesOfInterpreter,
  listPerspectivesOfTerm,
  listTerms,
} from "@/lib/content";
import { pagePath } from "@/lib/slug";

beforeAll(async () => {
  await seedDatabase();
});

// 便捷取种子里「主体性」词条的 id（不硬编码数据库自增 id）
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
    const hot = byTitle.get("德勒兹论主体性")!; // 种子里引用数为 0，排最末

    // 造一条指向德勒兹视角的入链（显式视角语法的等价落库形态，T03 写路径前置）
    await db.insert(links).values({
      sourcePageId: source.pageId,
      targetPageId: hot.pageId,
      targetName: `德勒兹论主体性-${hot.pageId}`,
    });
    try {
      const reordered = await listPerspectivesOfTerm(subjectivity);
      expect(reordered[0].isBoard).toBe(true);
      expect(reordered[1].title).toBe("德勒兹论主体性");
      expect(reordered[1].linkCount).toBe(1);
      expect(reordered.slice(2).map((p) => p.linkCount)).toEqual(
        reordered.slice(2).map(() => 0),
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
    // 编委会对每个词条都有通俗视角
    expect((await listPerspectivesOfInterpreter(boardPage.id)).length).toBe(4);
  });
});
