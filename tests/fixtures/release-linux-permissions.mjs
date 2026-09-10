// Supplement the real Docker/R2 drill with a Linux root filesystem regression.
// Docker is an external-process fixture here; ownership and UID1000 reads are real.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chown, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
assert.equal(process.getuid(), 0, 'Run this fixture as root in a disposable Linux container');
const directory = await mkdtemp(join(tmpdir(), 'd04-permissions-'));
const image = `sha256:${'a'.repeat(64)}`, sha = 'b'.repeat(40), hash = 'c'.repeat(64);
const schema = { journal: { version: '7', dialect: 'postgresql', entries: [{ tag: '0000_test', when: 1 }] }, files: { '0000_test.sql': hash } };
const server = createServer((req, res) => { res.end('healthy'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function child(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const process = spawn(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    process.stdout.on('data', data => { output += data; });
    process.stderr.on('data', data => { output += data; });
    process.on('error', reject);
    process.on('exit', code => resolve({ code, output }));
  });
}
try {
  const runtime = { DATABASE_URL: 'postgres://test:test@pg:5432/wiki_test', PHOSKYWIKI_ENV: 'test', R2_BUCKET: 'permissions-test', R2_ENDPOINT: 'https://fixture.r2.cloudflarestorage.com' };
  const backup = { appRevision: sha, databaseUrl: runtime.DATABASE_URL, runtime, source: { bucket: runtime.R2_BUCKET, endpoint: runtime.R2_ENDPOINT }, backup: { bucket: 'permissions-test' } };
  for (const [name, content] of Object.entries({ 'runtime.json': JSON.stringify(runtime), 'backup-config.json': JSON.stringify(backup), 'backup-encryption.key': 'x'.repeat(32) })) {
    await writeFile(join(directory, name), content, { mode: 0o600 });
    await chown(join(directory, name), 1000, 1000);
  }
  await writeFile(join(directory, 'deployment.env'), `APP_IMAGE=${image}\nBACKUP_IMAGE=${image}\nSECRETS_DIR=${directory}\n`, { mode: 0o600 });
  const fake = `#!${process.execPath}\nconst a=process.argv.slice(2);let out='';if(a[0]==='image')out=${JSON.stringify(JSON.stringify([{ Id: image, Config: { Labels: { 'org.opencontainers.image.revision': sha } } }]))};else if(a[0]==='inspect')out=${JSON.stringify(JSON.stringify([{ Image: image, State: { Health: { Status: 'healthy' } } }]))};else if(a.includes('none'))out=${JSON.stringify(JSON.stringify(schema))};else if(a.includes('ps'))out='isolated-app';else if(a.some(v=>v.includes('SELECT hash')))out=${JSON.stringify(JSON.stringify([{ hash, created_at: '1' }]))};else if(a.includes('backup'))out=JSON.stringify({ok:true,point:'12345678-1234-4234-8234-123456789012'});console.log(out);\n`;
  await writeFile(join(directory, 'docker'), fake, { mode: 0o755 });
  // UID1000 may traverse this test directory, but cannot read root-only config.
  const { chmod } = await import('node:fs/promises');
  await chmod(directory, 0o711);
  const config = { environment: 'test', directory, project: 'permissions-test', envFile: join(directory, 'deployment.env'), stateDir: join(directory, 'records'), composeFiles: [], target: 'pg:5432/wiki_test/test', bucket: 'permissions-test', healthUrl: `http://127.0.0.1:${server.address().port}`, minDiskBytes: 1, minMemoryBytes: 1 };
  const requestPath = join(directory, 'request.json');
  await writeFile(requestPath, JSON.stringify({ config, receipt: { sha, image, imageId: image }, request: { sha, environment: 'test', notice: 'Linux permissions regression' } }));
  const driver = join(dirname(fileURLToPath(import.meta.url)), 'release-driver.mjs');
  for (let release = 0; release < 2; release++) {
    const result = await child(process.execPath, [driver, requestPath], { env: { ...process.env, PATH: `${directory}:${process.env.PATH}` } });
    assert.equal(result.code, 0, result.output);
    const info = await stat(join(directory, 'backup-config.json'));
    assert.equal(info.uid, 1000, 'Successful root release must preserve backup reader ownership');
    assert.equal(info.gid, 1000);
    assert.equal(info.mode & 0o777, 0o600);
    const read = await child(process.execPath, ['-e', `require('fs').readFileSync(${JSON.stringify(join(directory, 'backup-config.json'))})`], { uid: 1000, gid: 1000 });
    assert.equal(read.code, 0, 'Backup UID1000 can read configuration after every release');
  }
  console.log(JSON.stringify({ passed: true, releases: 2, backupReaderUid: 1000 }));
} finally {
  server.close();
  await rm(directory, { recursive: true, force: true });
}
