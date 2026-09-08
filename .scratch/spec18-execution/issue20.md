# Issue 20 — R02 审核回归改为验证外部行为

- Branch: `codex/spec18-20`
- Commit: `2bf1fba4b98432baa5c57d92eb20d7518909a6de`
- Worktree: `D:/PhoskyWiki-worktrees/spec18-20`
- Base: `855285b`
- Status: implementation complete; unified code review remains with the parent agent.

## Delivered

Only test files changed; no product rules or test-only endpoints were introduced.

`tests/integration/review.test.ts` retains 12 fast route-handler HTTP tests. All outcome reads go through the existing submission/review responses and `GET /api/pages/:pageId/history`. Database access is confined to account/role setup, seed page identification and cleanup.

`tests/e2e/review-behavior.spec.ts` adds 3 independent HTTP + rendered DOM cases. Pages and accounts are created through public endpoints. One UPDATE prepares a historical quorum=2 submission fixture without changing global admin roles; its result is observed only through HTTP and DOM, and its remaining pending submission is removed as teardown.

## Coverage mapping

| Former internal observation | Public boundary replacement |
| --- | --- |
| submission status/decision time/rejection reason | review response + terminal 409; submission detail DOM state, review timestamp and literal reason |
| supersedesId row field | public supersedes input accepted for a rejected submission, new submission ID, old detail stays rejected, old submission still returns 409 |
| vote rows and vote kind | first approval responds pending with 1/2, duplicate vote returns 409, second admin approves; history is unchanged until quorum and then grows by one; queue DOM shows approver name and 1/2 |
| revisions row count/head content | existing history HTTP endpoint; accepted content plus one new revision and exact preservation of earlier public history |
| links rows, target names and target IDs | source article resolves normal and explicit links to expected public hrefs; old target loses backlink, new term and precise perspective gain backlink |
| perspective linkCount and sort order | rendered term perspective list changes from 0 references to 1 and moves cited perspective ahead of an older zero-reference perspective |
| pending submission row count after admin direct edit | direct HTTP result gives reading URL with no submission ID, history grows once; page-scoped review queue DOM stays unchanged |
| listQueue fields | queue DOM kind/title/approval count/approver/stale badge and current-vs-proposal diff; fresh submission lacks stale badge |
| new term/interpreter/perspective internal read helpers | public term/interpreter directory links and detail headings/body; accepted perspective appears under term and produces target backlink; duplicate inputs still return 400 |

## Validation

- `pnpm install --offline --frozen-lockfile`: passed.
- Dedicated PostgreSQL `phosky_spec18_20` created and migrated; root/main DB never seeded.
- `pnpm typecheck`: passed repeatedly and after final functional changes.
- `pnpm test tests/integration/review.test.ts`: 12 passed.
- `PW_PORT=3120 pnpm test:e2e tests/e2e/review-behavior.spec.ts --workers=1`: 3 passed, 25.2 s. Corresponding BETTER_AUTH_URL uses port 3120.
- Changed-file ESLint: passed.
- `git diff --check`: passed.
- Final full Vitest with `SEARCH_CONTRACT_HOST=http://127.0.0.1:1`: 24 files passed / 2 skipped; 212 tests passed / 6 skipped, 44.90 s. Real Meilisearch contract explicitly skipped to avoid shared fixed-index interference with parallel agents, as requested by parent; R2 contract also skipped without credentials. Parent/#29 will run real Meili contract separately.

## Remaining integration notes

No unresolved issue-specific implementation item. Final code review is intentionally deferred to the parent's unified review. No push, GitHub comment or issue close was performed.

Issue #28 may make new_term require board content; its implementation should update the minimal new_term inputs in this new DOM spec (fixture helper and new-page loop), just as with the existing suites. The current tests intentionally follow this worktree's unchanged baseline contract.
