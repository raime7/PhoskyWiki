// Playwright owns this child and its isolated test database.
import { spawn, spawnSync } from 'node:child_process';
const image = process.env.TEST_APP_IMAGE;
if (!/^sha256:[a-f0-9]{64}$/.test(image || '') || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('ISOLATED_CI_IMAGE_REQUIRED');
const name = process.env.PW_CONTAINER_NAME;
if (!/^phosky-e2e-[a-f0-9]{12}$/.test(name || '')) throw new Error('ISOLATED_CONTAINER_NAME_REQUIRED');
const args = ['run', '--rm', '--name', name, ...(process.platform === 'win32' ? ['-p', '127.0.0.1:3000:3000'] : ['--network', 'host']), '--init', '--entrypoint', 'node'];
// Empty R2 overrides deliberately prevent live credentials. This exercises the
// production Next build with the same isolated settings as the existing suite.
for (const key of ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'MEILI_HOST', 'MEILI_INDEX_UID', 'R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
  let value = process.env[key] || '';
  if (key === 'DATABASE_URL' && process.platform === 'win32') {
    const url = new URL(value);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
    url.hostname = 'host.docker.internal'; value = url.href;
  }
  args.push('-e', `${key}=${value}`);
}
args.push('-e', 'PHOSKYWIKI_ENV=test', image, 'node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0');
const child = spawn('docker', args, { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { spawnSync('docker', ['stop', '--time', '10', name], { stdio: 'ignore' }); });
child.on('error', () => process.exit(1));
child.on('exit', code => process.exit(code ?? 1));
