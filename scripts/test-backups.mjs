// Explicit opt-in: this exercises real Docker/PostgreSQL and a dedicated R2 bucket.
import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const settings = JSON.parse(readFileSync(process.env.BACKUP_CONTRACT_CONFIG, "utf8"));
assert(settings.bucket.endsWith("-test"), "A dedicated -test bucket is required");
const image = process.env.BACKUP_CONTRACT_IMAGE;
assert(image, "BACKUP_CONTRACT_IMAGE required");
const id = randomUUID();
const network = `backup-test-${id}`;
const directory = mkdtempSync(join(tmpdir(), "phosky-backup-contract-"));
const sourceKey = `contract/${id}/source/image.png`;
const prefix = `contract/${id}/points/`;
const bytes = Buffer.from("independent image byte fixture");
const s3 = new S3Client({ endpoint: settings.endpoint, region: "auto", credentials: settings });
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sql = query => docker("exec", network, "psql", "-U", "test", "-d", "wiki_test", "-At", "-c", query).trim();
const config = { databaseUrl: "postgres://test:test@pg:5432/wiki_test", appRevision: "a".repeat(40), runtime: { BETTER_AUTH_URL: "https://fixture.invalid" }, source: { ...settings }, backup: { ...settings, prefix }, restorePrefix: `contract/${id}/restored/` };
writeFileSync(join(directory, "config.json"), JSON.stringify(config), { mode: 0o600 });
writeFileSync(join(directory, "key"), randomBytes(32), { mode: 0o600 });
const run = (command, args = []) => {
  const result = spawnSync("docker", ["run", "--rm", "--network", network, "--user", "0:0", "-v", `${directory}:/config`, image, command, "--config", "/config/config.json", "--key-file", "/config/key", "--target", "pg:5432/wiki_test/test", "--bucket", settings.bucket, ...args], { encoding: "utf8", timeout: 120000 });
  return { code: result.status, out: result.stdout, error: result.stderr };
};
try {
  docker("network", "create", network);
  docker("run", "-d", "--name", network, "--network", network, "--network-alias", "pg", "-e", "POSTGRES_USER=test", "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=wiki_test", process.env.BACKUP_CONTRACT_POSTGRES_IMAGE || "postgres:18.3-alpine3.23@sha256:54451ecb8ab38c24c3ec123f2fd501303a3a1856a5c66e98cecf2460d5e1e9d7");
  for (let attempts = 0; ; attempts++) {
    try { sql("select 1"); break; } catch { if (attempts > 30) throw Error("PostgreSQL startup failed"); await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  sql(`create table images(object_key text); insert into images values ('${sourceKey}'); create table content(body text); insert into content values ('preserved content and revisions'); create schema drizzle; create table drizzle.__drizzle_migrations(hash text,created_at bigint); insert into drizzle.__drizzle_migrations values ('fixture-migration',1)`);
  await s3.send(new PutObjectCommand({ Bucket: settings.bucket, Key: sourceKey, Body: bytes, ContentType: "image/png" }));
  const created = run("create");
  assert.equal(created.code, 0, created.error);
  const point = JSON.parse(created.out).point;
  assert.match(point, /^[a-f0-9-]{36}$/);
  assert.equal(run("verify", ["--point", point]).code, 0);
  const second = run("create");
  assert.equal(second.code, 0, second.error);
  const shared = await s3.send(new ListObjectsV2Command({ Bucket: settings.bucket, Prefix: `${prefix}images/` }));
  assert.equal(shared.Contents.length, 1, "Unchanged image must be reused across recovery points");
  sql("insert into images select 'count-boundary/' || n from generate_series(1,49999) n");
  assert.match(run("create").error, /MANIFEST_TOO_LARGE/);
  sql("delete from images where object_key like 'count-boundary/%'");
  const originalKey = readFileSync(join(directory, "key"));
  writeFileSync(join(directory, "key"), randomBytes(32));
  assert.match(run("verify", ["--point", point]).error, /INTEGRITY_FAILED/);
  writeFileSync(join(directory, "key"), originalKey);
  const databaseKey = `${prefix}${point}/database.enc`;
  const stored = await s3.send(new GetObjectCommand({ Bucket: settings.bucket, Key: databaseKey }));
  const encrypted = Buffer.from(await stored.Body.transformToByteArray());
  const corrupt = Buffer.from(encrypted); corrupt[30] ^= 1;
  await s3.send(new PutObjectCommand({ Bucket: settings.bucket, Key: databaseKey, Body: corrupt }));
  assert.match(run("verify", ["--point", point]).error, /INTEGRITY_FAILED/);
  await s3.send(new PutObjectCommand({ Bucket: settings.bucket, Key: databaseKey, Body: encrypted }));
  const imageKey = `${prefix}images/${createHash("sha256").update(bytes).digest("hex")}.enc`;
  const savedImage = await s3.send(new GetObjectCommand({ Bucket: settings.bucket, Key: imageKey }));
  const encryptedImage = Buffer.from(await savedImage.Body.transformToByteArray());
  await s3.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: imageKey }));
  assert.match(run("verify", ["--point", point]).error, /RECOVERY_FILE_MISSING/);
  await s3.send(new PutObjectCommand({ Bucket: settings.bucket, Key: imageKey, Body: encryptedImage }));
  writeFileSync(join(directory, "config.json"), JSON.stringify({ ...config, appRevision: "b".repeat(40) }));
  assert.match(run("verify", ["--point", point]).error, /VERSION_MISMATCH/);
  writeFileSync(join(directory, "config.json"), JSON.stringify({ ...config, backup: { ...config.backup, secretAccessKey: "0".repeat(64) } }));
  assert.equal(run("create").code, 1, "Failed upload must not report success");
  const recoveryObjects = await s3.send(new ListObjectsV2Command({ Bucket: settings.bucket, Prefix: prefix }));
  assert.equal(recoveryObjects.Contents.filter(object => object.Key.endsWith("/manifest.enc")).length, 2);
  writeFileSync(join(directory, "config.json"), JSON.stringify(config));
  assert.equal(run("export", ["--point", point, "--output", "/config/export"]).code, 0);
  writeFileSync(join(directory, "config.json"), JSON.stringify({ ...config, backup: { ...config.backup, secretAccessKey: "0".repeat(64) } }));
  assert.equal(run("verify", ["--point", point, "--input", "/config/export"]).code, 0, "Export must verify without downloading R2 objects");
  assert.equal(run("recover-config", ["--point", point, "--input", "/config/export", "--output", "/config/recovered-runtime.json"]).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "recovered-runtime.json"))), config.runtime);
  writeFileSync(join(directory, "config.json"), JSON.stringify(config));
  assert.equal(run("restore", ["--point", point]).code, 1, "Existing database must not be overwritten");
  await s3.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: sourceKey }));
  sql("drop schema public cascade; create schema public; drop schema drizzle cascade");
  const restored = run("restore", ["--point", point]);
  assert.equal(restored.code, 0, restored.error);
  assert.equal(sql("select body from content"), "preserved content and revisions");
  const restoredKey = sql("select object_key from images");
  const read = await s3.send(new GetObjectCommand({ Bucket: settings.bucket, Key: restoredKey }));
  assert.deepEqual(Buffer.from(await read.Body.transformToByteArray()), bytes);
  console.log(JSON.stringify({ ok: true, realPostgres: true, realR2: true, restoreDataAndImages: true, overwriteRefused: true, wrongKeyRefused: true, corruptFileRefused: true, missingImageRefused: true, incompatibleVersionRefused: true, failedUploadNotPublished: true, independentImageCopy: true, incrementalImageReuse: true, oversizedManifestRefused: true, runtimeRecovered: true, offlineExportVerified: true }));
} finally {
  // Only this run's UUID namespace and explicitly named test container/network.
  try { docker("rm", "-f", network); } catch { /* creation may have failed */ }
  try { docker("network", "rm", network); } catch { /* creation may have failed */ }
  let continuation;
  do {
    const objects = await s3.send(new ListObjectsV2Command({ Bucket: settings.bucket, Prefix: `contract/${id}/`, ContinuationToken: continuation }));
    if (objects.Contents?.length) await s3.send(new DeleteObjectsCommand({ Bucket: settings.bucket, Delete: { Objects: objects.Contents.map(object => ({ Key: object.Key })) } }));
    continuation = objects.NextContinuationToken;
  } while (continuation);
  s3.destroy();
  rmSync(directory, { recursive: true, force: true });
}
