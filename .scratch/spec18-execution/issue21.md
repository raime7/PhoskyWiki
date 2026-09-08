# #21 [R03] 删除与恢复后的视角入口一致

- Worktree: `D:/PhoskyWiki-worktrees/spec18-21`
- Branch: `codex/spec18-21`
- Base: `855285b`
- Commit: `7db6cd001182de0a78ab329a2357ac15018144ab` (clean worktree)

## Implementation

- Added `isPageVisible(pageId: SQLWrapper)` in `src/lib/page-visibility.ts`: perspectives require their own page, term and interpreter to be undeleted. Content, explicit links, backlink source heat, graph, recommendations and incremental search projection use this common predicate. Existing full-search projection already checks all three pages.
- `setPageDeleted` preserves outbound and inbound relationships. It changes only the requested page's deletion flag and still queues the existing dependent search synchronization. A source can be restored while its target is hidden without losing its previously resolved target id.
- `WikiLinkTarget` gained optional `unavailable?: boolean`. Hidden resolved links render an unclickable muted span with `title="页面暂不可用"` and class `wiki-link--unavailable`, distinct from unresolved writing-gap red links. No target fallback.
- Public search API, suggestions API and rendered search page now check returned hits against PG visibility. Discussion hits also retain their parent term gate. Search writes still use the raw SearchIndex port.
- ADR-0004 #8 was refined to execute parent Spec #18 D/E's explicit relationship-preservation requirement: deletion/restoration preserves link identities and only synchronizes the index. PG source of truth, page identity and submission terminal semantics are unchanged.

## Acceptance evidence

1. Perspective + term + interpreter visibility: Playwright matrix covers deleting and restoring each type, reader body 404 and public history HTTP 404, explicit target href loss/restoration, graph edge removal/restoration, source backlink disappearance when its interpreter is deleted, and displayed heat from 1 to 0.
2. Resolved unavailable explicit targets: matrix asserts no `a.wiki-link`, an unavailable span title, and exact original href after restore. Preserved relationship rows cannot become `target_page_id IS NULL` writing gaps through deletion; rendering uses the distinct unavailable class.
3. Independent deletion state and identity: matrix independently deletes child before parent delete/restore, confirms child stays hidden; also deletes/restores source while target remains hidden and confirms target identity reappears after final restoration.
4. Discovery: matrix checks related-term DOM result removal/restoration along with graph API edges; existing content/home/graph/interests suites are included in final full run.
5. Search: HTTP regression creates real PG content via submission routes and searches through API; deletion is verified to remove dependent views from the SearchIndex port. An explicitly reinserted stale index document remains absent in public search and suggestion HTTP responses. Both term and interpreter parents covered; restore becomes searchable again.

## Validation

- Red: new browser matrix failed all 3 cases on original code (deleted perspective mislabeled as not created; deleted parents left live blue links).
- Red: 2 HTTP stale-index tests failed with hidden hits present on original code.
- Green: targeted `visibility.test.ts` + `content.test.ts`: 27/27 tests.
- Browser: `visibility.spec.ts` + existing `history.spec.ts`: 4/4; subsequent matrix with extra displayed heat assertions: 3/3.
- `pnpm typecheck`, `pnpm lint`, `git diff --check`: pass.
- Full Vitest: 25 files passed, 2 contract files skipped; 218 tests passed, 6 skipped (224 total), 49.17 seconds. The skipped contracts are Meili (deliberately disabled to avoid shared-index contention) and R2 (not configured).
- Dedicated PG database `phosky_spec18_21`, Next port 3121; local `.env` has no MEILI_HOST. Full run sets SEARCH_CONTRACT_HOST to port 1 to avoid shared fixed test-index contention; root/#29 will run real Meili contract serially.

## Review/integration notes

- Per orchestration instruction, final independent Standards/Spec code-review is assigned by root; no child review agents spawned here.
- #22 may continue on this commit for transaction parent checks. No write-transaction parent-lock redesign here.
- #23 will touch markdown/page-links. Preserve `WikiLinkTarget.unavailable` and unavailable rendering when merging its AST change. `page-links.ts` only has a comment change from this issue; no resolver API change.
- During failed/lagged search synchronization, total/facet counts still come from the index, and a page/suggestion batch may contain fewer visible hits. No hidden title/body/URL is returned. Full reconciliation repairs the derived counts. This deliberately does not redesign search pagination.
- Existing malformed heat fixture was corrected to include real perspective payload + live term parents; the new canonical visibility rule rightly excludes orphan page shells.
