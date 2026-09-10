import { resetWithGrant } from "@/lib/access-grants";
import { accessExchange, privateJson } from "@/lib/access-http";

export async function POST(req: Request) {
  return accessExchange(req, async body => {
    await resetWithGrant(body);
    return privateJson({ ok: true });
  });
}
