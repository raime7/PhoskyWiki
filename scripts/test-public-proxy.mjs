// Real Caddy + HTTP upstream; test-only addresses stand in for Cloudflare peers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const image = process.env.TEST_CADDY_IMAGE;
if (!image) throw Error('TEST_CADDY_IMAGE_REQUIRED');
const prefix = `phosky-proxy-test-${randomUUID()}`;
const directory = mkdtempSync(join(tmpdir(), prefix));
const docker = args => execFileSync('docker', args, {encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
const nodeImage = 'node:24.14.0-bookworm-slim';
const names = [prefix+'-app',prefix+'-proxy'];
try {
  // Only certificate issuance is replaced; route ordering and headers are real.
  const source = readFileSync(resolve('deploy/Caddyfile.public'),'utf8');
  const config = source.replace(/dns cloudflare \{env.CF_API_TOKEN\}\s+resolvers 1\.1\.1\.1 1\.0\.0\.1/, 'issuer internal');
  assert.notEqual(config,source);
  writeFileSync(join(directory,'Caddyfile'),config);
  docker(['network','create','--internal','--subnet','172.28.71.0/24',prefix]);
  docker(['run','-d','--name',names[0],'--network',prefix,'--ip','172.28.71.3','--network-alias','app',nodeImage,'node','-e',
    "require('http').createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end(JSON.stringify(q.headers))}).listen(3000)"]);
  docker(['run','-d','--name',names[1],'--network',prefix,'--ip','172.28.71.2',
    '-e','CLOUDFLARE_CIDRS=172.28.71.4/32','-v',`${directory}:/etc/caddy:ro`,image,
    'caddy','run','--config','/etc/caddy/Caddyfile','--adapter','caddyfile']);
  function request(trusted,host='phoskywiki.org',port=443,path='/') {
    const code = `const h=require(${JSON.stringify(port===443?'https':'http')});
      const req=h.request({host:'172.28.71.2',servername:${JSON.stringify(host)},port:${port},path:${JSON.stringify(path)},
      rejectUnauthorized:false,headers:{Host:${JSON.stringify(host)},'CF-Connecting-IP':'198.51.100.7','X-Forwarded-For':'192.0.2.99','X-Real-IP':'192.0.2.98','X-Forwarded-Proto':'http','Forwarded':'for=192.0.2.97'}},r=>{let b='';r.on('data',x=>b+=x);r.on('end',()=>console.log(JSON.stringify({status:r.statusCode,location:r.headers.location,body:b}))) });req.setTimeout(10000,()=>req.destroy());req.on('error',()=>process.exit(1));req.end();`;
    const client=prefix+'-client-'+names.length;
    names.push(client);
    return JSON.parse(docker(['run','--rm','--name',client,'--network',prefix,'--ip',trusted?'172.28.71.4':'172.28.71.5',nodeImage,'node','-e',code]));
  }
  // Docker client startup gives Caddy time to initialize its isolated local CA.
  assert.equal(request(false).status,403);
  assert.equal(request(false,'phoskywiki.org',80).status,403);
  assert.equal(request(false,'www.phoskywiki.org').status,403);
  const accepted=request(true);
  assert.equal(accepted.status,200);
  const headers=JSON.parse(accepted.body);
  assert.equal(headers['x-forwarded-for'],'198.51.100.7');
  assert.equal(headers['x-real-ip'],'198.51.100.7');
  assert.equal(headers['x-forwarded-proto'],'https');
  assert.equal(headers.forwarded,undefined);
  assert.equal(headers['cf-connecting-ip'],undefined);
  for(const port of [80,443]) {
    const redirect=request(true,'www.phoskywiki.org',port,'/login?next=terms');
    assert.equal(redirect.status,308);
    assert.equal(redirect.location,'https://phoskywiki.org/login?next=terms');
  }
  assert.equal(request(false,'localhost',8080,'/healthz').status,200);
  assert.equal(request(false,'localhost',8080,'/api/auth/get-session').status,404);
  console.log(JSON.stringify({ok:true,checks:['direct-origin-denied','forged-headers-replaced','www-canonical-redirect','loopback-health-only']}));
} finally {
  for(const name of names.reverse()) { try { docker(['rm','-f',name]); } catch {} }
  try { docker(['network','rm',prefix]); } catch {}
  rmSync(directory,{recursive:true,force:true});
}
