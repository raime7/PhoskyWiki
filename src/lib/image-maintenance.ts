import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { images } from "@/db/schema";
import type { ObjectStore } from "./object-store";
import { stagingMaxAgeSeconds } from "./images";

/** Tombstones stay: a PUT started before signature expiry can finish after DELETE.
 * Revisit staging keys hourly. Never delete frozen objects, even unreferenced ones. */
export async function cleanupImageStaging(db: Db, store: ObjectStore, apply: boolean, batch: number) {
  const eligible = and(
    sql`${images.createdAt} < clock_timestamp() - ${stagingMaxAgeSeconds()} * interval '1 second'`,
    or(isNull(images.stagingCleanedAt), sql`${images.stagingCleanedAt} < clock_timestamp() - interval '1 hour'`),
  );
  const candidates = await db.select({ id: images.id }).from(images).where(eligible)
    .orderBy(sql`${images.stagingCleanedAt} NULLS FIRST`, images.createdAt, images.id).limit(batch);
  const result = { apply, candidates: candidates.length, processed: 0, objectsDeleted: 0, expiredUploads: 0, failed: 0, batchFull: candidates.length === batch };
  if (!apply) return result;
  for (const candidate of candidates) {
    try {
      const outcome = await db.transaction(async tx => {
        const [row] = await tx.select().from(images).where(and(eq(images.id, candidate.id), eligible)).for("update");
        if (!row) return null;
        const metadata = await store.head(row.stagingKey);
        await store.deleteStaging(row.stagingKey);
        await tx.update(images).set({ stagingCleanedAt: new Date(), ...(!row.objectKey ? { expiredAt: row.expiredAt ?? new Date() } : {}) }).where(eq(images.id, row.id));
        return { deleted: !!metadata, expired: !row.objectKey && !row.expiredAt };
      });
      if (outcome) {
        result.processed++;
        if (outcome.deleted) result.objectsDeleted++;
        if (outcome.expired) result.expiredUploads++;
      }
    } catch { result.failed++; }
  }
  return result;
}

export async function imageUsageReport(db: Db) {
  const usage = await db.execute(sql`
    SELECT COUNT(*) FILTER (WHERE object_key IS NOT NULL)::int AS "permanentImages",
      COALESCE(SUM(size) FILTER (WHERE object_key IS NOT NULL), 0)::text AS "permanentBytes",
      COUNT(*) FILTER (WHERE object_key IS NULL AND expired_at IS NULL)::int AS "pendingUploads",
      COALESCE(SUM(size) FILTER (WHERE object_key IS NULL AND expired_at IS NULL), 0)::text AS "reservedBytes",
      COUNT(*) FILTER (WHERE created_at < clock_timestamp() - ${stagingMaxAgeSeconds()} * interval '1 second' AND staging_cleaned_at IS NULL)::int AS "overdueStaging",
      COUNT(*) FILTER (WHERE expired_at IS NOT NULL)::int AS "expiredUploads"
    FROM images
  `);
  const rates = await db.execute(sql`SELECT kind, SUM(admitted)::text AS admitted, SUM(denied)::text AS denied FROM write_limits GROUP BY kind ORDER BY kind`);
  return { ...usage.rows[0], admissionTotals: rates.rows, providerBillingMeasured: false,
    costRisk: "Declared/frozen bytes only; signed PUT replays, oversized staging, orphan copies and provider request charges require R2 metrics and billing alerts." };
}
