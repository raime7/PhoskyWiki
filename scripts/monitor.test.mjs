import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStatus, evaluateCertificate } from './monitor.mjs';
const now = 1789016400000;
const healthy = { timestamp:now, backupVerifiedAt:now-3600000,backupResult:'success',timerActive:true,diskPercent:20,memoryPercent:50,containersHealthy:true,retentionAt:now,
  search: { available:true,degraded:false,lastReindexAt:now,lastReindexResult:'success' }, searchTimerActive:true,searchResult:'success',restartCount:0,logsRotated:true,backupBytes:1024,
  staging:{completedAt:now,timerActive:true,result:'success'} };
test('healthy site and fresh fully verified backup are quiet',()=>assert.deepEqual(evaluateStatus(healthy,now),[]));
test('detects stopped scheduler, failure, old recovery point and resource pressure',()=>{
  assert.deepEqual(evaluateStatus({...healthy,backupResult:'failed',timerActive:false,backupVerifiedAt:now-25*3600000,diskPercent:91,memoryPercent:94,containersHealthy:false,retentionAt:0},now),['BACKUP_FAILED','BACKUP_TIMER_STOPPED','BACKUP_RPO_EXCEEDED','DISK_PRESSURE','MEMORY_PRESSURE','CONTAINER_UNHEALTHY','RETENTION_STALE']);
});
test('search failure, missing reconciliation and restart/log thresholds are observable',()=>{
  assert.deepEqual(evaluateStatus({...healthy, search:{ available:false,degraded:true,lastReindexAt:now-25*3600000,lastReindexResult:'failed' },searchTimerActive:false,searchResult:'failed',restartCount:3,logsRotated:false},now),
    ['SEARCH_UNAVAILABLE','SEARCH_INCREMENT_FAILED','SEARCH_REINDEX_FAILED','SEARCH_TIMER_STOPPED','SEARCH_REINDEX_STALE','CONTAINER_RESTARTS','LOG_ROTATION_INVALID']);
});
test('missing search observations and impossible measurements cannot report healthy',()=>{
  assert.deepEqual(evaluateStatus({...healthy,search:undefined},now),['STATUS_INVALID']);
  assert.deepEqual(evaluateStatus({...healthy,diskPercent:-1},now),['STATUS_INVALID']);
});
test('warns before RPO expiry and rejects stale or malformed observations',()=>{
  assert.deepEqual(evaluateStatus({...healthy,backupVerifiedAt:now-19*3600000},now),['BACKUP_AGING']);
  assert.deepEqual(evaluateStatus({...healthy,timestamp:now-600000},now),['STATUS_INVALID']);
  assert.deepEqual(evaluateStatus({},now),['STATUS_INVALID']);
});
test('certificate expiry warns at fourteen days; invalid certificates fail closed',()=>{
  assert.deepEqual(evaluateCertificate(now+15*86400000,now),[]);
  assert.deepEqual(evaluateCertificate(now+14*86400000,now),['CERTIFICATE_EXPIRING']);
  assert.deepEqual(evaluateCertificate(NaN,now),['CERTIFICATE_INVALID']);
});
test('backup capacity includes retained shared objects and has an explicit adjustable threshold',()=>{
  assert.deepEqual(evaluateStatus({...healthy,backupBytes:2048},now,2048),['BACKUP_CAPACITY']);
  assert.deepEqual(evaluateStatus({...healthy,backupBytes:undefined},now),['STATUS_INVALID']);
});
test('staging cleanup failure, missing timer and stale receipt require action',()=>{
  assert.deepEqual(evaluateStatus({...healthy, staging:{completedAt:now-4*3600000,timerActive:false,result:'exit-code'}},now),
    ['STAGING_CLEANUP_FAILED','STAGING_TIMER_STOPPED','STAGING_CLEANUP_STALE']);
});
