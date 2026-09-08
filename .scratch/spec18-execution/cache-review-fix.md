# Final Spec review fix: graph HTTP cache (#21 / #28)

- Worktree: `D:/PhoskyWiki-worktrees/spec18-cache-fix`
- Branch: `codex/spec18-cache-fix`
- Base: `e5907c0`
- Commit: `3d913b178a6e11a5c321256e79978532182f36a3` (clean worktree)
- PG: `phosky_spec18_21`; Next port: 3121; no MEILI_HOST.

## Change

Both graph endpoints now send `Cache-Control: no-store`. Local 400/404 responses also prohibit storage so a deleted root cannot leave a cached negative response after restoration. No graph aggregation, canvas, tooltip or search architecture changes.

The old 60-second fresh / 300-second stale operational limitations in `docs/spec18-delivery.md` and `docs/reconcile-links.md` were replaced with the current next-request behavior. Prior acceptance records are preserved; a new final-review validation section was appended. Already displayed graphs update on their next data fetch; this change does not introduce push updates. Search total/facet lag remains an ADR-0002 allowed derived-index transient.

## Red evidence

- `graph-cache.spec.ts` primes exactly `/api/graph/site` or `/api/graph/local?termId=<id>&hops=1` through default Chromium `fetch`, deletes the source perspective using the admin HTTP endpoint, then immediately default-fetches exactly the same URL. Both failed on original code: expected edge absent, actual edge present (`expectEdge`, line 42; called after deletion at line 49).
- Existing `reconcile-links.spec.ts` now primes and reuses real browser fetches for both site/local across the operational CLI. On old headers it failed after CLI completion: expected code-example local node absent, actual still present.
- `graph.test.ts` HTTP assertions failed for both old cache headers, explicitly expecting no-store.
- No cachebuster, request cache override, routing interception or mocked index is used to establish browser cache behavior.

## Green evidence

- `pnpm typecheck`: pass.
- `pnpm lint`: pass.
- `git diff --check`: pass.
- `pnpm exec vitest run tests/integration/graph.test.ts tests/integration/visibility.test.ts`: 10 tests pass.
- `PW_PORT=3121 pnpm exec playwright test tests/e2e/graph-cache.spec.ts tests/e2e/reconcile-links.spec.ts tests/e2e/visibility.spec.ts tests/e2e/graph.spec.ts --workers=1`: 11 pass, 46.5s.
- The browser matrix also proves restoration after perspective/parent interpreter deletion, target term node disappearance/restoration and local root 404/restoration. Both endpoints see corrected relationships after CLI reconciliation. Existing graph zoom, drag, locate, click navigation and local hops remain covered.
- Full Vitest: 245 passed, 6 skipped; 32 files passed, 2 contract files skipped; 80.30s. SEARCH_CONTRACT_HOST set to `http://127.0.0.1:1` to avoid parallel access to shared fixed Meili contract index; R2 not configured.
- Playwright-managed Next server stopped after completion; a subsequent port-3121 listener check returned no listeners.

Final independent review remains with the root agent. No push, issue comment, closure or production action.
