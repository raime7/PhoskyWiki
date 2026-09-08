# Issue #19 implementation report

- Branch: codex/spec18-19
- Commit: 9bb9b5f467465f6acb891ef7b1e257603c47fa6f
- Worktree: D:/PhoskyWiki-worktrees/spec18-19 (clean)
- Skills followed: implement + tdd. Central final code-review delegated to parent as instructed.

## Change

Shared GraphCanvas tooltip formatter returns an HTMLElement built with textContent/createTextNode. All dynamic title, school, count and heat fields are text; static strong/br formatting remains. No input filtering or content resubmission required.

## Acceptance evidence

1. Dynamic fields safely displayed: browser exact-text assertions cover title and school including ampersands, quotes, angle brackets and harmless img/svg probes; count and heat remain present.
2. Both views/historical data: fixtures inserted directly into isolated PostgreSQL before visiting real /graph and /term pages; no re-submission or mocked graph API. Both views use same formatter.
3. Injection prevention: in each browser case, no [data-graph-injected] DOM, no documentElement data-graph-probe side effect, and zero requests to graph-tooltip.invalid. Requests are intercepted/aborted defensively if a regression occurs.
4. Interaction retained: real mouse hover over canvas nodes, then click navigates to term. Local test enters with a query parameter so a no-op click cannot accidentally satisfy the destination assertion. Existing graph zoom/pan/search/hops/API regressions also pass.

## Validation

- TDD RED: before fix, global browser tooltip title lost img markup because it became DOM; exact text assertion failed. Same regression GREEN after output fix.
- pnpm typecheck: PASS.
- pnpm exec eslint src/components/graph-canvas.tsx tests/e2e/graph-tooltip.spec.ts: PASS.
- PW_PORT=3119 PW_CHANNEL=chrome pnpm exec playwright test tests/e2e/graph-tooltip.spec.ts tests/e2e/graph.spec.ts --workers=1: 6 PASS.
- pnpm exec vitest run tests/integration/graph.test.ts: 8 PASS.
- pnpm test: 25 files PASS, 1 skipped; 221 tests PASS, 1 skipped, 42.63 s. The skipped R2 contract lacks credentials. Existing Meilisearch contract passed using its dedicated pages-contract-test index (hard-coded by existing suite).
- git diff --check: PASS.
- Independent DB phosky_spec18_19 created/migrated/seeded; .env ignored, own node_modules. Dev server port 3119 stopped after verification.
- Build and repository-wide lint reserved for final integrated delivery; no unresolved #19 issues.
