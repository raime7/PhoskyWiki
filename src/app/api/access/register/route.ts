import { registerInvited } from "@/lib/access-grants";
import { accessExchange, privateJson } from "@/lib/access-http";

export async function POST(req: Request) {
  return accessExchange(req, async body => privateJson(await registerInvited(body), 201));
}
