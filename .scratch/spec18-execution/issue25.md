# #25 — 词条信息历史比较与安全回滚

Commit: d7cfc6db1d6225f503fb74e792f81b11d3b328cf
Branch/worktree: codex/spec18-25 / D:/PhoskyWiki-worktrees/spec18-25
Base: fb1ee13
Dedicated DB: phosky_spec18_25; Next webpack port 3125, stopped after verification.

## Delivered

- History compares any selected two term revisions using their structured title/summary/aliases, with field-level changed markers. It never interprets the compatibility JSON code block as metadata. Non-term Markdown line diffs keep their existing behavior.
- Each history revision shows source: 新建 / 普通受理 / 管理员直编 / 回滚 / 起始快照 / 旧历史（来源未记录）. Structured revisions expand as a labeled field snapshot, while legacy original content remains readable verbatim.
- Rollback reuses lockLivePage + transactionWithSearchSync + applyTermMetadataChange. It creates a new revision with source=rollback, rollbackFromId and createdBy, updates real pages/terms fields and slug, and synchronizes derived search documents; original revisions remain unchanged.
- Historical title collisions return contextual HTTP 409 and no page fields, history or search state change. Repeated attempts stay atomic.
- Legacy revisions lacking structured metadata return HTTP 409 for rollback, lack rollback buttons, and display an explicit limitation in both history and comparison. Their old text remains available; a genuine #24 baseline can still be compared and restored.
- Existing id URLs and previously resolved wiki links remain reachable after rollback. Independent perspective content remains unchanged. Existing deletion/restore behavior was preserved and regressed via original history.spec.ts.
- Browser red uncovered an existing interaction issue: native GET comparison navigation exposed SSR PageAction controls before hydration, swallowing the first rollback click with no POST. PageAction now stays disabled until hydration attaches handlers (useSyncExternalStore server/client readiness). Both term-history flows and original perspective history flow pass with this fix.

## Interfaces and integration

- No migrations/schema changes and no changes to #24 review.ts transaction/snapshot APIs.
- compareRevisions now returns a discriminator: content => existing rows plus kind=content; term => kind=term, metadataRows (or null), limitation (or null). Both include from and to. History HTTP exposes this as comparison.
- TermMetadataDiff accepts optional fromLabel/toLabel; existing review and submission detail callers keep 当前版/提案 defaults. History uses 起始修订/目标修订.
- revision-snapshot.ts adds revisionSourceLabels and legacyTermHistoryNote shared with history UI/HTTP.
- No #26 resubmission work, no changes to relation rebuilding/deletion semantics or parent-lock behavior.

## Verification evidence

- Dedicated database migration and seed succeeded before implementation. Only phosky_spec18_25 was used.
- HTTP red/green: tests/integration/term-history.test.ts initially failed because comparison returned JSON text rows; after structured comparison change passed. Next rollback test failed because public title/slug stayed renamed; after metadata pipeline reuse passed. Collision test then failed on misleading generic submission wording; contextual rollback error fixed it. Final dedicated file: 4 passed.
- HTTP tests verify two edits/nonadjacent and reverse comparison; source provenance; new revision and attribution; unmodified prior history; title/slug and search restoration through public APIs; repeated collision rollback atomically unchanged; legacy JSON-shaped original text remains readable and cannot be guessed/restored.
- Browser red: missing 普通受理 source label, then swallowed click after comparison GET navigation. Both fixed. A later strict-mode failure came from matching Next's route-announcer alongside the product alert; locator now scopes to history-revision.
- Final `PW_PORT=3125 PW_CHANNEL=chrome pnpm test:e2e tests/e2e/term-history.spec.ts tests/e2e/history.spec.ts tests/e2e/term-edit.spec.ts --workers=1`: 5 passed in 51.9s. Includes complete term create/direct-edit/ordinary approval/compare/rollback/conflict flow; live title, summary, aliases, canonical URL, old id URL, saved wiki link; independent perspective; legacy text and baseline compare/rollback; original content history/delete/restore and #24 draft/two-vote/rename workflows.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- Final `pnpm test`: 29 files passed / 2 skipped; 235 tests passed / 6 skipped; 55.09s, started 2026-09-08 12:50:29 local.
- Five real Meilisearch contract tests deliberately skipped via SEARCH_CONTRACT_HOST=http://127.0.0.1:1 to avoid concurrent fixed-index writes; one real R2 contract test skipped for missing credentials. These are not claimed passed. #29 owns isolated real Meili validation.
- `git diff --check`: passed. Worktree clean after commit. Port 3125 no longer listening after verified dedicated process stop.

## Remaining / risks

No known unfinished #25 acceptance item. Build and final combined review remain central integration responsibilities. Parent agent performs requested final code-review on spec and project standards; no separate child review agent was spawned. No push, GitHub comment, issue closure or production changes performed.

The new browser ordinary-approval test uses the same dedicated seeded single-admin/cold-start environment assumption as existing review.spec.ts; run after resetting leaked external test admins, or sequentially as verified. Tests in term-edit.spec.ts demote their additional reviewer in finally.
