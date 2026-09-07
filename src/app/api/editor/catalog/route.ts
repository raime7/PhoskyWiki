import { getEditorCatalog } from "@/lib/editor-catalog";

export async function GET() {
  return Response.json(await getEditorCatalog(), { headers: { "Cache-Control": "no-store" } });
}
