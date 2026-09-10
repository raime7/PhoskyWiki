import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/** Invalid configuration fails closed instead of silently disabling a limit. */
export function limitSetting(name: string, fallback: number, maximum = 2_147_483_647) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error("INVALID_LIMIT_CONFIG");
  return value;
}

export class LimitError extends Error {
  constructor(public code: string, message: string, public retryAfter?: number) { super(message); }
}
export function limitResponse(error: LimitError) {
  return Response.json({ error: error.message, code: error.code }, { status: 429, headers: {
    "Cache-Control": "private, no-store", ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}),
  } });
}

/** One row per authenticated account + operation. PostgreSQL serializes the UPSERT
 * across processes; the window starts with the first attempt, using database time.
 * Denials commit too, so reports include rejected attempts without logging input. */
export async function writeLimitResponse(userId: string, kind: "write" | "upload" | "complete" = "write"): Promise<Response | null> {
  try {
    const defaults = { write: [60, 60], upload: [20, 3600], complete: [60, 60] } as const;
    const prefix = kind.toUpperCase();
    const count = limitSetting(`${prefix}_LIMIT_COUNT`, defaults[kind][0]);
    const seconds = limitSetting(`${prefix}_LIMIT_SECONDS`, defaults[kind][1]);
    const result = await getDb().execute<{ attempts: number; retry: number }>(sql`
      INSERT INTO write_limits (user_id, kind, window_start, attempts, admitted, denied)
      VALUES (${userId}, ${kind}, clock_timestamp(), 1, 1, 0)
      ON CONFLICT (user_id, kind) DO UPDATE SET
        window_start = CASE WHEN write_limits.window_start + ${seconds} * interval '1 second' <= clock_timestamp() THEN clock_timestamp() ELSE write_limits.window_start END,
        attempts = CASE WHEN write_limits.window_start + ${seconds} * interval '1 second' <= clock_timestamp() THEN 1 ELSE LEAST(write_limits.attempts, 2147483646) + 1 END,
        admitted = write_limits.admitted + CASE WHEN write_limits.window_start + ${seconds} * interval '1 second' <= clock_timestamp() OR write_limits.attempts < ${count} THEN 1 ELSE 0 END,
        denied = write_limits.denied + CASE WHEN write_limits.window_start + ${seconds} * interval '1 second' > clock_timestamp() AND write_limits.attempts >= ${count} THEN 1 ELSE 0 END
      RETURNING attempts, GREATEST(1, CEIL(EXTRACT(EPOCH FROM window_start + ${seconds} * interval '1 second' - clock_timestamp())))::int AS retry
    `);
    const row = result.rows[0];
    return row.attempts > count ? limitResponse(new LimitError(`${kind}_rate`, "操作过于频繁，请稍后重试", row.retry)) : null;
  } catch {
    return Response.json({ error: "写入限额服务暂不可用，请稍后重试" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
