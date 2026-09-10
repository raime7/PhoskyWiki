import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { auth } from "@/lib/auth";
import { POST as presign } from "@/app/api/images/route";
import { POST as complete, GET as read } from "@/app/api/images/[id]/route";
import { injectObjectStore } from "@/lib/object-store";
import { FakeObjectStore } from "../fakes/object-store";
import { fixtureSignUp } from "./auth-fixture";

afterEach(() => {
  injectObjectStore(undefined);
  for (const key of ["UPLOAD_ACCOUNT_BYTES", "UPLOAD_PENDING_COUNT", "UPLOAD_LIMIT_COUNT"]) delete process.env[key];
});
async function account() {
  const email = `image-limits-${randomUUID()}@example.com`;
  const result = await fixtureSignUp({ body: { name: "图片限额", email, password: "limit-test-password" } });
  const login = await auth.api.signInEmail({ body: { email, password: "limit-test-password" }, asResponse: true });
  return { id: result.user.id, cookie: login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") };
}
function request(cookie: string, size = 60) {
  return new Request("http://localhost/api/images", { method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ filename: "图.png", contentType: "image/png", size, uploadedBy: randomUUID() }) });
}

it("并发申请先预留账号字节，永久私图继续计费，完成重放不重复占用，其他账号独立", async () => {
  process.env.UPLOAD_ACCOUNT_BYTES = "100";
  const store = new FakeObjectStore(); injectObjectStore(store);
  const { cookie } = await account();
  const responses = await Promise.all(Array.from({ length: 5 }, () => presign(request(cookie))));
  expect(responses.map(r => r.status).sort()).toEqual([201, 429, 429, 429, 429]);
  expect(await responses.find(r => r.status === 429)!.json()).toMatchObject({ code: "upload_bytes" });
  const upload = await responses.find(r => r.status === 201)!.json();
  store.upload(upload.url, 60);
  const ctx = { params: Promise.resolve({ id: upload.id }) };
  expect((await complete(request(cookie), ctx)).status).toBe(200);
  expect((await complete(request(cookie), ctx)).status).toBe(200);
  expect((await presign(request(cookie, 40))).status).toBe(201);
  expect((await presign(request(cookie, 1))).status).toBe(429);
  expect((await read(new Request("http://localhost/api/images"), ctx)).status).toBe(404);
  expect((await presign(request((await account()).cookie))).status).toBe(201);
});

it("待完成数量和上传频率分别拒绝，并保持大小与类型校验", async () => {
  process.env.UPLOAD_PENDING_COUNT = "1";
  process.env.UPLOAD_LIMIT_COUNT = "4";
  injectObjectStore(new FakeObjectStore());
  const { cookie } = await account();
  expect((await presign(request(cookie, 10485761))).status).toBe(400);
  expect((await presign(request(cookie))).status).toBe(201);
  expect(await (await presign(request(cookie))).json()).toMatchObject({ code: "upload_pending" });
  expect(await (await presign(request(cookie))).json()).toMatchObject({ code: "upload_pending" });
  const limited = await presign(request(cookie));
  expect(limited.status).toBe(429);
  expect(await limited.json()).toMatchObject({ code: "upload_rate" });
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
});
