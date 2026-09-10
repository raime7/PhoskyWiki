import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "@/db";
import { images, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { POST as presign } from "@/app/api/images/route";
import { POST as complete, GET as read } from "@/app/api/images/[id]/route";
import { injectObjectStore } from "@/lib/object-store";
import { FakeObjectStore } from "../fakes/object-store";
import { fixtureSignUp } from "./auth-fixture";

const execute = promisify(execFile);
async function run(args: string[], overrides: Partial<NodeJS.ProcessEnv> = {}) {
  try {
    const result = await execute(process.execPath, ["--conditions=react-server", "--import=tsx", "scripts/images.ts", ...args], { env: { ...process.env, ...overrides } });
    return { code: 0, report: JSON.parse(result.stdout) };
  } catch (error) {
    const result = error as { code: number; stdout: string };
    return { code: result.code, report: JSON.parse(result.stdout) };
  }
}
it("图片维护进程连接前拒绝错误环境/目标，错误报告不包含凭据", async () => {
  const result = await run(["cleanup", "--environment", "test", "--target", "wrong", "--bucket", "images-test", "--apply"], {
    PHOSKYWIKI_ENV: "test", DATABASE_URL: "postgres://user:secret-must-not-appear@localhost:1/wiki_test",
    R2_BUCKET: "images-test", R2_SECRET_ACCESS_KEY: "secret-must-not-appear",
  });
  expect(result).toEqual({ code: 1, report: { ok: false, error: "IMAGE_MAINTENANCE_FAILED: verify configuration, target and service availability" } });
});

it("维护进程仅清理过期暂存，保留永久私图与新上传，重复运行和过期完成安全", async () => {
  const store = new FakeObjectStore(); injectObjectStore(store);
  const server = createServer(async (req, res) => {
    const key = new URL(req.url!, "http://localhost").pathname.replace(/^\/images-test\//, "");
    if (req.method === "HEAD") {
      const value = await store.head(key);
      res.writeHead(value ? 200 : 404, value ? { "content-length": value.size, "content-type": value.contentType, etag: value.etag } : {}); res.end();
    } else if (req.method === "DELETE") {
      try { await store.deleteStaging(key); res.writeHead(204); } catch { res.writeHead(403); }
      res.end();
    } else { res.writeHead(400); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const email = `cleanup-${randomUUID()}@example.com`;
  const result = await fixtureSignUp({ body: { name: "清理", email, password: "limit-test-password" } });
  const login = await auth.api.signInEmail({ body: { email, password: "limit-test-password" }, asResponse: true });
  const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const request = () => new Request("http://localhost/api/images", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ filename: "图.png", size: 60, contentType: "image/png" }) });
  const url = new URL(process.env.DATABASE_URL!);
  const args = ["cleanup", "--environment", "test", "--target", `${url.hostname}:${url.port}/${url.pathname.slice(1)}/${url.username}`, "--endpoint", endpoint, "--bucket", "images-test"];
  const env = { PHOSKYWIKI_ENV: "test", R2_ENDPOINT: endpoint, R2_BUCKET: "images-test", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test" };
  try {
    const uploads = [];
    for (let i = 0; i < 3; i++) {
      const upload = await (await presign(request())).json(); uploads.push(upload); store.upload(upload.url, 60);
    }
    const context = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await complete(request(), context(uploads[0].id))).status).toBe(200);
    const frozen = (await read(request(), context(uploads[0].id))).headers.get("location")!;
    // Fixture ages only; all verification is via the process and HTTP/storage boundaries.
    await getDb().update(images).set({ createdAt: new Date(Date.now() - 90000000) }).where(inArray(images.id, uploads.slice(0, 2).map(u => u.id)));
    expect((await run(args, env)).report.cleanup.apply).toBe(false);
    expect(await store.head(new URL(uploads[1].url).pathname.slice(1))).not.toBeNull();
    const cleaned = await run([...args, "--apply"], env);
    expect(cleaned.code).toBe(0);
    expect(cleaned.report.cleanup.objectsDeleted).toBe(2);
    expect(await store.head(new URL(uploads[1].url).pathname.slice(1))).toBeNull();
    expect((await complete(request(), context(uploads[1].id))).status).toBe(410);
    expect((await complete(request(), context(uploads[0].id))).status).toBe(200);
    expect(await store.head(new URL(frozen).pathname.slice(1))).toMatchObject({ size: 60 });
    expect((await read(new Request("http://localhost/api/images"), context(uploads[0].id))).status).toBe(404);
    expect((await complete(request(), context(uploads[2].id))).status).toBe(200);
    expect((await run([...args, "--apply"], env)).report.cleanup.objectsDeleted).toBe(0);
    // A previously started PUT can land late: retain tombstones and sweep again.
    store.upload(uploads[1].url, 99);
    await getDb().update(images).set({ stagingCleanedAt: new Date(Date.now() - 7200000) }).where(eq(images.id, uploads[1].id));
    expect((await run([...args, "--apply"], env)).report.cleanup.objectsDeleted).toBe(1);
    expect(await store.head(new URL(uploads[1].url).pathname.slice(1))).toBeNull();
  } finally {
    injectObjectStore(undefined);
    await getDb().delete(user).where(eq(user.id, result.user.id));
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 30000);
