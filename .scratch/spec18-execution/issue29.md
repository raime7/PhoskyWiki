# #29 — 一期修复组合验收与交付证据

Worktree: D:/PhoskyWiki-worktrees/spec18-29; branch codex/spec18-29.
Status: #29 implementation/acceptance complete; parent owns final independent Standards/Spec review. No push, GitHub comment, closure or production operation.
Final HEAD: e9583074ecc6f934284a45934387ffd888cc0843 (clean).

## Commit and run identities

- Fixed integrated product implementation: 3fee40105d7a72d708e0fc5602d6cf3e6558ea54, all #19–28 present.
- 4385b54407b5502898ac9ac3edb809899f85de66 adds tests/e2e/spec18-combined.spec.ts only: five true-browser combined cases. Initial full checks/build/Vitest/all Playwright executed here.
- 09f0af2d9bb5f82f980a5135bceb0d8ca829773a updates tests/e2e/review-behavior.spec.ts only: verify current public history content and explicitly supply confirmedBaseRevisionId when resubmitting stale proposal. Final typecheck/lint and that complete file's three cases rerun here.
- e9583074ecc6f934284a45934387ffd888cc0843 is documentation-only docs/spec18-delivery.md. Product source stays identical to 3fee401 throughout. Do not describe all evidence as one unchanged test-tree run.

## Delivered evidence

Report docs/spec18-delivery.md maps all 36 stories, eight findings, original four probes, complete acceptance matrix, commands/counts/limitations, operational steps and fixed SHA provenance.

Combined browser tests (new file):
1–2. Delete term/interpreter parent -> approve attempt becomes system rejection -> own rejected detail -> UI resubmit with full original proposal -> unavailable parent warning + saved local changes -> restore parent -> reload retained draft -> UI new linked submission -> approval -> actual readable perspective -> original rejected review and terminal409 preserved.
3–5. Guest chooses interpreter -> matched neighboring term via explicit perspective link appears with public discovery interestMatchCount1 -> delete perspective/term/interpreter -> DOM link unavailable and anonymous discovery candidate absent -> restore -> same perspective href and matched recommendation return. Only HTTP/DOM outcome assertions, no database observations.

Reuse existing complete cross-module tests:
- reconcile-links.spec.ts: actual metadata rename + old-name reuse -> historical fake relations fixture -> CLI repair twice -> original normal/explicit target IDs, immutable public history, backlinks/heat/graph/discovery/red link outcomes. Also 55P03 lock failure + nonexistent page + successful remaining page + targeted retry.
- term-history.spec.ts: admin edit + ordinary approval -> nonadjacent comparison -> rollback -> all fields/old URL/wiki links -> collision atomic failure.
- graph-tooltip.spec.ts: both actual graph canvases, special text exactness, no injected DOM/side effects/external requests, real navigation.

## Final validation

- Dedicated PG phosky_spec18_29 only. Migration and seed passed; seed was reset before final production browser run. Verified seeded admin was sole admin as fixture setup. No main development or production DB touched.
- pnpm typecheck: PASS at 4385b54 and after test correction09f0af2.
- pnpm lint: PASS at4385b54 and full repository again after09f0af2.
- pnpm build: PASS, default Next16.3.4 Turbopack. Compile7.6s, no webpack fallback needed. Existing future Vite config-loader warning in tests is nonfailure.
- pnpm test at4385b54: 33 files passed,1 skipped;250 tests passed,1 skipped;76.07s starting13:06:09 2026-09-08 Asia/Shanghai.
- Real Meilisearch: all5 contract tests PASS within full Vitest, SEARCH_CONTRACT_HOST=http://localhost:7700, isolated pages-contract-test index and no parallel worker contract writes.
- Real R2:1 contract SKIP due absent dedicated R2_CONTRACT_* credentials. Never counted passed.
- Production pnpm start --port3129 (default built artifact), Chrome, PW_PORT3129/PW_CHANNELchrome. pnpm exec playwright test --workers=1: first run52 passed23 failed,75 cases,4.3min. Consecutive authentication triggered normal production better-auth rate limits; snapshots show Too many requests or unestablished sessions/failed registration setup. Retained all initial logs/snapshots.
- Each of23 failed cases retried unchanged through pnpm exec playwright test <file> --grep <escaped original case title> --workers=1, with11sec between invocations:22 passed;1 real stale-test contract failure409 remained. No auth rule/config/product workaround.
- Remaining case review-behavior:136 was old R02 helper silently updating base for stale supersedes, which #26 correctly rejects. Red captured in retry-10.log. Patch09f0af2 checks latest history literal then explicitly confirms that revision. Its whole3-case file verified by3 isolated invocations at11sec windows:3/3 PASS. Final all75 unique E2E cases have successful evidence (52+22+1); two already passing review-behavior cases additionally regressed after patch. No remaining browser failure/skip.
- Product code unchanged after build/Vitest; tests-only correction does not require rebuilding product. Final staged diff/check and git show --check PASS. Trailing blank-line document warning was removed before final amended documentation commit.

## Actual CLI rehearsal

After all browser activity stopped, at09f0af2 run twice:
pnpm --silent links:reconcile --database phosky_spec18_29 --all

Both exit0: target localhost:5432/phosky_spec18_29, scopeall, selected602, processed602, failed0, failures[], unresolvedLinks7. Complete JSON text exactly identical. stderr empty. searchSync explicitly disabled:MEILI_HOST not configured; do not claim actual CLI-to-Meili sync succeeded. This is separate from passing true Meili contract. Operational guide docs/reconcile-links.md describes requested-versus-confirmed sync, stderr review/search:reindex recovery and existing graph cache lifetime.

Raw first/second JSON: D:/PhoskyWiki/.scratch/spec18-execution/issue29-reconcile-first.json and issue29-reconcile-second.json.
Logs: D:/PhoskyWiki/.scratch/spec18-execution/issue29-logs (typecheck/lint/build-default/vitest/playwright-all/server-production, first-run-test-results, retry-cases/results +23 logs, retry-10 failure snapshot, review-final-results +3 logs, reconciliation stderr).
Parent's actual0012->0013 legacy schema upgrade evidence is included from legacy-upgrade.md: dedicated phosky_spec18_legacyupgrade, actual known fields baseline+two unchanged legacy revisions via existing public history, repeated migration no duplicatebaseline. It ran main6e6306d separately and is not misattributed to the final full-suite run.

## Handoff

Commits for integration in order:4385b54,09f0af2,e958307 (branch descends from3fee401).
Report:D:/PhoskyWiki-worktrees/spec18-29/docs/spec18-delivery.md.
No known unfinished #29 functional/acceptance item. Final global Standards/Spec review intentionally deferred to parent per user instruction; no nested agents spawned. R2 real-service verification remains environmentally unexecuted. Production3129 process stopped; no listening port remains. Workspace clean.
