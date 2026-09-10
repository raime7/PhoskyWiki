import { randomBytes } from 'node:crypto';
import { test as base, type BrowserContextOptions } from '@playwright/test';
import { sql } from 'drizzle-orm';
import { getDb } from '../../src/db';
import { assertIsolatedTestEnvironment } from '../isolated-environment';
export * from '@playwright/test';

// The isolated app is accessed directly, so emulate the trusted proxy's distinct
// client identities. Keep one address per browser context: production rate limits
// remain enabled and repeated requests by the same visitor still share a bucket.
const clientHeaders = () => ({ 'x-forwarded-for': `10.${[...randomBytes(3)].join('.')}` });
export const test = base.extend<{ seedBudget: void }>({
  extraHTTPHeaders: async ({ baseURL }, provide) => {
    if (!baseURL || new URL(baseURL).hostname !== 'localhost') throw new Error('Isolated localhost required');
    await provide(clientHeaders());
  },
  seedBudget: [async ({ baseURL }, provide) => {
    if (!baseURL || new URL(baseURL).hostname !== 'localhost') throw new Error('Isolated localhost required');
    assertIsolatedTestEnvironment();
    // The legacy suite shares one seeded administrator. Reset only its fixture
    // budget between scenarios; per-editor quota tests retain their real budgets.
    await getDb().execute(sql`DELETE FROM write_limits WHERE user_id IN (SELECT id FROM "user" WHERE email = ${process.env.SEED_ADMIN_EMAIL ?? 'admin@phoskywiki.local'})`);
    await provide();
  }, { auto: true }],
  browser: [async ({ browser }, provide) => {
    const isolated = new Proxy(browser, {
      get(target, property) {
        if (property === 'newContext') return (options: BrowserContextOptions = {}) => target.newContext({ ...options, extraHTTPHeaders: options.extraHTTPHeaders ?? clientHeaders() });
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await provide(isolated);
  }, { scope: 'worker' }],
});
