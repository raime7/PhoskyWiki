import { requireAdminUser } from "@/lib/admin-auth";
import { searchStatus } from "@/lib/search/search-maintenance";

export async function GET(req: Request) {
  const admission = await requireAdminUser(req);
  if (admission instanceof Response) return admission;
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const search = await searchStatus();
    const ok = search.available && !search.degraded;
    return Response.json({ ok, search }, { status: ok ? 200 : 503, headers });
  } catch {
    return Response.json({ ok: false, error: "SEARCH_STATUS_UNAVAILABLE" }, { status: 503, headers });
  }
}
