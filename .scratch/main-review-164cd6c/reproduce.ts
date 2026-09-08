import "dotenv/config";
import { auth } from "../../src/lib/auth";
import { listDiscussionFloors } from "../../src/lib/discussion";
import { listInterpreters, listTerms, listPerspectivesOfTerm, getLivePage, getTermDisambiguation } from "../../src/lib/content";
import { POST as submit } from "../../src/app/api/submissions/route";
import { POST as post } from "../../src/app/api/discussion/posts/route";
import { POST as pageAction } from "../../src/app/api/admin/pages/[pageId]/route";

async function main() {
  if (!process.env.DATABASE_URL?.endsWith("/phoskywiki_review_browser_164cd6c")) throw new Error("Review database required");
  const signed = await auth.api.signInEmail({ body: { email: process.env.SEED_ADMIN_EMAIL!, password: process.env.SEED_ADMIN_PASSWORD! }, asResponse: true });
  if (signed.status !== 200) throw new Error(`Sign-in ${signed.status}`);
  const cookie = signed.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const req = (path: string, data: object) => new Request(`http://localhost:3000${path}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(data) });
  const term = (await listTerms()).find(t => t.title === "主体性")!;
  const interpreter = (await listInterpreters()).find(i => i.name === "拉康")!;
  const perspective = (await listPerspectivesOfTerm(term.id)).find(p => p.interpreterId === interpreter.pageId)!;
  const original = await post(req("/api/discussion/posts", { termId: term.id, perspectiveId: perspective.pageId, content: "Review: anchor before deletion" }));
  const floor = await original.json();
  const deleted = await pageAction(req(`/api/admin/pages/${interpreter.pageId}`, { action: "delete" }), { params: Promise.resolve({ pageId: String(interpreter.pageId) }) });
  const visiblePage = await getLivePage(perspective.pageId);
  const shownAnchor = (await listDiscussionFloors(term.id)).find(f => f.id === floor.id)?.perspective;
  const hiddenPost = await post(req("/api/discussion/posts", { termId: term.id, perspectiveId: perspective.pageId, content: "Review: hidden anchor accepted" }));
  console.log(JSON.stringify({ scenario: "deleted interpreter discussion anchor", originalPostStatus: original.status, deletionStatus: deleted.status, targetVisible: Boolean(visiblePage), anchorMarkedLive: shownAnchor?.live, postWithHiddenAnchorStatus: hiddenPost.status }));
  await pageAction(req(`/api/admin/pages/${interpreter.pageId}`, { action: "restore" }), { params: Promise.resolve({ pageId: String(interpreter.pageId) }) });
  const name = `审查同名词${Date.now()}`;
  const statuses = [];
  for (const qualifier of ["哲学", "历史"]) {
    const response = await submit(req("/api/submissions", { kind: "new_term", title: `${name}（${qualifier}）`, content: "通俗解读" }));
    statuses.push(response.status);
  }
  console.log(JSON.stringify({ scenario: "new disambiguation group", createStatuses: statuses, disambiguation: await getTermDisambiguation(`${name}（哲学）`) }));
}
main().then(() => process.exit(0), e => { console.error(e.message); process.exit(1); });
