import { POST } from "@/app/api/access/register/route";
import { invitationFixture } from "../auth-fixture";

export async function fixtureSignUp({ body }: { body: { name: string; email: string; password: string } }) {
  const response = await POST(new Request("http://localhost:3000/api/access/register", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ ...body, token: await invitationFixture() }),
  }));
  if (!response.ok) throw Object.assign(new Error("Fixture registration failed"), { statusCode: response.status });
  return await response.json() as { user: { id: string; email: string; name: string; role: string; emailVerified: boolean } };
}
