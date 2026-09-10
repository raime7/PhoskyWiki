import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';

test('production authentication still limits repeated requests from one visitor', async ({ request }) => {
  test.skip(!process.env.TEST_APP_IMAGE && !process.env.CI, 'Production artifact check');
  const statuses = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await request.post('/api/auth/sign-in/email', {
      headers: { origin: `http://localhost:${process.env.PW_PORT ?? 3000}` },
      data: { email: `${randomUUID()}@example.com`, password: 'wrong-password' },
    });
    statuses.push(response.status());
  }
  expect(statuses).toEqual([401, 401, 401, 429]);
});
