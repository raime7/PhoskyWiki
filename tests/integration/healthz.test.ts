import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { GET } from "@/app/healthz/route";
import { getDb } from "@/db";

describe("GET /healthz", () => {
  it("PG 可达时返回 200 与 postgres: up", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      checks: { postgres: "up" },
    });
  });

  it("PG 不可达时返回 503 与 postgres: down", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://phosky:phosky@127.0.0.1:1/phoskywiki");
    try {
      const { GET: freshGET } = await import("@/app/healthz/route");
      const res = await freshGET();

      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toMatchObject({
        status: "error",
        checks: { postgres: "down" },
      });
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("Drizzle 迁移管道", () => {
  it("迁移已应用到真实 PG（示例迁移 pg_trgm 在库中）", async () => {
    const result = await getDb().execute<{ extname: string }>(
      sql`select extname from pg_extension where extname = 'pg_trgm'`,
    );

    expect(result.rows.map((row) => row.extname)).toContain("pg_trgm");
  });
});
