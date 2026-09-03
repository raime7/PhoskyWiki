import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export type Db = NodePgDatabase<Record<string, never>>;

const globalForDb = globalThis as unknown as {
  phoskyDbs?: Map<string, Db>;
};

/**
 * 取一个按连接串缓存的 Drizzle 客户端。
 *
 * 缓存挂在 globalThis 上，避免 Next.js dev 热重载时反复建池泄漏连接；
 * 按连接串为键，测试可以指向别的数据库（或故意不可达的地址）。
 */
export function getDb(databaseUrl = process.env.DATABASE_URL): Db {
  const url = databaseUrl ?? "";
  globalForDb.phoskyDbs ??= new Map();

  let db = globalForDb.phoskyDbs.get(url);
  if (!db) {
    const pool = new Pool({
      connectionString: url,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
    });
    // 空闲连接被服务端中断（如 PG 重启）时池会抛 error 事件；
    // 不挂处理器会变成 uncaughtException 打挂进程——探活路由应如实报 down，而不是崩溃
    pool.on("error", () => {});
    db = drizzle(pool);
    globalForDb.phoskyDbs.set(url, db);
  }
  return db;
}
