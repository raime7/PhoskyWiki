import { beforeAll, expect, it } from "vitest";
import { GET } from "@/app/api/agent/context/route";
import { seedDatabase } from "@/db/seed";
import { listTerms } from "@/lib/content";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { interpreters, links, pages, perspectives, revisions, terms } from "@/db/schema";
import type { AgentContext } from "@/lib/agent/types";

beforeAll(async () => { await seedDatabase(); });

it("游客可读取当前词条及双链邻居的已发布渲染文本与引用地址", async () => {
  const term = (await listTerms()).find((t) => t.title === "主体性")!;
  const response = await GET(new Request(`http://localhost/api/agent/context?termId=${term.id}`));
  expect(response.status).toBe(200);
  const context = await response.json();
  expect(context.termId).toBe(term.id);
  expect(context.sources).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: "主体性", type: "term", url: `/term/主体性-${term.id}` }),
    expect.objectContaining({ title: "拉康论主体性", type: "perspective", text: expect.stringContaining("主体") }),
    expect.objectContaining({ title: "意识形态", type: "term" }),
  ]));
  const lacan = context.sources.find((s: { title: string }) => s.title === "拉康论主体性");
  expect(lacan.text).not.toContain("[[");
  expect(lacan.text).not.toContain("<p>");
  expect(lacan.url).toMatch(/^\/perspective\//);
});

it("上下文恰好扩展一跳，包含入链及精确视角出链，排除红链、旧修订和软删除内容", async () => {
  const db = getDb();
  const created: number[] = [];
  async function page(type: "term" | "interpreter" | "perspective", title: string) {
    const [row] = await db.insert(pages).values({ type, title, slug: "agent-fixture" }).returning();
    created.push(row.id);
    return row.id;
  }
  const thinker = await page("interpreter", "上下文诠释者");
  await db.insert(interpreters).values({ pageId: thinker });
  const ids: number[] = [], perspectiveIds: number[] = [];
  try {
    for (const title of ["起点", "出链邻居", "入链邻居", "二跳", "已删除邻居"]) {
      const id = await page("term", `Agent测试${title}`);
      ids.push(id);
      await db.insert(terms).values({ pageId: id, summary: title });
      const perspectiveId = await page("perspective", `诠释${title}`);
      perspectiveIds.push(perspectiveId);
      await db.insert(perspectives).values({ pageId: perspectiveId, termId: id, interpreterId: thinker });
      await db.insert(revisions).values({ pageId: perspectiveId, content: "旧修订不应出现" });
      await db.insert(revisions).values({ pageId: perspectiveId, content: "# 标题\n\n**可见** & 文本 [[出链邻居]]\n\n<script>隐藏脚本</script>" });
    }
    await db.insert(links).values([
      { sourcePageId: perspectiveIds[0], targetPageId: perspectiveIds[1], targetName: "出链邻居" },
      { sourcePageId: perspectiveIds[2], targetPageId: ids[0], targetName: "起点" },
      { sourcePageId: perspectiveIds[1], targetPageId: ids[3], targetName: "二跳" },
      { sourcePageId: perspectiveIds[0], targetPageId: ids[4], targetName: "已删除邻居" },
      { sourcePageId: perspectiveIds[0], targetPageId: null, targetName: "红链" },
    ]);
    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, ids[4]));
    const read = async () => GET(new Request(`http://localhost/api/agent/context?termId=${ids[0]}`));
    let context: AgentContext = await (await read()).json();
    expect(context.sources.filter((s) => s.type === "term").map((s) => s.id)).toEqual(ids.slice(0, 3));
    expect(context.sources.find((s) => s.id === perspectiveIds[0])?.text).toBe("标题\n\n可见 & 文本 出链邻居");
    expect(JSON.stringify(context)).not.toContain("旧修订");
    expect(JSON.stringify(context)).not.toContain("隐藏脚本");
    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, perspectiveIds[1]));
    context = await (await read()).json();
    expect(context.sources.some((s) => s.termId === ids[1])).toBe(false);
    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, thinker));
    context = await (await read()).json();
    expect(context.sources.map((s) => s.id)).toEqual([ids[0]]);
    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, ids[0]));
    expect((await read()).status).toBe(404);
  } finally { await db.delete(pages).where(inArray(pages.id, created)); }
});

it("非法、缺失及非词条 id 不返回上下文", async () => {
  for (const value of ["", "-1", "NaN", "1.5", "2147483648", "9007199254740992"]) {
    expect((await GET(new Request(`http://localhost/api/agent/context?termId=${value}`))).status).toBe(400);
  }
  expect((await GET(new Request("http://localhost/api/agent/context?termId=2147483647"))).status).toBe(404);
});
