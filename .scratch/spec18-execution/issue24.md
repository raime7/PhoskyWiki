# #24 — 词条信息编辑、审核与改名闭环

Commit: a918dd9aab55a86eae5acf0f2fe0d64839cff721
Branch/worktree: codex/spec18-24 / D:/PhoskyWiki-worktrees/spec18-24
Dedicated DB: phosky_spec18_24; browser port 3124; no shared Meilisearch configured.

## Delivered

- 词条页登录后分别提供“编辑词条信息”和“编辑通俗视角”；词条表单只含标题/简介/别名，不含Markdown正文，视角保留独立页面和head。
- SubmissionForm新增edit_term分支，仍提交kind=edit、pageId、baseRevisionId及完整title/summary/aliases。客户端草稿按词条id与base保存，刷新恢复全部字段；成功删除草稿，过期草稿不覆盖新版；损坏/不可用localStorage不阻止编辑。
- 元数据编辑复用既有quorum快照和投票终态；逐字段对比同时用于管理员审核队列、编者个人提交详情。首票后立即刷新队列票数。
- 普通受理与管理员直编都写入结构化词条快照；标题更新slug，但id不变。search sync沿既有依赖扩展，摘要/别名不作为Markdown解析，不发布其中图片或双链。
- 旧修订原样保留。迁移从当前pages/terms字段追加source=baseline快照，不从历史正文猜测元数据。迁移后导入的旧行在首次打开编辑页时由页面锁串行建立一次baseline。无结构化快照的base被HTTP400明确拒绝。
- 过期普通提案受理时系统驳回；管理员过期编辑409。词条唯一索引在生效事务内保护改名；最后一票撞名时投票、公开字段、修订全部回滚；同一票可重试，不留下部分票。
- 改名后旧URL跳转同一id的新规范URL；既有普通及显式双链保持可达；别名仅展示，不参与解析。

## Interfaces for #25 / #26

src/lib/revision-snapshot.ts:
- TermSnapshot = {version: 1, type: 'term', title: string, summary: string, aliases: string[]}
- termSnapshot(fields) builds an owned snapshot.
- compareTermMetadata(from,to) returns field/label/before/after/changed rows. Alias elements quoted so array-boundary differences remain visible.
- RevisionSource = legacy | baseline | create | approval | direct | rollback.

revisions adds snapshot JSONB nullable, source text NOT NULL DEFAULT legacy, createdBy nullable FK users ON DELETE SET NULL. Migration: drizzle/0013_dear_kronos.sql + generated meta snapshot/journal. Old rows remain snapshot=null/source=legacy, so #25 must not allow metadata rollback from them.

src/lib/review.ts:
- getTermEditingState(pageId) -> {snapshot, baseRevisionId}. Locks live page, reads real fields, appends one baseline only when current head lacks snapshot.
- applyTermMetadataChange(tx,pageId,snapshot,rollbackFromId=null,attribution={createdBy?,source?}) -> revisionId. Caller holds lockLivePage and uses transactionWithSearchSync. Updates page title/slug + terms payload, adds full snapshot, clears metadata-page outgoing links, queues sync. rollbackFromId sets source=rollback.
- applyContentChange gained optional fifth attribution arg with same shape. Existing fourth rollback argument remains compatible. Create paths use source=create; normal edit source=approval; administrator edit source=direct.
- Term revisions retain a generated JSON code-block content projection for existing getHeadContent/import readers. Structured snapshot is authoritative; #25 must not parse this projection to invent legacy metadata.
- QueueItem.currentMetadata contains current real fields for term edits, null for perspectives.
- getMySubmission returns baseSnapshot with same visibility suppression as baseContent. Full proposal fields and existing kind/pageId/baseRevisionId are preserved; #26 can reuse edit_term without guessing.

Integration conflicts anticipated:
- Preserve #22 validate/createSubmission whole-transaction and parent-lock semantics while retaining term branch and applySubmission source attribution.
- Preserve #23 resolvedWikiLinks?: [string,WikiLinkTarget][] propagation on perspective edit branch; edit_term needs no Markdown renderer.
- Did not modify history.ts or wiki link parser/resolver; #25 history compare/rollback UI and #26 resubmission flow remain assigned downstream.

## Verification

- pnpm install --offline --frozen-lockfile: success, independent node_modules.
- pnpm db:migrate: success on dedicated DB, including 0013; pnpm db:seed only dedicated DB.
- TDD initial HTTP term edit failed 400 vs expected201; after implementation passed. Pure alias-boundary diff regression failed before comparator correction, then passed.
- pnpm test tests/integration/term-edit.test.ts: final 5 passed, 2026-09-08 12:34. Covers two votes/private-before-public, structured history/provenance, direct edit and stale base, late title clash and same-vote retry atomicity, complete-field validation, HTTP search new title/summary/alias and stable id.
- pnpm test tests/integration/production.test.ts tests/integration/term-edit.test.ts tests/unit/revision-snapshot.test.ts: 12 passed. Full-suite discovery found old getHeadContent consumers expected metadata text; fixed by preserving safe code-block projection, leaving structured snapshot authoritative.
- SEARCH_CONTRACT_HOST=http://127.0.0.1:1 pnpm test: 26 files passed / 2 skipped; 222 tests passed / 6 skipped (12:32, 40.47s). Five real Meili tests deliberately skipped to avoid concurrent shared-index mutation per orchestration; one real R2 test skipped because contract credentials are absent. These are not claimed as passed. Final subsequent change only uses wall-clock createdAt for metadata/baseline writes, matching applyContentChange and avoiding timestamps preceding lock acquisition; dedicated HTTP file + typecheck passed afterward.
- pnpm typecheck: passed, including final committed source.
- pnpm lint: passed.
- pnpm dev --webpack --port 3124 + PW_PORT=3124 PW_CHANNEL=chrome pnpm test:e2e tests/e2e/term-edit.spec.ts --workers=1: 2 passed (25.8s, 12:33). Covers full local draft roundtrip, ordinary-editor proposal/detail, 0->1->2 votes, actual public DOM before/after, aliases and independent perspective history, old URL canonicalization, ordinary/explicit links, alias red link; legacy row fixture, honest baseline, retained old row, old unstructured base refusal, expired draft and denied-storage direct editing.
- Early browser red exposed wrong term label and missing personal metadata diff, both fixed; first-vote badge refresh fixed. Test-only article locator corrected to actual .wiki-content, then both tests passed. One earlier dev HMR navigation aborted, final stable webpack run passed.
- git diff --check passed; worktree clean after commit.

## Remaining

No known unfinished #24 implementation. Main agent performs required code-review and combined #22/#23 integration regression. #25 must implement structured metadata compare/rollback and historical baseline/source presentation; #26 implements rejection/resubmission, per explicit issue boundaries. Real Meili/R2 contract checks were not executed here; #29 owns final isolated Meili contract.
