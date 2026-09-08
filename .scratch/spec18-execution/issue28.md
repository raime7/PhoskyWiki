# #28 — 校对存量双链并保留目标身份

Branch/worktree: `codex/spec18-28` / `D:/PhoskyWiki-worktrees/spec18-28`
Base: `f0e148b` (includes #19–24 and #27; #25/#26 implemented in separate worktrees).
Dedicated database: `phosky_spec18_28`; browser port 3128; `.env` has no `MEILI_HOST`.
Commit: `78a4f511d2d20090729b93188910d4aeac698127` (clean worktree).

## Delivered operation

`pnpm links:reconcile --database <actual-database-name> --all`

Targeted retry: `pnpm links:reconcile --database <actual-database-name> --page-id <id> [--page-id <id> ...]`.

Script `scripts/reconcile-links.ts`; operation guide `docs/reconcile-links.md`. Required database-name match checks both `DATABASE_URL` path and `current_database()`; JSON target includes host/port/name without credentials. Explicit all/selected scope required. The CLI does not seed, truncate, clear content, update revisions, page timestamps, or deletion flags.

Each selected page is locked with the same page-row lock as edits/approvals/rollbacks. Only then is the latest revision read. Shared `rebuildPageLinks` parses the shared AST and preserves non-null identities for surviving keys; term metadata is excluded from Markdown parsing. Hidden source pages are included so restored pages retain corrected relationships; hidden target IDs remain preserved. Transactions are per page; a 5-second lock timeout or 60-second per-statement timeout fails that page and continues the rest.

JSON report: `target`, `scope`, `selected`, `processed`, `failed`, `unresolvedLinks`, `pages`, `failures`, `searchSync`. Per-page result includes `pageId`, `revisionId`, `visible`, `references`, `unresolvedLinks`; failures include `pageId`, error message and PostgreSQL code. Exit code 1 for any failed page or invalid invocation. Top-level unresolvedLinks sums only successful publicly visible sources in the requested scope. Same-name gaps on different source pages count separately. Partial runs are explicitly not full-corpus totals.

`queueSearchSync` / `transactionWithSearchSync` are reused after each successful transaction, including dependent page/document expansion. Search failures retain the existing stderr-only, no-database-rollback behavior; the report says requested rather than claiming index success. No Meili host yields an explicit disabled status. Graph retains existing HTTP cache policy (60-second freshness + 300-second stale-while-revalidate), documented rather than inventing CLI-only cache invalidation. Other public relation consumers query the shared live relations directly.

## Acceptance mapping and evidence

1. Repeatable operation/history: CLI all/selected and failures documented; browser compares full source and renamed-term history JSON before/after byte-equivalent parsed values. Source has both an old revision and the current body. History page remains readable.
2. Identity/AST: browser uses genuine HTTP term metadata rename (#24), then creates a new term reusing the old name. Current source contains ordinary and explicit old-name links, one real unresolved gap, and a previously unresolved link whose term is created later. Historical false relations are prepared solely as a DB fixture for inline/fenced code targets and a fake red gap.
3. Public effects: before/after HTTP local graph and term discovery show the code-only neighbor disappearing; real original edge remains weight 2. DOM backlinks and target perspective heat go 1 -> 0 for the false target while original target backlink remains 1. Published body has 3 real anchors and 1 genuine red span; clicking the old-name ordinary link reaches the renamed original, explicit href retains the original perspective, and the newly created target resolves.
4. Repeat stability: selected report equality verified by browser test. CLI integration test on seeded dedicated DB executes all twice, both 450 processed / 0 failed / 4 remaining actual red links, exact report equality.
5. Failure/retry: real PostgreSQL lock fixture causes code 55P03 for one page; nonexistent id 2147483647 gives a separately located failure; a third selected page succeeds. Releasing the lock and retrying its page id succeeds, history unchanged. Wrong database name, omitted/ambiguous scope, and invalid page id are rejected.
6. No test-only public endpoint or private-table assertion was added. Tests observe the operational CLI, real HTTP, and rendered DOM. No aggregate writing-gap page exists, so natural CLI counts plus real red DOM provide the gap evidence.

## Validation

- Independent database identity verified before `pnpm db:migrate` and `pnpm db:seed`; only phosky_spec18_28 migrated/seeded.
- Red: first Playwright scenario failed because the CLI did not exist, after all public fixture/precondition assertions passed.
- Green: `PW_PORT=3128 PW_CHANNEL=chrome pnpm test:e2e tests/e2e/reconcile-links.spec.ts --workers=1`: 2 passed, 16.2 seconds.
- `pnpm test tests/integration/reconcile-links.test.ts`: 2 passed, 19.16 seconds.
- `pnpm typecheck`, `pnpm lint`, `git diff --check`: passed.
- `SEARCH_CONTRACT_HOST=http://127.0.0.1:1 pnpm test`: 30 files passed / 2 skipped; 239 tests passed / 6 skipped, 69.67 seconds (13:01:33 start). Five real Meili tests skipped intentionally; one R2 contract skipped for absent credentials.
- Final manual CLI rehearsal on the dedicated database, after full tests: `node --conditions react-server --import tsx scripts/reconcile-links.ts --database phosky_spec18_28 --all`, run twice. Both exit 0; 450 selected / 450 processed / 0 failed / 4 unresolved links. Raw JSON text equal. Reports: `D:/PhoskyWiki/.scratch/spec18-execution/issue28-reconcile-first.json` and `issue28-reconcile-second.json` (same directory).
- Dev server stopped after browser run; no listener remains on port 3128. The combined rehearsal shell returned exit 1 solely because the final `Get-NetTCPConnection` correctly found no listener; each CLI exit code was explicitly checked as 0 and report equality verified before that probe.

## Handoff / limits

Root owns final standards/spec code-review and combined #25/#26/#29 verification; no reviewer subagents spawned here. No production deployment, push, GitHub comment, or issue closure. No schema changes and no changes to shared parser/rebuild implementation.

Meilisearch intentionally unconfigured for this worktree and `SEARCH_CONTRACT_HOST=http://127.0.0.1:1` for the full suite to avoid concurrent mutation of the fixed contract index. #29 owns real Meili verification, including optional CLI sync if desired. R2 contract credentials absent. Operation docs explicitly distinguish requested search sync from confirmed index success and describe same-environment `search:reindex` recovery.

The database-name check cannot distinguish two hosts with the same database name; operators must check the documented host/port/environment first. Existing HTTP graph cache can show old data within its documented cache lifetime. Relationship identity can be preserved only where an existing non-null target id survives; historical lost IDs cannot be reconstructed by guessing old names.
