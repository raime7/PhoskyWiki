import { isDeepStrictEqual } from 'node:util';

// Exact, reviewed CRLF bytes from the legacy Windows production image, paired
// with the LF bytes of the same 13 SQL files. Never normalize arbitrary SQL:
// quoted values can contain meaningful newlines. Keep aliases for existing DB
// ledger rows after the LF image is deployed; never rewrite the ledger.
export const legacySqlHashes = {
  '0000_enable_pg_trgm.sql': ['0fc0ab8fe86731ac214a34c1e496175f7a6d85588a8f0e3a7c981399e1e77d57', '4ff1e9563c12f1051ddfdefb860b2a77f42ccdd30a4a1911535de9c8d1c15854'],
  '0001_military_cobalt_man.sql': ['c7b30cd56b4377725773cb22bd19b71c71d5274800150b006b70f8acfa5a7f91', 'd09636369bcf8022eca3d8aaeb9b00f1b6a5ee9cf895a17b05fd596da54f32e0'],
  '0002_careful_ted_forrester.sql': ['d7c5b66ba0b71ab2ae145f6bc21e737331a6b20a084be633d31500bbe166aec3', 'd07a435136428a99d17a0e652c3845f261b76b3f7fa6fe33c59460226e341c46'],
  '0003_lyrical_black_bird.sql': ['d916dc8eb2af3a0f75e9ce9fc8f024cb926c4bb1778a8a2f29f1fd35f6d141ea', '76a9bb5de89a6795adf07062b68316bea3a2f7ed6736bbc87c0385f7ca6bf2a4'],
  '0006_overconfident_purple_man.sql': ['9a8f9868b1cfa0e162e06c43518c48ae7906b3174dccc7299f654808efe5b019', '2438328e84df9e6c68bdba7a7f936d31173a8cd540884534072e187050422925'],
  '0007_submission_notifications.sql': ['0409e9277847b4ee0d19ed63e48ea2a18d8bc34cfc9433d52d920a15837d902c', 'a22f581b256ac5bf79c069dc4edfb58247dab4c4873e2432c4a0652db2de0184'],
  '0008_revision_rollback_source.sql': ['18a20729b92627be68083160892cd99a99a174c508cdca0b9622f7a53cc45490', 'd5cae9e16b352caec6d8e261b7a12ceba0d396d482b9fcb8e95fd4763539f83e'],
  '0009_productive_captain_america.sql': ['20fd81c5de5b7c518fbd9489137776442dce5cd05fd9af7140888a1baaea1bca', '5a4c5376c5cf1b451dc8d8640115ac0e6d763c78e54fdee40783aa3f4319ebe9'],
  '0010_clever_old_lace.sql': ['6e01ae0940db93f5af4a05cc957f0d097cbdb371b6fd3e6322ce334d839bf24f', '0f1ddfbcb65997e87c858dc712ecd374feed62aebf25dc51b4d8ce3abcb0a0b2'],
  '0012_public_klaw.sql': ['d204abd6036b2509ca3c3a6eb16c2358689085be818488fbb34d5cde016ea14b', '017a16c5c51b6a52dcdc38e6902f51cf8bc2a164847fe026888de5375011349b'],
  '0013_dear_kronos.sql': ['001f9b3f5d29af8a73f4ee9a0c4f372b9aad1694c5951cefdd6e2e81232da60c', 'fb760482bf0b443e732da856128614da5ec1b108b444ce959989a9ce9ce16d19'],
  '0014_mature_overlord.sql': ['6270c620445656e4f10ae22beab9b335830cbc289d2dccc964e2480be8e37e76', '1f1fbad6af442b2c297c1ba659ee9d53e9d7fa9905755d69229053829a981c2e'],
  '0015_stormy_warpath.sql': ['938dce24f5a7073c73c59042a8af1a8475498473820f7479c385788b6145060b', 'da79641ea9ae89165ee014a2f0393bfb7f8a1c85b9a89a6c2a6394b82a9e5b23'],
};
const matchesForward = (file, oldHash, newHash) => oldHash === newHash ||
  (legacySqlHashes[file]?.[0] === oldHash && legacySqlHashes[file]?.[1] === newHash);

export function verifyMigrationHistory(before, after) {
  if (before.journal.version !== after.journal.version || before.journal.dialect !== after.journal.dialect
    || !isDeepStrictEqual(before.journal.entries, after.journal.entries.slice(0, before.journal.entries.length))
    || Object.entries(before.files).some(([file, hash]) => !matchesForward(file, hash, after.files[file]))) throw new Error('MIGRATION_HISTORY_DIVERGED');
  return isDeepStrictEqual(before.journal, after.journal) && Object.keys(before.files).length === Object.keys(after.files).length;
}

export function verifyMigrationLedger(schema, applied) {
  if (applied.length !== schema.journal.entries.length || schema.journal.entries.some((entry, index) => {
    const file = `${entry.tag}.sql`, row = applied[index];
    return row.created_at !== String(entry.when) || !matchesForward(file, row.hash, schema.files[file]);
  })) throw new Error('DATABASE_MIGRATION_DRIFT');
}
