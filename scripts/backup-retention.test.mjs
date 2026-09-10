import test from 'node:test';
import assert from 'node:assert/strict';
import { retentionPlan } from './backup-retention.mjs';

const now = Date.parse('2026-09-10T12:00:00Z');
const point = (day, id) => ({ point: id, createdAt: new Date(now - day * 86400000).toISOString() });
test('keeps every point within 14 days and newest point in four populated UTC weeks', () => {
  const points = [point(0,'a'),point(1,'b'),point(13,'c'),point(14.1,'d'),point(20,'e'),point(21,'f'),point(28,'g'),point(35,'h')];
  const plan = retentionPlan(points, now);
  assert.deepEqual(plan.remove.map(p=>p.point), ['d','f','h']);
  assert.deepEqual(plan.keep.map(p=>p.point), ['a','b','c','e','g']);
});
test('never deletes the only available recovery point even after 14 days', () => {
  assert.deepEqual(retentionPlan([point(40,'a')],now).remove, []);
});
test('rejects future, invalid, and duplicate metadata before planning deletion', () => {
  for (const points of [[point(-1,'a')],[{point:'a',createdAt:'invalid'}],[point(0,'a'),point(1,'a')]]) {
    assert.throws(()=>retentionPlan(points,now));
  }
});
