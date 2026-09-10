import assert from 'node:assert/strict';
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

export async function runReleaseScenarios({ directory, project, env, override, origin, revision, page, term, compose, exec, releaseSettings }) {
  const envFile = join(directory, 'deployment.env');
  await writeFile(envFile, `APP_IMAGE=${env.APP_IMAGE}\nBACKUP_IMAGE=${env.BACKUP_IMAGE}\nSECRETS_DIR=${directory}\n`, { mode: 0o600 });
  const config = { environment: 'test', directory: process.cwd(), project, envFile, stateDir: join(directory, 'releases'), composeFiles: [resolve('compose.production.yml'), resolve('compose.backup.yml'), override], target: 'postgres:5432/phoskywiki_test/phosky', bucket: releaseSettings.bucket, healthUrl: `${origin}/healthz`, minDiskBytes: 256 * 1024 ** 2, minMemoryBytes: 256 * 1024 ** 2 };
  const request = { environment: 'test', sha: revision, notice: 'Isolated D04 maintenance drill' };
  const receipt = { sha: revision, image: env.APP_IMAGE, imageId: env.APP_IMAGE };
  const records = [];
  let counter = 0;
  async function run(overrides = {}) {
    const path = join(directory, `request-${counter++}.json`);
    await writeFile(path, JSON.stringify({ config, receipt, request, ...overrides }), { mode: 0o600 });
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['tests/fixtures/release-driver.mjs', path], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', value => { output += value; });
      child.on('error', reject);
      child.on('exit', code => {
        try { const result = JSON.parse(output.trim()); records.push({ code, ...result }); resolve({ code, ...result }); } catch { reject(new Error('Release subprocess emitted invalid evidence')); }
      });
    });
  }
  async function contentSurvives() {
    assert.equal((await page.request.get(`${origin}${term.href}`)).status(), 200);
    assert((await (await page.request.get(`${origin}${term.href}`)).text()).includes('生产容器中创建的第一篇正文'));
  }
  const s3 = new S3Client({ endpoint: releaseSettings.endpoint, region: 'auto', credentials: releaseSettings });
  const prefix = `d04/${project}/`;
  try {
    assert.match((await run({ config: { ...config, target: 'wrong:5432/phoskywiki_test/phosky' } })).error, /TARGET_MISMATCH/);
    await contentSurvives();
    assert.equal((await run({ config: { ...config, minDiskBytes: Number.MAX_SAFE_INTEGER } })).error, 'INSUFFICIENT_RESOURCES');
    const backupPath = join(directory, 'backup-config.json');
    const backup = await readFile(backupPath);
    await unlink(backupPath);
    assert.equal((await run()).code, 1);
    await writeFile(backupPath, backup, { mode: 0o600 });
    await contentSurvives();
    // Two real CLI processes; at most one reaches backup/migration.
    const parallel = await Promise.all([run(), run()]);
    assert.equal(parallel.filter(result => result.result === 'succeeded').length, 1, JSON.stringify(parallel));
    assert.equal(parallel.filter(result => result.error?.startsWith('RELEASE_LOCKED')).length, 1);
    assert(parallel.find(result => result.result === 'succeeded').maintenanceTargetMet);
    await contentSurvives();
    // A write after the first recovery point must survive later application fallback.
    const added = await page.request.post(`${origin}/api/submissions`, { data: { kind: 'new_term', title: `发布后新增-${project}`, content: '备份之后的新增内容仍然存在。' } });
    assert.equal(added.status(), 201);
    const addedTerm = await added.json();
    const faultDirectory = join(directory, 'fault-build');
    await mkdir(faultDirectory);
    const baseTag = `${project}:base`;
    await exec('docker', ['tag', env.APP_IMAGE, baseTag], undefined, true);
    for (const mode of ['unhealthy', 'migration', 'incompatible']) {
      const fault = join(faultDirectory, 'fault.mjs');
      const partialMigration = `const {readFileSync}=await import('node:fs');const {default:pg}=await import('pg');const p=new pg.Pool({connectionString:JSON.parse(readFileSync('/run/secrets/runtime.json')).DATABASE_URL});await p.query('CREATE TABLE d04_partial (evidence text)');await p.end();process.exit(1);`;
      await writeFile(fault, `import {spawn} from 'node:child_process';\nconst args=process.argv.slice(2);if(args[0]===${JSON.stringify(mode === 'migration' ? 'migrate' : 'serve')}){${mode === 'migration' ? partialMigration : 'process.exit(1);'}}const c=spawn(process.execPath,['scripts/container-entrypoint.mjs',...args],{stdio:'inherit'});c.on('exit',code=>process.exit(code??1));\n`);
      const dockerfile = join(faultDirectory, 'Dockerfile');
      // Build faults on the exact tested image; never rebuild application code.
      await writeFile(dockerfile, `FROM ${baseTag}\nCOPY fault.mjs /app/fault.mjs\n${mode === 'incompatible' ? 'USER root\nRUN echo "-- changed schema requires manual review" > /app/drizzle/d04-extra.sql\nUSER node\n' : ''}ENTRYPOINT ["node", "/app/fault.mjs"]\nCMD ["serve"]\n`);
      const tag = `${project}:${mode}`;
      await exec('docker', ['build', '--provenance=false', '-t', tag, faultDirectory], undefined, true);
      const image = await exec('docker', ['image', 'inspect', tag, '--format', '{{.Id}}'], undefined, true);
      const result = await run({ receipt: { ...receipt, image, imageId: image } });
      if (mode === 'unhealthy') {
        assert.equal(result.result, 'failed-old-app-restored', JSON.stringify(result));
        assert((await (await page.request.get(`${origin}${addedTerm.href}`)).text()).includes('备份之后的新增内容仍然存在'));
      } else {
        assert.equal(result.result, 'manual-recovery-required', JSON.stringify(result));
        assert.equal(result.migration, mode === 'migration' ? 'in-progress' : 'succeeded');
        assert.match((await run()).error, /RELEASE_LOCKED/);
        // Explicit operator recovery: remove ONLY the known fixture table.
        // Production release never performs these recovery operations.
        if (mode === 'migration') await compose(['exec', '-T', 'postgres', 'psql', '-U', 'phosky', '-d', 'phoskywiki_test', '-c', 'DROP TABLE d04_partial']);
        await compose(['up', '-d', '--no-deps', '--wait', 'app']);
        await unlink(join(config.stateDir, 'release.lock'));
        await contentSurvives();
      }
    }
    return { passed: true, records };
  } finally {
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/d04-release-records.json', JSON.stringify(records, null, 2));
    // Only this randomly generated test prefix is deleted, never the bucket.
    let token;
    do {
      const list = await s3.send(new ListObjectsV2Command({ Bucket: releaseSettings.bucket, Prefix: prefix, ContinuationToken: token }));
      if (list.Contents?.length) await s3.send(new DeleteObjectsCommand({ Bucket: releaseSettings.bucket, Delete: { Objects: list.Contents.map(({ Key }) => ({ Key })) } }));
      token = list.NextContinuationToken;
    } while (token);
    s3.destroy();
  }
}
