// No dotenv: operations require an explicit environment and matching targets.
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { cleanupImageStaging, imageUsageReport } from "../src/lib/image-maintenance";
import { getObjectStore } from "../src/lib/object-store";

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    environment: { type: "string" }, target: { type: "string" }, bucket: { type: "string" },
    endpoint: { type: "string" }, apply: { type: "boolean", default: false }, batch: { type: "string", default: "500" },
  } });
  if (positionals.length !== 1 || !["usage", "cleanup"].includes(positionals[0])) throw new Error();
  if (!values.environment || values.environment !== process.env.PHOSKYWIKI_ENV) throw new Error();
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.search || url.hash || !url.hostname || !url.username || !url.password || url.pathname.length < 2) throw new Error();
  const database = decodeURIComponent(url.pathname.slice(1));
  const username = decodeURIComponent(url.username);
  if (values.target !== `${url.hostname}:${url.port || "5432"}/${database}/${username}`) throw new Error();
  const batch = Number(values.batch);
  if (!Number.isInteger(batch) || batch < 1 || batch > 10000 || (positionals[0] === "usage" && values.apply)) throw new Error();
  if (positionals[0] === "cleanup" && (!values.bucket || values.bucket !== process.env.R2_BUCKET || !values.endpoint || values.endpoint !== process.env.R2_ENDPOINT)) throw new Error();
  const pool = new Pool({ host: url.hostname, port: Number(url.port || 5432), database, user: username, password: decodeURIComponent(url.password), max: 1, connectionTimeoutMillis: 5000 });
  try {
    const identity = (await pool.query("SELECT current_database() AS database, current_user AS username")).rows[0];
    if (identity.database !== database || identity.username !== username) throw new Error();
    const db = drizzle(pool);
    const cleanup = positionals[0] === "cleanup" ? await cleanupImageStaging(db, getObjectStore(), values.apply, batch) : undefined;
    console.log(JSON.stringify({ ok: !cleanup?.failed, usage: await imageUsageReport(db), ...(cleanup ? { cleanup } : {}) }));
    if (cleanup?.failed) process.exitCode = 1;
  } finally { await pool.end(); }
}
main().catch(() => {
  console.log(JSON.stringify({ ok: false, error: "IMAGE_MAINTENANCE_FAILED: verify configuration, target and service availability" }));
  process.exitCode = 1;
});
