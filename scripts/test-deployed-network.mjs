// Read-only public probes plus four invalid-login requests; no real account used.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Socket } from 'node:net';
import { writeFileSync } from 'node:fs';

const base='https://phoskywiki.org';
const report={startedAt:new Date().toISOString(),site:base,ok:false,checks:{}};
const fetchSite=(path,options={})=>fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(20000),...options});
try {
  for(const path of ['/healthz','/login','/api/auth/get-session','/api/admin/search/status']) {
    const response=await fetchSite(path);
    const result={status:response.status,cache:response.headers.get('cf-cache-status'),age:response.headers.get('age')};
    report.checks[path]=result;
    assert.equal(response.status,path==='/api/admin/search/status'?401:200);
    assert.notEqual(result.cache,'HIT');
    assert.equal(result.age,null);
    await response.body?.cancel();
  }
  const redirect=await fetch('https://www.phoskywiki.org/login?next=terms',{redirect:'manual',signal:AbortSignal.timeout(20000)});
  report.checks.www={status:redirect.status,location:redirect.headers.get('location')};
  assert.equal(redirect.status,308);
  assert.equal(redirect.headers.get('location'),base+'/login?next=terms');
  await redirect.body?.cancel();
  const statuses=[];
  for(let i=0;i<4;i++) {
    const response=await fetchSite('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,
      'X-Forwarded-For':`192.0.2.${10+i}`,'X-Real-IP':`198.51.100.${10+i}`,'X-Forwarded-Proto':'http'},
      body:JSON.stringify({email:`d07-missing-${randomUUID()}@example.invalid`,password:'not-a-real-account-password'})});
    statuses.push(response.status);
    await response.body?.cancel();
  }
  report.checks.forgedHeadersLoginStatuses=statuses;
  assert.deepEqual(statuses,[401,401,401,429]);
  const spoof=await fetchSite('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,'CF-Connecting-IP':'203.0.113.9'},body:'{}'});
  report.checks.forgedCloudflareHeaderStatus=spoof.status;
  assert.equal(spoof.status,403);
  await spoof.body?.cancel();
  const ports={};
  for(const port of [3000,5432,7700,8080,2019,443]) {
    ports[port]=await new Promise(resolve=>{
      const socket=new Socket();
      const end=value=>{socket.destroy();resolve(value);};
      socket.setTimeout(2500,()=>end('timeout'));
      socket.once('connect',()=>end('open'));
      socket.once('error',()=>end('refused-or-unreachable'));
      socket.connect(port,'141.164.63.81');
    });
    assert.notEqual(ports[port],'open');
  }
  report.checks.originPorts=ports;
  report.ok=true;
} catch {
  report.error='DEPLOYED_NETWORK_CHECK_FAILED';
  process.exitCode=1;
} finally {
  report.finishedAt=new Date().toISOString();
  writeFileSync('docs/reports/d07-network.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
