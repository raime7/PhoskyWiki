import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { fixtureSignUp } from "./auth-fixture";
import { auth } from "@/lib/auth";
import { GET } from "@/app/api/site-catalog/route";
import { getDb } from "@/db";
import { seedDatabase } from "@/db/seed";
import { pages, perspectives, revisions, user } from "@/db/schema";
import type { SiteCatalog } from "@/lib/site-catalog";

beforeAll(async () => { await seedDatabase(); });
afterAll(async () => { await seedDatabase(); });

const accountIds: string[] = [];
afterAll(async () => {
  for (const id of accountIds) await getDb().delete(user).where(eq(user.id, id));
});

async function sessionCookie(): Promise<string> {
  const email = `catalog-${randomUUID()}@example.com`;
  const result = await fixtureSignUp({ body: { email, name: "目录编者", password: "password123" } });
  accountIds.push(result.user.id);
  const login = await auth.api.signInEmail({ body: { email, password: "password123" }, asResponse: true });
  return login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function catalog(cookie?: string): Promise<SiteCatalog> {
  const response = await GET(new Request("http://localhost/api/site-catalog", { headers: cookie ? { cookie } : {} }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json();
}

it("游客可读：在线词条（含别名）、诠释者、视角及其 head 修订", async () => {
  const data = await catalog();
  const [term] = await getDb().select().from(pages).where(and(eq(pages.type, "term"), eq(pages.title, "主体性")));
  expect(data.terms).toContainEqual(expect.objectContaining({ pageId: term.id, title: "主体性", slug: term.slug, aliases: expect.any(Array) }));
  expect(data.interpreters.length).toBeGreaterThan(0);
  const termPerspectives = await getDb().select().from(perspectives).where(eq(perspectives.termId, term.id));
  expect(termPerspectives.length).toBeGreaterThan(0);
  for (const p of termPerspectives) {
    const [head] = await getDb().select({ id: revisions.id }).from(revisions).where(eq(revisions.pageId, p.pageId)).orderBy(desc(revisions.id)).limit(1);
    expect(data.perspectives).toContainEqual({ pageId: p.pageId, termId: term.id, interpreterId: p.interpreterId, headRevisionId: head.id });
    expect(data.interpreters.map((i) => i.pageId)).toContain(p.interpreterId);
  }
});

it("软删除的词条及其视角不出现", async () => {
  const [term] = await getDb().select().from(pages).where(and(eq(pages.type, "term"), eq(pages.title, "主体性")));
  await getDb().update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, term.id));
  try {
    const data = await catalog();
    expect(data.terms.map((t) => t.pageId)).not.toContain(term.id);
    expect(data.perspectives.filter((p) => p.termId === term.id)).toEqual([]);
  } finally {
    await getDb().update(pages).set({ deletedAt: null }).where(eq(pages.id, term.id));
  }
});

it("已删除词条的标题只给登录的编者；游客响应没有该字段，也没有 id 与正文", async () => {
  const [term] = await getDb().select().from(pages).where(and(eq(pages.type, "term"), eq(pages.title, "主体性")));
  await getDb().update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, term.id));
  try {
    const guest = await catalog();
    expect("deletedTermTitles" in guest).toBe(false);
    const editor = await catalog(await sessionCookie());
    expect(editor.deletedTermTitles).toContain("主体性");
    expect(editor.terms.map((t) => t.pageId)).not.toContain(term.id);
  } finally {
    await getDb().update(pages).set({ deletedAt: null }).where(eq(pages.id, term.id));
  }
  expect((await catalog(await sessionCookie())).deletedTermTitles).not.toContain("主体性");
});
