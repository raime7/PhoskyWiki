import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { seedAdminAccount } from "@/db/seed-admin";
import { fixtureSignUp } from "./auth-fixture";

const email = `recovery-${randomUUID()}@example.com`;
const password = "original-recovery-123";
const replacement = "replacement-recovery-456";
let directory: string;
let credentials: string;
let id: string;
let oldCookie: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "phosky-recovery-test-"));
  credentials = join(directory, "password.json");
  await writeFile(credentials, JSON.stringify({ password: replacement }), { mode: 0o600 });
  await seedAdminAccount({ email, password });
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  id = (await response.json()).user.id;
  oldCookie = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
});
afterAll(async () => {
  await getDb().delete(user).where(eq(user.email, email));
  if (directory) await rm(directory, { recursive: true });
});
function command(overrides: string[] = []) {
  const url = new URL(process.env.DATABASE_URL!);
  const target = `${url.hostname}:${url.port || "5432"}/${decodeURIComponent(url.pathname.slice(1))}/${decodeURIComponent(url.username)}`;
  return new Promise<{ code: number; output: string }>(resolve => {
    execFile(process.execPath, ["--conditions=react-server", "--import=tsx", "scripts/production.ts", "recover-admin", "--target", target, "--environment", "test", "--user-id", id, "--email", email, "--credentials", credentials, ...overrides],
      { env: { ...process.env, PHOSKYWIKI_ENV: "test" }, timeout: 20000 },
      (error, stdout, stderr) => resolve({ code: error ? 1 : 0, output: stdout + stderr }));
  });
}
it("错误环境、数据库目标、邮箱和非管理员在修改前失败", async () => {
  const other = await fixtureSignUp({ body: { name: "普通编者", email: `recovery-editor-${randomUUID()}@example.com`, password } });
  try {
    for (const args of [["--environment", "production"], ["--target", "wrong"], ["--email", "wrong@example.com"], ["--user-id", other.user.id, "--email", other.user.email]]) {
      const result = await command(args);
      expect(result.code).toBe(1);
      expect(result.output).not.toContain(replacement);
      expect((await auth.api.signInEmail({ body: { email, password } })).user.id).toBe(id);
      expect((await auth.api.signInEmail({ body: { email: other.user.email, password } })).user.role).toBe("editor");
    }
  } finally { await getDb().delete(user).where(eq(user.id, other.user.id)); }
}, 30000);
it("真实维护进程只恢复明确管理员并撤销旧会话，输出无密码", async () => {
  const result = await command();
  expect(result.code, result.output).toBe(0);
  expect(result.output).toContain('"recovered":true');
  expect(result.output).not.toContain(password);
  expect(result.output).not.toContain(replacement);
  await expect(auth.api.signInEmail({ body: { email, password } })).rejects.toMatchObject({ statusCode: 401 });
  expect((await auth.api.signInEmail({ body: { email, password: replacement } })).user).toMatchObject({ id, role: "admin" });
  expect(await auth.api.getSession({ headers: new Headers({ cookie: oldCookie }) })).toBeNull();
}, 30000);
