import { appendFile, chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, rm, stat, statfs, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { parseArgs } from "node:util";
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";

class BackupError extends Error {}
function fail(code) { throw new BackupError(code); }

async function protectedJson(path) {
  if (!path) fail("CONFIG_REQUIRED");
  const info = await stat(path);
  if (!info.isFile() || info.size > 65536 || (process.platform !== "win32" && (info.mode & 0o077))) fail("CONFIG_PERMISSIONS");
  return JSON.parse(await readFile(path, "utf8"));
}

const magic = Buffer.from("PWBACKUP1");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

async function requireSpace(path, bytes) {
  const disk = await statfs(path);
  if (!Number.isFinite(bytes) || bytes + 256 * 1024 * 1024 > disk.bavail * disk.bsize) fail("STAGING_DISK_BUDGET");
}

function store(config) {
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".r2.cloudflarestorage.com") || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/" || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket) || !config.accessKeyId || !config.secretAccessKey) fail("R2_CONFIG");
  return new S3Client({ endpoint: endpoint.origin, region: "auto", credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
}

async function digest(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest("hex"), bytes };
}

async function seal(input, output, key, name) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(name));
  await writeFile(output, Buffer.concat([magic, iv]), { flag: "wx", mode: 0o600 });
  await pipeline(createReadStream(input), cipher, createWriteStream(output, { flags: "a" }));
  await appendFile(output, cipher.getAuthTag());
}

async function unseal(input, output, key, name) {
  const file = await open(input, "r");
  try {
    const { size } = await file.stat();
    if (size < magic.length + 28) fail("INTEGRITY_FAILED");
    const header = Buffer.alloc(magic.length + 12), tag = Buffer.alloc(16);
    await file.read(header, 0, header.length, 0);
    await file.read(tag, 0, tag.length, size - tag.length);
    if (!header.subarray(0, magic.length).equals(magic)) fail("INTEGRITY_FAILED");
    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(magic.length));
    decipher.setAAD(Buffer.from(name)); decipher.setAuthTag(tag);
    await pipeline(createReadStream(input, { start: header.length, end: size - 17 }), decipher, createWriteStream(output, { flags: "wx", mode: 0o600 }));
  } catch { fail("INTEGRITY_FAILED"); } finally { await file.close(); }
}

async function upload(client, bucket, name, path) {
  const { size } = await stat(path);
  if (size < 64 * 1024 * 1024) {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: name, Body: createReadStream(path), ContentLength: size, IfNoneMatch: "*", ContentType: "application/octet-stream" }));
    return;
  }
  const { UploadId } = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: name, ContentType: "application/octet-stream" }));
  const file = await open(path, "r");
  let complete = false;
  try {
    const parts = [];
    for (let offset = 0; offset < size; offset += 32 * 1024 * 1024) {
      const body = Buffer.alloc(Math.min(32 * 1024 * 1024, size - offset));
      let filled = 0;
      while (filled < body.length) {
        const { bytesRead } = await file.read(body, filled, body.length - filled, offset + filled);
        if (!bytesRead) fail("FILE_TRUNCATED");
        filled += bytesRead;
      }
      const result = await client.send(new UploadPartCommand({ Bucket: bucket, Key: name, UploadId, PartNumber: parts.length + 1, Body: body }));
      parts.push({ PartNumber: parts.length + 1, ETag: result.ETag });
    }
    await client.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: name, UploadId, MultipartUpload: { Parts: parts }, IfNoneMatch: "*" }));
    complete = true;
  } finally {
    await file.close();
    if (!complete) await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: name, UploadId }));
  }
}

async function download(client, bucket, name, output, limit = Infinity) {
  let object;
  try { object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: name })); }
  catch (error) { if (error.$metadata?.httpStatusCode === 404) fail("RECOVERY_FILE_MISSING"); fail("R2_READ_FAILED"); }
  if (object.ContentLength === undefined || object.ContentLength > limit) { object.Body.destroy(); fail("FILE_TOO_LARGE"); }
  try { await requireSpace(tmpdir(), object.ContentLength * 2); }
  catch (error) { object.Body.destroy(); throw error; }
  await pipeline(object.Body, createWriteStream(output, { flags: "wx", mode: 0o600 }));
  return object;
}

function pgCommand(command, args, database) {
  const env = { PATH: process.env.PATH, PGHOST: database.hostname, PGPORT: database.port || "5432", PGDATABASE: decodeURIComponent(database.pathname.slice(1)), PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password), PGCONNECT_TIMEOUT: "10" };
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", diagnostic = "";
    child.stdout.on("data", data => { if (output.length < 4096) output += data; });
    child.stderr.on("data", data => { if (diagnostic.length < 4096) diagnostic += data; });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 15 * 60 * 1000);
    child.on("error", () => { clearTimeout(timeout); reject(new BackupError("POSTGRES_TOOL_FAILED")); });
    child.on("close", code => {
      clearTimeout(timeout);
      if (code === 0) resolve(output.trim());
      else {
        const sqlstate = diagnostic.match(/ERROR:\s+([A-Z0-9]{5})(?:\s|$)/)?.[1];
        reject(new BackupError(`POSTGRES_TOOL_FAILED_${command.toUpperCase()}${sqlstate ? `_${sqlstate}` : ""}`));
      }
    });
  });
}

function poolFor(database) {
  return new pg.Pool({ host: database.hostname, port: Number(database.port || 5432), database: decodeURIComponent(database.pathname.slice(1)), user: decodeURIComponent(database.username), password: decodeURIComponent(database.password), max: 1, connectionTimeoutMillis: 10000 });
}

async function compatible(pool, config, database) {
  const version = Number((await pool.query("show server_version_num")).rows[0].server_version_num);
  if (version < 180000 || version >= 190000 || !/^[a-f0-9]{40}$/.test(config.appRevision)) fail("VERSION_MISMATCH");
  const dumpVersion = await pgCommand("pg_dump", ["--version"], database);
  if (!/^pg_dump \(PostgreSQL\) 18\./.test(dumpVersion)) fail("VERSION_MISMATCH");
  return { postgresMajor: 18, postgresVersion: version, dumpVersion };
}

async function createPoint(config, database, key, work, source, backup, target) {
  const point = randomUUID(), root = `${config.backup.prefix}${point}/`;
  const pool = poolFor(database);
  const files = [];
  let versions, migrations;
  try {
    versions = await compatible(pool, config, database);
    const databaseBytes = Number((await pool.query("select pg_database_size(current_database()) as bytes")).rows[0].bytes);
    await requireSpace(work, databaseBytes * 3);
    await pool.query("begin isolation level repeatable read read only");
    const snapshot = (await pool.query("select pg_export_snapshot() as snapshot")).rows[0].snapshot;
    migrations = (await pool.query("select hash, created_at from drizzle.__drizzle_migrations order by created_at")).rows;
    const images = (await pool.query("select distinct object_key from images where object_key is not null order by object_key")).rows;
    if (images.length >= 50000) fail("MANIFEST_TOO_LARGE");
    const dump = join(work, "database.dump");
    await pgCommand("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--snapshot=${snapshot}`, `--file=${dump}`], database);
    await pool.query("commit");
    files.push({ name: "database.enc", kind: "database", ...await digest(dump) });
    await seal(dump, join(work, "database.enc"), key, root + "database.enc");
    await upload(backup, config.backup.bucket, root + "database.enc", join(work, "database.enc")).catch(() => fail("R2_WRITE_FAILED"));
    await rm(dump); await rm(join(work, "database.enc"));
    for (const [index, image] of images.entries()) {
      const name = `image-${index}.enc`, plain = join(work, "image"), encrypted = join(work, name);
      const object = await download(source, config.source.bucket, image.object_key, plain);
      const checksum = await digest(plain);
      const storageKey = `${config.backup.prefix}images/${checksum.sha256}.enc`;
      let exists = true;
      try { await download(backup, config.backup.bucket, storageKey, encrypted, checksum.bytes + 64); }
      catch (error) { if (error instanceof BackupError && error.message === "RECOVERY_FILE_MISSING") exists = false; else throw error; }
      if (exists) {
        const reused = join(work, "reused-image");
        await unseal(encrypted, reused, key, storageKey);
        const actual = await digest(reused);
        if (actual.sha256 !== checksum.sha256 || actual.bytes !== checksum.bytes) fail("INTEGRITY_FAILED");
        await rm(reused);
      } else {
        await seal(plain, encrypted, key, storageKey);
        await upload(backup, config.backup.bucket, storageKey, encrypted).catch(() => fail("R2_WRITE_FAILED"));
      }
      files.push({ name, storageKey, kind: "image", sourceKey: image.object_key, contentType: object.ContentType || "application/octet-stream", ...checksum });
      await rm(plain); await rm(encrypted);
    }
    const manifest = { format: 1, point, createdAt: new Date().toISOString(), appRevision: config.appRevision, target, sourceBucket: config.source.bucket, ...versions, migrations, runtime: config.runtime, files };
    const plain = join(work, "manifest.json"), encrypted = join(work, "manifest.enc");
    await writeFile(plain, JSON.stringify(manifest), { flag: "wx", mode: 0o600 });
    if ((await stat(plain)).size > 16 * 1024 * 1024) fail("MANIFEST_TOO_LARGE");
    await seal(plain, encrypted, key, root + "manifest.enc");
    // Publishing this encrypted manifest is the commit of the recovery point.
    // Failed/incomplete uploads never have a success manifest.
    await upload(backup, config.backup.bucket, root + "manifest.enc", encrypted).catch(() => fail("R2_WRITE_FAILED"));
    return { point, files: files.length, plaintextBytes: files.reduce((sum, file) => sum + file.bytes, 0) };
  } finally { await pool.end(); }
}

async function verifiedPoint(config, point, key, work, backup, input) {
  if (!uuid.test(point || "")) fail("POINT_REQUIRED");
  const root = `${config.backup.prefix}${point}/`;
  async function readEncrypted(name, limit, storageKey = root + name) {
    if (!input) return download(backup, config.backup.bucket, storageKey, join(work, name), limit);
    const info = await lstat(join(input, name));
    if (!info.isFile() || info.size > limit) fail("RECOVERY_FILE_INVALID");
    await copyFile(join(input, name), join(work, name));
    await chmod(join(work, name), 0o600);
  }
  await readEncrypted("manifest.enc", 16 * 1024 * 1024 + 64);
  await unseal(join(work, "manifest.enc"), join(work, "manifest.json"), key, root + "manifest.enc");
  const manifest = JSON.parse(await readFile(join(work, "manifest.json"), "utf8"));
  if (manifest.format !== 1 || manifest.point !== point || manifest.postgresMajor !== 18 || manifest.appRevision !== config.appRevision || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 50000) fail("VERSION_MISMATCH");
  await requireSpace(work, manifest.files.reduce((sum, file) => sum + Number(file.bytes), 0) * 4);
  const names = new Set(), images = new Set();
  for (const file of manifest.files) {
    if (!/^(database|image-\d+)\.enc$/.test(file.name) || names.has(file.name) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) fail("MANIFEST_INVALID");
    if (file.kind === "database") { if (file.name !== "database.enc") fail("MANIFEST_INVALID"); }
    else if (file.kind === "image") {
      if (!/^image-\d+\.enc$/.test(file.name) || typeof file.sourceKey !== "string" || !file.sourceKey || file.sourceKey.length > 2048 || images.has(file.sourceKey) || typeof file.contentType !== "string") fail("MANIFEST_INVALID");
      images.add(file.sourceKey);
    } else fail("MANIFEST_INVALID");
    if (file.storageKey !== undefined && (file.kind !== "image" || file.storageKey !== `${config.backup.prefix}images/${file.sha256}.enc`)) fail("MANIFEST_INVALID");
    names.add(file.name);
    await readEncrypted(file.name, file.bytes + 64, file.storageKey);
    await unseal(join(work, file.name), join(work, `${file.name}.plain`), key, file.storageKey || root + file.name);
    const actual = await digest(join(work, `${file.name}.plain`));
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) fail("INTEGRITY_FAILED");
  }
  if (!names.has("database.enc")) fail("MANIFEST_INVALID");
  return manifest;
}

async function restorePoint(config, database, manifest, work, source) {
  if (!/_(test|restore(?:_[a-z0-9]+)?)$/.test(database.pathname) || !/-(test|restore)$/.test(config.source.bucket) || !/^[a-zA-Z0-9/_-]{1,128}\/$/.test(config.restorePrefix || "")) fail("RESTORE_TARGET_REQUIRED");
  const pool = poolFor(database);
  try {
    await compatible(pool, config, database);
    await pool.query("select pg_advisory_lock(hashtext('phoskywiki-restore'))");
    const namespaces = await pool.query("select 1 from pg_namespace where nspname !~ '^pg_' and nspname not in ('public','information_schema')");
    const relations = await pool.query("select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'");
    const functions = await pool.query("select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'");
    if (namespaces.rowCount || relations.rowCount || functions.rowCount) fail("RESTORE_TARGET_NOT_EMPTY");
    const existing = await source.send(new ListObjectsV2Command({ Bucket: config.source.bucket, Prefix: config.restorePrefix, MaxKeys: 1 }));
    if (existing.Contents?.length) fail("RESTORE_BUCKET_NOT_EMPTY");
    for (const file of manifest.files.filter(file => file.kind === "image")) {
      await source.send(new PutObjectCommand({ Bucket: config.source.bucket, Key: config.restorePrefix + file.sourceKey, Body: createReadStream(join(work, `${file.name}.plain`)), ContentLength: file.bytes, ContentType: file.contentType, IfNoneMatch: "*" }));
    }
    await pgCommand("pg_restore", ["--no-owner", "--no-privileges", `--file=${join(work, "restore.sql")}`, join(work, "database.enc.plain")], database);
    // psql wraps both the dump and the image-key remapping in one transaction.
    // restorePrefix is restricted above to characters without SQL metacharacters.
    await pgCommand("psql", ["-X", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=sqlstate", "--single-transaction", `--file=${join(work, "restore.sql")}`, "--command", `update public.images set object_key='${config.restorePrefix}' || object_key where object_key is not null`], database);
  } finally { await pool.end(); }
}

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { config: { type: "string" }, target: { type: "string" }, bucket: { type: "string" }, point: { type: "string" }, output: { type: "string" }, input: { type: "string" }, "key-file": { type: "string" } } });
  if (positionals.length !== 1 || !["create", "verify", "restore", "export", "recover-config"].includes(positionals[0])) fail("USAGE");
  const config = await protectedJson(values.config);
  const database = new URL(config.databaseUrl);
  if (!["postgres:", "postgresql:"].includes(database.protocol) || database.search || database.hash || !database.password || !database.username || !database.hostname || database.pathname.length < 2) fail("DATABASE_CONFIG");
  const target = `${database.hostname}:${database.port || "5432"}/${decodeURIComponent(database.pathname.slice(1))}/${decodeURIComponent(database.username)}`;
  if (values.target !== target) fail("TARGET_MISMATCH");
  if (values.bucket !== config.backup?.bucket) fail("BUCKET_MISMATCH");
  if (!/^[a-zA-Z0-9/_-]{1,128}\/$/.test(config.backup.prefix || "")) fail("BACKUP_PREFIX_REQUIRED");
  if (config.source.bucket === config.backup.bucket && !config.source.bucket.endsWith("-test")) fail("BUCKET_ISOLATION_REQUIRED");
  if (positionals[0] === "create" && (!config.runtime || typeof config.runtime !== "object" || Array.isArray(config.runtime) || !Object.keys(config.runtime).length)) fail("RUNTIME_CONFIG_REQUIRED");
  if (!values["key-file"]) fail("KEY_REQUIRED");
  const keyInfo = await stat(values["key-file"]);
  if (!keyInfo.isFile() || keyInfo.size !== 32 || (process.platform !== "win32" && (keyInfo.mode & 0o077))) fail("KEY_PERMISSIONS");
  const key = await readFile(values["key-file"]);
  const source = store(config.source), backup = store(config.backup);
  const work = await mkdtemp(join(tmpdir(), "phosky-backup-"));
  await chmod(work, 0o700);
  try {
    let result;
    if (positionals[0] === "create") result = await createPoint(config, database, key, work, source, backup, target);
    else {
      const manifest = await verifiedPoint(config, values.point, key, work, backup, values.input);
      if (positionals[0] === "recover-config") {
        if (!values.output || !manifest.runtime || typeof manifest.runtime !== "object") fail("CONFIG_OUTPUT_REQUIRED");
        await writeFile(values.output, JSON.stringify(manifest.runtime), { flag: "wx", mode: 0o600 });
      }
      if (positionals[0] === "restore") await restorePoint(config, database, manifest, work, source);
      if (positionals[0] === "export") {
        if (!values.output) fail("EXPORT_PATH_REQUIRED");
        await mkdir(values.output, { mode: 0o700 });
        for (const name of ["manifest.enc", ...manifest.files.map(file => file.name)]) await copyFile(join(work, name), join(values.output, name));
      }
      result = { point: manifest.point, files: manifest.files.length };
    }
    console.log(JSON.stringify({ ok: true, command: positionals[0], target, ...result, peakRssBytes: process.resourceUsage().maxRSS * 1024 }));
  } finally { source.destroy(); backup.destroy(); key.fill(0); await rm(work, { recursive: true, force: true }); }
}

main().catch(error => {
  const code = error instanceof BackupError ? error.message : "BACKUP_OPERATION_FAILED";
  console.error(code);
  process.exitCode = 1;
});
