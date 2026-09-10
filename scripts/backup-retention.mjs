import { readFile, stat } from 'node:fs/promises';
import { createDecipheriv } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const day = 86400000;
export function retentionPlan(points, now = Date.now()) {
  const ids = new Set();
  for (const p of points) {
    if (!p.point || ids.has(p.point) || !Number.isFinite(Date.parse(p.createdAt)) || Date.parse(p.createdAt) > now) throw Error('INVALID_POINT_METADATA');
    ids.add(p.point);
  }
  const sorted = [...points].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  const weeks = new Set(), keep = [], remove = [];
  for (const p of sorted) {
    const time = Date.parse(p.createdAt);
    const date = new Date(time);
    const week = Math.floor(time / day) - (date.getUTCDay() + 6) % 7;
    const weekly = !weeks.has(week) && weeks.size < 4;
    weeks.add(week);
    (time >= now - 14 * day || weekly ? keep : remove).push(p);
  }
  return { keep, remove };
}

async function protectedFile(path) {
  const info = await stat(path);
  if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077))) throw Error('SECRET_PERMISSIONS');
  return readFile(path);
}

export async function runRetention(values) {
  const config = JSON.parse(await protectedFile(values.config));
  const cleanup = JSON.parse(await protectedFile(values.credentials));
  const { bucket, prefix, endpoint } = config.backup;
  if (values.bucket !== bucket || !/^[a-zA-Z0-9/_-]{1,128}\/$/.test(prefix)) throw Error('TARGET_MISMATCH');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.r2.cloudflarestorage.com') || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('ENDPOINT_INVALID');
  const key = await protectedFile(values['key-file']);
  if (key.length !== 32) throw Error('KEY_INVALID');
  const client = new S3Client({ endpoint, region:'auto', credentials:cleanup });
  try {
    const objects = [];
    let token;
    do {
      const result = await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:prefix,ContinuationToken:token}));
      objects.push(...result.Contents || []);
      if (objects.length > 100000) throw Error('OBJECT_LIMIT');
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
      if (result.IsTruncated && !token) throw Error('INVALID_PAGINATION');
    } while (token);
    const points = [];
    for (const object of objects) {
      const relative = object.Key.slice(prefix.length);
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/manifest\.enc$/.test(relative)) continue;
      if (object.Size > 16 * 1024 * 1024 + 64) throw Error('MANIFEST_TOO_LARGE');
      const result = await client.send(new GetObjectCommand({Bucket:bucket,Key:object.Key,IfMatch:object.ETag}));
      const bytes = Buffer.from(await result.Body.transformToByteArray());
      if (!bytes.subarray(0,9).equals(Buffer.from('PWBACKUP1')) || bytes.length < 37) throw Error('INTEGRITY_FAILED');
      const decipher = createDecipheriv('aes-256-gcm',key,bytes.subarray(9,21));
      decipher.setAAD(Buffer.from(object.Key));
      decipher.setAuthTag(bytes.subarray(-16));
      const manifest = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(21,-16)),decipher.final()]).toString());
      const point = relative.split('/')[0];
      if (manifest.format !== 1 || manifest.point !== point || !Array.isArray(manifest.files) || !manifest.files.some(f=>f.kind === 'database' && f.name === 'database.enc')) throw Error('MANIFEST_INVALID');
      const names = new Set();
      for (const file of manifest.files) {
        if (!/^(database|image-\d+)\.enc$/.test(file.name) || names.has(file.name)) throw Error('MANIFEST_INVALID');
        names.add(file.name);
        if (file.storageKey !== undefined && (file.kind !== 'image' || !/^[a-f0-9]{64}$/.test(file.sha256) || file.storageKey !== `${prefix}images/${file.sha256}.enc`)) throw Error('MANIFEST_INVALID');
      }
      points.push({point,createdAt:manifest.createdAt,names:[...names],manifestKey:object.Key});
    }
    const plan = retentionPlan(points);
    if (!plan.keep.length || Date.now() - Date.parse(plan.keep[0].createdAt) > 18 * 3600000) throw Error('NO_FRESH_RECOVERY_POINT');
    const backupBytes = objects.reduce((total, object) => {
      if (!Number.isSafeInteger(object.Size) || object.Size < 0) throw Error('OBJECT_SIZE_INVALID');
      return total + object.Size;
    }, 0);
    const report = {ok:true,apply:!!values.apply,bucket,backupBytes,keep:plan.keep.map(p=>p.point),remove:plan.remove.map(p=>p.point),deletedObjects:0,sharedImages:'preserved'};
    if (values.apply) {
      for (const p of plan.remove) {
        // Unpublish first. Never delete shared images, unknown objects or incomplete points.
        for (const name of ['manifest.enc',...p.names]) {
          const objectKey = `${prefix}${p.point}/${name}`;
          const object = objects.find(o=>o.Key === objectKey);
          if (!object) continue;
          await client.send(new DeleteObjectCommand({Bucket:bucket,Key:objectKey,IfMatch:object.ETag}));
          report.deletedObjects++;
        }
      }
    }
    return report;
  } finally { key.fill(0); client.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {values} = parseArgs({options:{config:{type:'string'},credentials:{type:'string'},'key-file':{type:'string'},bucket:{type:'string'},apply:{type:'boolean'}}});
    console.log(JSON.stringify(await runRetention(values)));
  } catch { console.error('BACKUP_RETENTION_FAILED'); process.exitCode=1; }
}
