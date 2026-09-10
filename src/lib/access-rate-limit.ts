import { getIP } from "better-auth/api";
import { auth } from "@/lib/auth";

// Match Better Auth's default production-only sensitive-route limit and IP
// resolution. Single-process memory storage matches the existing auth limiter.
const globalLimits = globalThis as typeof globalThis & { accessLimits?: Map<string, { start: number; count: number }> };
export function accessRetryAfter(req: Request): number | null {
  if (process.env.NODE_ENV !== "production") return null;
  const buckets = globalLimits.accessLimits ??= new Map();
  const now = Date.now();
  for (const [key, bucket] of buckets) if (now - bucket.start >= 10000) buckets.delete(key);
  const path = new URL(req.url).pathname;
  const candidate = `${path}:${getIP(req, auth.options) ?? "no-trusted-ip"}`;
  // Bound memory without evicting active buckets (which would permit bypass).
  const key = buckets.has(candidate) || buckets.size < 10000 ? candidate : `${path}:overflow`;
  const bucket = buckets.get(key) ?? { start: now, count: 0 };
  buckets.set(key, bucket);
  if (bucket.count >= 3) return Math.max(1, Math.ceil((bucket.start + 10000 - now) / 1000));
  bucket.count++;
  return null;
}
