import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auth } from "@/lib/auth";
import { PUT as interests } from "@/app/api/interests/route";
import { POST as submit } from "@/app/api/submissions/route";
import { fixtureSignUp } from "./auth-fixture";

afterEach(() => { delete process.env.WRITE_LIMIT_COUNT; });

async function account() {
  const email = `limits-${randomUUID()}@example.com`;
  await fixtureSignUp({ body: { name: "限额编者", email, password: "limit-test-password" } });
  const login = await auth.api.signInEmail({ body: { email, password: "limit-test-password" }, asResponse: true });
  return login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
}
function request(cookie: string, index = 0) {
  return new Request("http://localhost/api/interests", { method: "PUT", headers: {
    cookie, "content-type": "application/json", "x-forwarded-for": `192.0.2.${index}`, "x-user-id": randomUUID(),
  }, body: JSON.stringify({ interpreters: [], schools: [], topics: [] }) });
}

it("账号写入共享窗口原子计数，换路由和伪造身份头不能绕过，同 IP 的其他账号仍可写", async () => {
  process.env.WRITE_LIMIT_COUNT = "3";
  const cookie = await account();
  const results = await Promise.all(Array.from({ length: 9 }, (_, i) => interests(request(cookie, i))));
  expect(results.filter(r => r.status === 429)).toHaveLength(6);
  const denied = results.find(r => r.status === 429)!;
  expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(await denied.json()).toMatchObject({ code: "write_rate" });
  expect((await submit(request(cookie))).status).toBe(429);
  expect((await interests(request(await account()))).status).not.toBe(429);
  expect((await interests(request(""))).status).toBe(401);
});

it("窗口过期恢复写入，错误配置关闭写入但不泄露配置", async () => {
  process.env.WRITE_LIMIT_COUNT = "1";
  const cookie = await account();
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  expect((await interests(request(cookie))).status).toBe(200);
  expect((await interests(request(cookie))).status).toBe(429);
  await getDb().execute(sql`UPDATE write_limits SET window_start = clock_timestamp() - interval '2 minutes' WHERE user_id = ${session!.user.id}`);
  expect((await interests(request(cookie))).status).toBe(200);
  process.env.WRITE_LIMIT_COUNT = "invalid-secret";
  const response = await interests(request(cookie));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("invalid-secret");
});
