import { beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET } from "@/app/api/editor/catalog/route";
import { getDb } from "@/db";
import { seedDatabase } from "@/db/seed";
import { pages } from "@/db/schema";

beforeAll(async () => { await seedDatabase(); });

it("编辑器目录解析词条、显式视角和消歧义，过滤软删除目标", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  const catalog = await response.json();
  expect(catalog.terms).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: "主体性" }),
    expect.objectContaining({ title: "价值" }),
  ]));
  expect(catalog.targets).toEqual(expect.arrayContaining([
    { key: "主体性", href: expect.stringMatching(/^\/term\//) },
    { key: "主体性@拉康", href: expect.stringMatching(/^\/perspective\//) },
    { key: "价值", href: expect.stringMatching(/^\/disambiguation\//) },
  ]));
  await getDb().update(pages).set({ deletedAt: new Date() }).where(eq(pages.title, "主体性"));
  try {
    const hidden = await (await GET()).json();
    expect(hidden.terms.some((term: { title: string }) => term.title === "主体性")).toBe(false);
    expect(hidden.targets.some((target: { key: string }) => target.key === "主体性" || target.key.startsWith("主体性@"))).toBe(false);
  } finally {
    await getDb().update(pages).set({ deletedAt: null }).where(eq(pages.title, "主体性"));
  }
});
