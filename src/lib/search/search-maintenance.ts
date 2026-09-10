import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { searchMaintenance } from "@/db/schema";
import { getSearchIndex, searchIsConfigured } from "@/lib/search/search-service";
import { Pool } from "pg";

const uid = () => process.env.MEILI_INDEX_UID || "pages";
const pools = new Map<string, Pool>();

// Transaction-scoped locks also cover CLI/admin entry points and disappear on crash.
// Incremental sync waits behind a rebuild before reading PG, so a stale snapshot
// cannot overwrite a newer increment. Different databases/indexes are independent.
export async function withSearchLock<T>(exclusive: boolean, work: () => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL ?? "";
  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000 });
    pool.on("error", () => {});
    pools.set(url, pool);
  }
  // A separate bounded pool prevents lock holders exhausting the content pool.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (exclusive) {
      const result = await client.query("select pg_try_advisory_xact_lock(406, hashtext($1)) as acquired", [uid()]);
      if (!result.rows[0]?.acquired) throw new Error("SEARCH_BUSY");
    } else {
      await client.query("set local lock_timeout = '15s'");
      await client.query("select pg_advisory_xact_lock_shared(406, hashtext($1))", [uid()]);
    }
    return await work();
  } finally {
    // Destroy rather than returning a possibly locked connection after an error.
    client.release(true);
  }
}

export async function recordSearchFailure(reindex = false): Promise<void> {
  try {
    const failure = { degraded: true, lastFailureAt: sql`clock_timestamp()`, ...(reindex ? { lastReindexResult: "failed" } : {}) };
    await getDb().insert(searchMaintenance).values({ indexUid: uid(), ...failure })
      .onConflictDoUpdate({ target: searchMaintenance.indexUid, set: failure });
  } catch {
    // Do not turn an already committed content write into an apparent failure.
    console.error("SEARCH_STATUS_WRITE_FAILED");
  }
}

export async function recordSearchReindex(startedAt: string): Promise<void> {
  const success = { degraded: false, lastReindexAt: new Date(), lastReindexResult: "success" };
  await getDb().insert(searchMaintenance).values({ indexUid: uid(), ...success })
    .onConflictDoUpdate({ target: searchMaintenance.indexUid, set: {
      ...success,
      // A timed-out increment may have committed content after our snapshot.
      // Compare in PG using its clock; a later failure always remains visible.
      degraded: sql`coalesce(${searchMaintenance.lastFailureAt} >= ${startedAt}::timestamptz, false)`,
    } });
}

export async function beginSearchReindex(): Promise<string> {
  const time = await getDb().execute(sql`select clock_timestamp()::text as started`);
  // Persist before replacing documents; a killed process must not look healthy.
  const running = { degraded: true, lastReindexResult: "running" };
  await getDb().insert(searchMaintenance).values({ indexUid: uid(), ...running })
    .onConflictDoUpdate({ target: searchMaintenance.indexUid, set: running });
  return String(time.rows[0].started);
}

export async function searchStatus() {
  const [row] = await getDb().select().from(searchMaintenance).where(eq(searchMaintenance.indexUid, uid()));
  let available = false;
  try {
    if (searchIsConfigured()) {
      await getSearchIndex().search("", { limit: 0 });
      available = true;
    }
  } catch { /* Expose no adapter messages, URLs or credentials. */ }
  return {
    available,
    degraded: row?.degraded ?? false,
    lastFailureAt: row?.lastFailureAt?.getTime() ?? 0,
    lastReindexAt: row?.lastReindexAt?.getTime() ?? 0,
    lastReindexResult: row?.lastReindexResult ?? "never",
  };
}
