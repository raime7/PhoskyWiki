import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function evaluateStatus(s, now=Date.now()) {
  if (![s.timestamp,s.backupVerifiedAt,s.diskPercent,s.memoryPercent,s.retentionAt].every(Number.isFinite) || Math.abs(now-s.timestamp)>300000 || s.backupVerifiedAt>now+300000 || typeof s.timerActive!=='boolean' || typeof s.containersHealthy!=='boolean') return ['STATUS_INVALID'];
  const issues=[];
  if (s.backupResult!=='success') issues.push('BACKUP_FAILED');
  if (!s.timerActive) issues.push('BACKUP_TIMER_STOPPED');
  const age=now-s.backupVerifiedAt;
  if (age>=86400000) issues.push('BACKUP_RPO_EXCEEDED');
  else if (age>=18*3600000) issues.push('BACKUP_AGING');
  if (s.diskPercent>=85) issues.push('DISK_PRESSURE');
  if (s.memoryPercent>=90) issues.push('MEMORY_PRESSURE');
  if (!s.containersHealthy) issues.push('CONTAINER_UNHEALTHY');
  if (now-s.retentionAt>3*86400000) issues.push('RETENTION_STALE');
  return issues;
}

async function run() {
  const problems=[];
  for (const path of ['/healthz','/login']) {
    try {
      const response=await fetch(`https://phoskywiki.org${path}`,{signal:AbortSignal.timeout(20000),redirect:'error'});
      if (response.status!==200) problems.push(path==='/healthz'?'SITE_HEALTH_FAILED':'LOGIN_UNAVAILABLE');
      await response.body?.cancel();
    } catch {problems.push('SITE_UNREACHABLE');}
  }
  try {
    const output=execFileSync('ssh',['-i',process.env.MONITOR_KEY_FILE,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',`UserKnownHostsFile=${process.env.MONITOR_HOSTS_FILE}`,'-o','ConnectTimeout=15',process.env.MONITOR_SSH_TARGET,'status'],{timeout:30000,encoding:'utf8',stdio:['ignore','pipe','pipe']});
    problems.push(...evaluateStatus(JSON.parse(output)));
  } catch {problems.push('ORIGIN_MONITOR_UNREACHABLE');}
  const mode=process.env.MONITOR_DRILL || 'none';
  if (mode==='failure') problems.push('DRILL_SIMULATED_FAILURE');
  const title=mode==='none'?'[运维告警] PhoskyWiki production':'[告警演练] PhoskyWiki notification';
  const marker=mode==='none'?'<!-- phosky-monitor-v1 -->':'<!-- phosky-monitor-drill-v1 -->';
  const repo=process.env.GITHUB_REPOSITORY;
  if (repo!=='raime7/PhoskyWiki') throw Error('REPOSITORY_MISMATCH');
  async function api(path,method='GET',body) {
    const response=await fetch(`https://api.github.com/repos/${repo}${path}`,{method,headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw Error('GITHUB_API_FAILED');
    return response.status===204?null:response.json();
  }
  let existing;
  for(let page=1;page<=10;page++) {
    const issues=await api(`/issues?state=open&per_page=100&page=${page}`);
    existing=issues.find(i=>!i.pull_request && i.title===title && i.body?.startsWith(marker));
    if(existing || issues.length<100) break;
    if(page===10) throw Error('ISSUE_SCAN_LIMIT');
  }
  const codes=[...new Set(problems)].sort();
  const fingerprint=codes.join(',');
  const runUrl=`https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const body=`${marker}\n<!-- codes:${fingerprint} -->\n\n${mode==='none'?'生产检查发现异常':'通知演练（不会停止生产服务）'}：${fingerprint}\n\n[检查记录](${runUrl})\n\n请检查备份服务、恢复点年龄及主机状态。只有完整备份并校验成功才刷新恢复点时间。`;
  if(codes.length) {
    if(!existing) await api('/issues','POST',{title,body,assignees:['raime7']});
    else if(!existing.body.includes(`<!-- codes:${fingerprint} -->`)) {
      await api(`/issues/${existing.number}`,'PATCH',{body});
      await api(`/issues/${existing.number}/comments`,'POST',{body:`告警状态变化：${fingerprint}。 [检查记录](${runUrl})`});
    }
  } else if(existing) {
    await api(`/issues/${existing.number}/comments`,'POST',{body:`检查已恢复正常。 [检查记录](${runUrl})`});
    await api(`/issues/${existing.number}`,'PATCH',{state:'closed',state_reason:'completed'});
  }
  console.log(JSON.stringify({ok:!codes.length,codes,mode}));
  if(codes.length) process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) run().catch(()=>{console.error('MONITOR_FAILED');process.exitCode=1;});
