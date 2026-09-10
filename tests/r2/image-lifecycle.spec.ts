import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq, inArray } from "drizzle-orm";
import { DeleteObjectsCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { expect, test } from "@playwright/test";
import { fixtureRegister } from "../e2e/auth-fixture";
import { getDb } from "../../src/db";
import { images, pages, perspectives, user } from "../../src/db/schema";

test("真实 R2：浏览器上传、私图、两票公开、冻结重放与清理后历史图片可读", async ({ page, browser }) => {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVYQAAAAASUVORK5CYII=", "base64");
  const baseURL = `http://localhost:${process.env.PW_PORT ?? 3000}`;
  const guest = await browser.newContext({ baseURL });
  const admins = [await browser.newContext({ baseURL }), await browser.newContext({ baseURL })];
  const editor = await fixtureRegister(page.request, { data: { name: "R2 编者", email: `r2-${randomUUID()}@example.com`, password: "r2-test-password" } });
  expect(editor.ok()).toBe(true);
  const editorId = (await editor.json()).user.id;
  const s3 = new S3Client({ region: "auto", endpoint: process.env.R2_CONTRACT_ENDPOINT, credentials: {
    accessKeyId: process.env.R2_CONTRACT_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_CONTRACT_SECRET_ACCESS_KEY!,
  } });
  try {
    for (const context of admins) {
      const result = await fixtureRegister(context.request, { data: { name: "R2 管理员", email: `r2-${randomUUID()}@example.com`, password: "r2-test-password" } });
      expect(result.ok()).toBe(true);
      await getDb().update(user).set({ role: "admin" }).where(eq(user.id, (await result.json()).user.id));
    }
    await page.goto("/new/term");
    // Keep signed responses in memory only; never attach them to reports/traces.
    const signedResponse = page.waitForResponse(r => new URL(r.url()).pathname === "/api/images" && r.request().method() === "POST");
    await page.getByLabel("上传并插入图片").setInputFiles({ name: "r2.png", mimeType: "image/png", buffer: bytes });
    const signed = await (await signedResponse).json();
    await expect(page.getByRole("textbox", { name: "正文（Markdown）" })).toContainText(`/api/images/${signed.id}`);
    const imagePath = `/api/images/${signed.id}`;
    expect((await guest.request.get(imagePath, { maxRedirects: 0 })).status()).toBe(404);
    expect((await (await page.request.get(imagePath)).body()).equals(bytes)).toBe(true);
    const title = `R2-${randomUUID()}`;
    const proposal = await page.request.post("/api/submissions", { data: { kind: "new_term", title, content: `![R2](${imagePath})` } });
    expect(proposal.status()).toBe(201);
    const { submissionId } = await proposal.json();
    expect((await admins[0].request.post(`/api/admin/submissions/${submissionId}/review`, { data: { action: "approve" } })).status()).toBe(200);
    expect((await guest.request.get(imagePath, { maxRedirects: 0 })).status()).toBe(404);
    const approved = await admins[1].request.post(`/api/admin/submissions/${submissionId}/review`, { data: { action: "approve" } });
    expect(approved.status()).toBe(200);
    expect(await approved.json()).toMatchObject({ outcome: "approved" });
    const [term] = await getDb().select({ id: pages.id }).from(pages).where(eq(pages.title, title));
    const [perspective] = await getDb().select().from(perspectives).where(eq(perspectives.termId, term.id));
    const historyPath = `/api/pages/${perspective.pageId}/history`;
    const history = await (await admins[0].request.get(historyPath)).json();
    expect((await admins[0].request.post("/api/submissions", { data: { kind: "edit", pageId: perspective.pageId,
      baseRevisionId: history.revisions[0].id, content: "当前修订不再引用图片" } })).status()).toBe(201);
    // A valid signature remains replayable against staging, never against frozen content.
    const replayStatus = await page.evaluate(async upload => (await fetch(upload.url, { method: "PUT", headers: upload.headers, body: "replacement", credentials: "omit" })).status, signed);
    expect(replayStatus).toBe(200);
    expect((await page.request.post(imagePath)).status()).toBe(200);
    expect((await (await guest.request.get(imagePath)).body()).equals(bytes)).toBe(true);
    const staging = { Bucket: process.env.R2_CONTRACT_BUCKET, Key: `staging/${signed.id}` };
    expect((await s3.send(new HeadObjectCommand(staging))).ContentLength).toBe(11);
    await getDb().update(images).set({ createdAt: new Date(Date.now() - 90000000) }).where(eq(images.id, signed.id));
    const db = new URL(process.env.DATABASE_URL!);
    const cleanup = await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import=tsx", "scripts/images.ts", "cleanup", "--environment", "test", "--target",
      `${db.hostname}:${db.port}/${db.pathname.slice(1)}/${db.username}`, "--endpoint", process.env.R2_CONTRACT_ENDPOINT!, "--bucket", process.env.R2_CONTRACT_BUCKET!, "--apply"], {
      env: { ...process.env, PHOSKYWIKI_ENV: "test", R2_ENDPOINT: process.env.R2_CONTRACT_ENDPOINT,
        R2_BUCKET: process.env.R2_CONTRACT_BUCKET, R2_ACCESS_KEY_ID: process.env.R2_CONTRACT_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: process.env.R2_CONTRACT_SECRET_ACCESS_KEY },
    });
    expect(JSON.parse(cleanup.stdout).ok).toBe(true);
    await expect(s3.send(new HeadObjectCommand(staging))).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect((await (await guest.request.get(imagePath)).body()).equals(bytes)).toBe(true);
    const after = await (await guest.request.get(historyPath)).json();
    expect(after.revisions[0].content).toBe("当前修订不再引用图片");
    expect(after.revisions[1].content).toContain(imagePath);
  } finally {
    const rows = await getDb().select().from(images).where(eq(images.uploadedBy, editorId));
    const keys = rows.flatMap(row => [row.stagingKey, ...(row.objectKey ? [row.objectKey] : [])]);
    if (keys.length) await s3.send(new DeleteObjectsCommand({ Bucket: process.env.R2_CONTRACT_BUCKET, Delete: { Objects: keys.map(Key => ({ Key })) } }));
    if (rows.length) await getDb().delete(images).where(inArray(images.id, rows.map(row => row.id)));
    s3.destroy();
    await guest.close(); for (const context of admins) await context.close();
  }
});
