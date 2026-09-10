import type { APIRequestContext } from "@playwright/test";
import { invitationFixture } from "../auth-fixture";

/** Register through invitation enforcement, then establish the existing session cookie. */
export async function fixtureRegister(request: APIRequestContext, options: { data: { name: string; email: string; password: string }; headers?: Record<string, string> }) {
  const origin = `http://localhost:${process.env.PW_PORT ?? 3000}`;
  const response = await request.post("/api/access/register", { headers: { origin }, data: { ...options.data, token: await invitationFixture() } });
  if (!response.ok()) return response;
  return request.post("/api/auth/sign-in/email", { headers: { origin }, data: { email: options.data.email, password: options.data.password } });
}
