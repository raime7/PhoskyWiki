import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { POST as submit } from "@/app/api/submissions/route";
import { POST as vote } from "@/app/api/admin/submissions/[id]/review/route";
import { GET as history } from "@/app/api/pages/[pageId]/history/route";
import { GET as search } from "@/app/api/search/route";
import { FakeSearchIndex } from "@/lib/search/fake-index";
import { injectSearchIndex, resetSearchIndex } from "@/lib/search/search-service";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { user, pages, submissions } from "@/db/schema";

const accountIds: string[] = [];

async function account(role: "admin" | "editor") {
  const email = `term24-${randomUUID()}@example.com`;
  const result = await auth.api.signUpEmail({ body: { email, name: role, password: "password123" } });
  accountIds.push(result.user.id);
  await getDb().update(user).set({ role }).where(eq(user.id, result.user.id));
  const response = await auth.api.signInEmail({ body: { email, password: "password123" }, asResponse: true });
  return response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
async function post(body: object, cookie: string) {
  return submit(new Request("http://localhost/api/submissions", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }));
}
async function approve(id: number, cookie: string) {
  return vote(new Request(`http://localhost/api/admin/submissions/${id}/review`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "approve" }) }), { params: Promise.resolve({ id: String(id) }) });
}
async function readHistory(id: number) {
  const response = await history(new Request(`http://localhost/api/pages/${id}/history`), { params: Promise.resolve({ pageId: String(id) }) });
  return response.json();
}
let admin1: string, admin2: string, editor: string;
beforeAll(async () => { injectSearchIndex(new FakeSearchIndex()); admin1 = await account("admin"); admin2 = await account("admin"); editor = await account("editor"); });
afterAll(async () => {
  resetSearchIndex();
  await getDb().delete(submissions).where(inArray(submissions.submittedBy, accountIds));
  await getDb().delete(pages).where(inArray(pages.createdBy, accountIds));
  await getDb().delete(user).where(inArray(user.id, accountIds));
});

describe("词条信息编辑 HTTP", () => {
  it("完整元数据提案经两名管理员受理，保留独立快照与来源", async () => {
    const title = `Old Term ${randomUUID()}`;
    const created = await post({ kind: "new_term", title, summary: "原简介", aliases: ["原别名"] }, admin1);
    expect(created.status).toBe(201);
    const { pageId } = await created.json();
    const before = await readHistory(pageId);
    const proposed = await post({ kind: "edit", pageId, baseRevisionId: before.revisions[0].id, title: `${title} Renamed`, summary: "新简介", aliases: ["新别名"] }, editor);
    expect(proposed.status).toBe(201);
    const proposal = await proposed.json();
    expect(proposal).toMatchObject({ outcome: "pending", quorum: 2 });
    expect((await readHistory(pageId)).page.title).toBe(title);
    expect(await (await approve(proposal.submissionId, admin1)).json()).toMatchObject({ outcome: "pending", approveCount: 1 });
    expect((await readHistory(pageId)).page.title).toBe(title);
    expect(await (await approve(proposal.submissionId, admin2)).json()).toMatchObject({ outcome: "approved" });
    const after = await readHistory(pageId);
    expect(after.page).toMatchObject({ id: pageId, title: `${title} Renamed` });
    expect(after.revisions).toHaveLength(2);
    expect(after.revisions[0]).toMatchObject({ source: "approval", snapshot: { version: 1, type: "term", title: `${title} Renamed`, summary: "新简介", aliases: ["新别名"] } });
    expect(after.revisions[1]).toMatchObject({ source: "create", snapshot: { title, summary: "原简介", aliases: ["原别名"] } });
  });
  it("直编推进词条 head 后旧基准明确驳回，过期管理员编辑也不能覆盖", async () => {
    const title = `Stale ${randomUUID()}`;
    const { pageId } = await (await post({ kind: "new_term", title }, admin1)).json();
    const baseRevisionId = (await readHistory(pageId)).revisions[0].id;
    const payload = { kind: "edit", pageId, baseRevisionId, title, summary: "待审简介", aliases: [] };
    const { submissionId } = await (await post(payload, editor)).json();
    expect((await post({ ...payload, summary: "管理员的新简介" }, admin1)).status).toBe(201);
    expect(await (await approve(submissionId, admin2)).json()).toMatchObject({ outcome: "rejected", staleBase: true });
    expect((await post(payload, admin1)).status).toBe(409);
    const current = await readHistory(pageId);
    expect(current.revisions).toHaveLength(2);
    expect(current.revisions[0]).toMatchObject({ source: "direct", snapshot: { summary: "管理员的新简介" } });
    expect((await approve(submissionId, admin1)).status).toBe(409);
  });
  it("最终受理撞名原子失败，重试同一票仍返回撞名且没有新增修订", async () => {
    const title = `Clash ${randomUUID()}`;
    const { pageId } = await (await post({ kind: "new_term", title, summary: "原简介", aliases: ["原别名"] }, admin1)).json();
    const before = await readHistory(pageId);
    const desired = `${title} Occupied`;
    const proposal = { kind: "edit", pageId, baseRevisionId: before.revisions[0].id, title: desired, summary: "不能泄露", aliases: ["不能泄露"] };
    const { submissionId } = await (await post(proposal, editor)).json();
    expect(await (await approve(submissionId, admin1)).json()).toMatchObject({ outcome: "pending", approveCount: 1 });
    expect((await post({ kind: "new_term", title: desired }, admin1)).status).toBe(201);
    for (let retry = 0; retry < 2; retry++) {
      const failed = await approve(submissionId, admin2);
      expect(failed.status).toBe(409);
      expect(await failed.json()).toMatchObject({ error: expect.stringContaining("已存在") });
    }
    expect(await readHistory(pageId)).toEqual(before);
    expect((await post(proposal, admin1)).status).toBe(409);
    expect(await readHistory(pageId)).toEqual(before);
  });
  it("拒绝缺字段和错误类型的元数据提案", async () => {
    const { pageId } = await (await post({ kind: "new_term", title: `Validation ${randomUUID()}` }, admin1)).json();
    const baseRevisionId = (await readHistory(pageId)).revisions[0].id;
    expect((await post({ kind: "edit", pageId, baseRevisionId, title: "遗漏别名", summary: "" }, editor)).status).toBe(400);
    expect((await post({ kind: "edit", pageId, baseRevisionId, title: "", summary: "", aliases: [] }, editor)).status).toBe(400);
    expect((await post({ kind: "edit", pageId, baseRevisionId, title: "提案", summary: "", aliases: [3] }, editor)).status).toBe(400);
  });
  it("改名后搜索 API 返回同一 id 的新标题、简介和别名", async () => {
    const token = randomUUID();
    const title = `Search Old ${token}`;
    const { pageId } = await (await post({ kind: "new_term", title, summary: "旧摘要" }, admin1)).json();
    const baseRevisionId = (await readHistory(pageId)).revisions[0].id;
    const result = await post({ kind: "edit", pageId, baseRevisionId, title: `Search New ${token}`, summary: `新摘要 ${token}`, aliases: [`别名 ${token}`] }, admin1);
    expect(result.status).toBe(201);
    const query = async (q: string) => (await search(new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}&type=term`))).json();
    expect((await query(title)).hits).toEqual([]);
    for (const q of [`Search New ${token}`, `新摘要 ${token}`, `别名 ${token}`]) {
      expect((await query(q)).hits).toEqual([expect.objectContaining({ pageId, title: `Search New ${token}`, type: "term" })]);
    }
  });
});
