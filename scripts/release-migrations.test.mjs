import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { legacySqlHashes, verifyMigrationHistory, verifyMigrationLedger } from './release-migrations.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const evidence = JSON.parse(readFileSync(new URL('../docs/reports/d06-legacy-migration-hashes.json', import.meta.url)));
const entries = evidence.files.map((file, index) => ({ tag: file.name.slice(0, -4), when: index + 1 }));
const schema = field => ({ journal: { version: '7', dialect: 'postgresql', entries }, files: Object.fromEntries(evidence.files.map(file => [file.name, file[field]])) });
const old = schema('oldRawSha256'), next = schema('newRawSha256');
const ledger = evidence.files.map((file, index) => ({ hash: file.oldRawSha256, created_at: String(index + 1) }));
test('all 13 aliases match exact production evidence and only unquoted line endings differ', () => {
  const changed = evidence.files.filter(file => file.oldRawSha256 !== file.newRawSha256);
  assert.equal(changed.length, 13);
  assert.deepEqual(Object.keys(legacySqlHashes), changed.map(file => file.name));
  for (const file of changed) {
    assert.deepEqual(legacySqlHashes[file.name], [file.oldRawSha256, file.newRawSha256]);
    const sql = readFileSync(new URL(`../drizzle/${file.name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(hash(sql), file.newRawSha256);
    assert.equal(hash(sql.replace(/\n/g, '\r\n')), file.oldRawSha256);
    // These exact historical files contain no dollar strings, block comments,
    // or multiline quoted values/identifiers; don't generalize this to new SQL.
    assert(!/\$[\w]*\$|\/\*/.test(sql));
    for (const token of sql.matchAll(/'(?:''|[^'])*'|"(?:""|[^"])*"/g)) assert(!token[0].includes('\n'));
  }
});
test('legacy to LF is compatible and preserves original ledger hashes', () => {
  assert.equal(verifyMigrationHistory(old, next), true);
  verifyMigrationLedger(old, ledger);
  verifyMigrationLedger(next, ledger);
  assert.equal(verifyMigrationHistory(next, next), true);
});
test('a subsequent release accepts the retained legacy ledger plus new migrations', () => {
  const upgraded = structuredClone(next);
  upgraded.journal.entries.push({ tag: '9999_new', when: 99 });
  upgraded.files['9999_new.sql'] = hash('SELECT 1;');
  assert.equal(verifyMigrationHistory(old, upgraded), false);
  const applied = [...ledger, { hash: upgraded.files['9999_new.sql'], created_at: '99' }];
  verifyMigrationLedger(upgraded, applied);
  assert.equal(verifyMigrationHistory(upgraded, upgraded), true);
});
test('rejects content edits, unknown aliases and reintroducing CRLF', () => {
  assert.throws(() => verifyMigrationHistory(next, old), /MIGRATION_HISTORY_DIVERGED/);
  const changed = structuredClone(next);
  changed.files[evidence.files[0].name] = hash('SELECT 2;');
  assert.throws(() => verifyMigrationHistory(old, changed), /MIGRATION_HISTORY_DIVERGED/);
  assert.throws(() => verifyMigrationLedger(changed, ledger), /DATABASE_MIGRATION_DRIFT/);
});
test('requires the actual CRLF ledger before first upgrade; never rewrites it', () => {
  const rewritten = structuredClone(ledger);
  rewritten[0].hash = evidence.files[0].newRawSha256;
  assert.throws(() => verifyMigrationLedger(old, rewritten), /DATABASE_MIGRATION_DRIFT/);
});
test('rejects missing rows, changed timestamps and journal divergence', () => {
  assert.throws(() => verifyMigrationLedger(next, ledger.slice(1)), /DATABASE_MIGRATION_DRIFT/);
  assert.throws(() => verifyMigrationLedger(next, ledger.map(row => ({ ...row, created_at: '0' }))), /DATABASE_MIGRATION_DRIFT/);
  const divergent = structuredClone(next);
  divergent.journal.entries[0].when = 999;
  assert.throws(() => verifyMigrationHistory(old, divergent), /MIGRATION_HISTORY_DIVERGED/);
});
