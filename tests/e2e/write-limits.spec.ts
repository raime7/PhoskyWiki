import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { fixtureRegister } from "./auth-fixture";

test("浏览器正常写入后并发超限得到明确响应，另一账号及公开阅读不受影响", async ({ page, browser }) => {
  expect((await fixtureRegister(page.request, { data: { name: "限额测试", email: `limit-${randomUUID()}@example.com`, password: "limit-test-password" } })).ok()).toBe(true);
  await page.goto("/");
  const count = Number(process.env.WRITE_LIMIT_COUNT ?? 60);
  const results = await page.evaluate(async count => Promise.all(Array.from({ length: count + 4 }, async (_, i) => {
    const response = await fetch("/api/interests", { method: "PUT", headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${i}` }, body: JSON.stringify({ categories: [] }) });
    return { status: response.status, retry: response.headers.get("retry-after"), body: await response.json() };
  })), count);
  expect(results.filter(r => r.status === 200)).toHaveLength(count);
  expect(results.filter(r => r.status === 429)).toHaveLength(4);
  expect(results.find(r => r.status === 429)).toMatchObject({ body: { code: "write_rate" } });
  expect((await page.request.get("/")).ok()).toBe(true);
  const other = await browser.newContext({ baseURL: `http://localhost:${process.env.PW_PORT ?? 3000}` });
  try {
    expect((await fixtureRegister(other.request, { data: { name: "独立账号", email: `limit-${randomUUID()}@example.com`, password: "limit-test-password" } })).ok()).toBe(true);
    expect((await other.request.put("/api/interests", { data: { categories: [] } })).status()).toBe(200);
  } finally { await other.close(); }
});
