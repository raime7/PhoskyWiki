import { requireAdminUser } from "@/lib/admin-auth";
import { importPages, ReviewError, reviewErrorResponse, type SubmissionInput } from "@/lib/review";

function entries(value: unknown, kind: "new_term" | "new_interpreter"): SubmissionInput[] {
  if (!Array.isArray(value)) throw new ReviewError(400, "terms 和 interpreters 必须是数组");
  return value.map((item) => {
    if (!item || typeof item !== "object" || typeof item.title !== "string" ||
      (item.summary !== undefined && typeof item.summary !== "string") ||
      (item.content !== undefined && typeof item.content !== "string")) throw new ReviewError(400, "每项必须包含字符串 title；summary、content 为可选字符串");
    return { kind, title: item.title, summary: item.summary, content: item.content, aliases: item.aliases };
  });
}

export async function POST(req: Request) {
  const actor = await requireAdminUser(req);
  if (actor instanceof Response) return actor;
  try {
    const text = await req.text();
    if (text.length > 1_000_000) throw new ReviewError(413, "导入文件不能超过 1 MB");
    let body;
    try { body = JSON.parse(text); } catch { throw new ReviewError(400, "请求体必须是 JSON"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ReviewError(400, "请求体必须是 JSON 对象");
    const inputs = [...entries(body.interpreters ?? [], "new_interpreter"), ...entries(body.terms ?? [], "new_term")];
    if (!inputs.length || inputs.length > 100) throw new ReviewError(400, "每批需要 1–100 个词条与诠释者");
    return Response.json({ pages: await importPages(inputs, actor.user) }, { status: 201 });
  } catch (err) {
    const response = reviewErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
