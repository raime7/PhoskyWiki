import { fixtureSignUp } from "./auth-fixture";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { POST as submit } from "@/app/api/submissions/route";
import { POST as importContent } from "@/app/api/admin/import/route";
import { getWikiLinkTargets, listInterpreters, listTerms } from "@/lib/content";
import { POST as presign } from "@/app/api/images/route";
import { POST as complete, GET as readImage } from "@/app/api/images/[id]/route";
import { POST as vote } from "@/app/api/admin/submissions/[id]/review/route";
import { injectObjectStore } from "@/lib/object-store";
import { FakeObjectStore } from "../fakes/object-store";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { seedDatabase } from "@/db/seed";
import { pages, submissions, submissionVotes, user } from "@/db/schema";
import { getHeadContent, getTermDetail, listPerspectivesOfTerm } from "@/lib/content";

const accounts: { id: string; cookie: string }[] = [];
const store = new FakeObjectStore();
beforeAll(async () => {
  injectObjectStore(store);
  await seedDatabase();
  for (const role of ["admin", "admin", "editor", "editor"] as const) {
    const email = `t15-${randomUUID()}@example.com`;
    const password = "production-test-123";
    const result = await fixtureSignUp({ body: { name: role, email, password } });
    await getDb().update(user).set({ role }).where(eq(user.id, result.user.id));
    const login = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    accounts.push({ id: result.user.id, cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") });
  }
});
afterAll(async () => {
  injectObjectStore(undefined);
  const ids = accounts.map((a) => a.id);
  if (!ids.length) return;
  await getDb().delete(pages).where(inArray(pages.createdBy, ids));
  await getDb().delete(submissionVotes).where(inArray(submissionVotes.adminId, ids));
  await getDb().delete(submissions).where(inArray(submissions.submittedBy, ids));
  await getDb().delete(user).where(inArray(user.id, ids));
});

it("图片经预签名直传，编者引用随两票审核发布，完成后上传链接不能替换已审核图片", async () => {
  const signed = await presign(request({ filename: "图.png", contentType: "image/png", size: 123 }, 2));
  expect(signed.status).toBe(201);
  const upload = await signed.json();
  const context = { params: Promise.resolve({ id: upload.id }) };
  expect((await complete(request({}, 2), context)).status).toBe(409);
  store.upload(upload.url, 123);
  expect((await complete(request({}, 2), context)).status).toBe(200);
  const guest = new Request("http://localhost/api/images");
  expect((await readImage(guest, context)).status).toBe(404);
  expect((await readImage(request({}, 2), context)).status).toBe(307);
  const proposal = await submit(request({ kind: "new_term", title: "T15图片审核", content: `![图](/api/images/${upload.id})` }, 2));
  expect(proposal.status).toBe(201);
  const { submissionId } = await proposal.json();
  const reviewContext = { params: Promise.resolve({ id: String(submissionId) }) };
  expect((await vote(request({ action: "approve" }), reviewContext)).status).toBe(200);
  expect((await readImage(guest, context)).status).toBe(404);
  expect((await vote(request({ action: "approve" }, 1), reviewContext)).status).toBe(200);
  const published = await readImage(guest, context);
  expect(published.status).toBe(307);
  const frozenUrl = published.headers.get("location")!;
  store.upload(upload.url, 999);
  expect((await complete(request({}, 2), context)).status).toBe(200);
  expect((await readImage(guest, context)).headers.get("location")).toBe(frozenUrl);
  expect(await store.head(new URL(frozenUrl).pathname.slice(1))).toMatchObject({ size: 123 });
});
function request(body: unknown, account = 0) {
  return new Request("http://localhost/api/submissions", { method: "POST", headers: { "content-type": "application/json", cookie: accounts[account].cookie }, body: JSON.stringify(body) });
}

it("词条向导一次直编生成信息框、编委会视角及两页修订", async () => {
  const response = await submit(request({ kind: "new_term", title: "T15物化", summary: "人的关系呈现为物的关系", aliases: ["对象化"], content: "## 通俗解读\n人的关系。\n## 引用\n出处待补充" }));
  expect(response.status).toBe(201);
  const result = await response.json();
  expect(await getTermDetail(result.pageId)).toMatchObject({ aliases: ["对象化"], summary: "人的关系呈现为物的关系" });
  const perspectives = await listPerspectivesOfTerm(result.pageId);
  expect(perspectives).toHaveLength(1);
  expect(await getHeadContent(perspectives[0].pageId)).toContain("## 通俗解读");
  expect(await getHeadContent(result.pageId)).toContain("对象化");
});

it("管理员 JSON 批量导入词条与诠释者，失败整批回滚，编者不得导入", async () => {
  const body = { interpreters: [{ title: "T15思想家", summary: "简介" }], terms: [{ title: "T15导入", summary: "导入简介", aliases: ["导入别名"], content: "## 通俗解读\n导入正文" }] };
  expect((await importContent(request(body, 2))).status).toBe(403);
  const response = await importContent(request(body));
  expect(response.status).toBe(201);
  const result = await response.json();
  expect(result.pages).toHaveLength(2);
  for (const page of result.pages) expect(await getHeadContent(page.pageId)).toBeTruthy();
  const bad = await importContent(request({ interpreters: [{ title: "T15应回滚" }], terms: [{ title: "T15导入" }] }));
  expect(bad.status).toBe(400);
  expect((await listInterpreters()).some((p) => p.name === "T15应回滚")).toBe(false);
  expect((await listTerms()).filter((p) => p.title === "T15导入")).toHaveLength(1);
});

it("拒绝游客上传、伪造元数据、未完成或他人的私有图片及外链图片", async () => {
  expect((await presign(new Request("http://localhost/api/images", { method: "POST" }))).status).toBe(401);
  expect((await presign(request({ filename: "x.svg", size: 20, contentType: "image/svg+xml" }))).status).toBe(400);
  const signed = await (await presign(request({ filename: "图.png", size: 50, contentType: "image/png" }, 2))).json();
  const context = { params: Promise.resolve({ id: signed.id }) };
  store.upload(signed.url, 51);
  expect((await complete(request({}, 2), context)).status).toBe(400);
  store.upload(signed.url, 50);
  expect((await complete(request({}, 3), context)).status).toBe(404);
  expect((await complete(request({}, 2), context)).status).toBe(200);
  expect((await readImage(request({}, 3), context)).status).toBe(404);
  const input = { kind: "new_term", title: "T15拒绝非法图片", content: `![图](/api/images/${signed.id})` };
  expect((await submit(request(input, 3))).status).toBe(400);
  for (const content of ["![x](https://evil.test/image.png)", `![x](/api/images/${randomUUID()})`]) {
    expect((await submit(request({ ...input, content }))).status).toBe(400);
    expect((await importContent(request({ terms: [{ title: input.title, content }] }))).status).toBe(400);
  }
  const proposal = await (await submit(request(input, 2))).json();
  expect((await vote(request({ action: "reject", reason: "图片来源不明" }), { params: Promise.resolve({ id: String(proposal.submissionId) }) })).status).toBe(200);
  expect((await readImage(new Request("http://localhost/api/images"), context)).status).toBe(404);
});

it("管理员完成上传即公开，无需额外图片审核", async () => {
  const signed = await (await presign(request({ filename: "管理图.png", size: 25, contentType: "image/png" }))).json();
  store.upload(signed.url, 25);
  const context = { params: Promise.resolve({ id: signed.id }) };
  expect((await complete(request({}), context)).status).toBe(200);
  expect((await readImage(new Request("http://localhost/api/images"), context)).status).toBe(307);
});

it("批量导入的前向双链立即解析；信息框快照中的图片字面量不绕过审核", async () => {
  const signed = await (await presign(request({ filename: "私有.png", size: 10, contentType: "image/png" }, 2))).json();
  store.upload(signed.url, 10);
  const context = { params: Promise.resolve({ id: signed.id }) };
  await complete(request({}, 2), context);
  const response = await importContent(request({ terms: [
    { title: "T15前项", content: "见 [[T15后项]]", summary: `图片语法示例：![图](/api/images/${signed.id})` },
    { title: "T15后项" },
  ] }));
  expect(response.status).toBe(201);
  const { pages: imported } = await response.json();
  const perspectives = await listPerspectivesOfTerm(imported[0].pageId);
  expect((await getWikiLinkTargets(perspectives[0].pageId)).get("T15后项")).toMatchObject({ exists: true });
  expect((await readImage(new Request("http://localhost/api/images"), context)).status).toBe(404);
});
