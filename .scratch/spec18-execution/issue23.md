# #23 [R05] 预览与发布采用一致的双链语义

- Worktree: `D:/PhoskyWiki-worktrees/spec18-23`
- Branch: `codex/spec18-23`
- Base: `32604f0f390461c8f0cb079130f5ee7c346290db`
- Commit: `67a5ae1bc076f495f3b5c54d4d76e4752ec44a25` (clean worktree)

## Implementation and interfaces

- Added `src/lib/markdown-ast.ts`, the single synchronous remark parser configuration and wiki-link node visitor shared by rendering and extraction. `parseWikiLinks(source)` keeps its synchronous signature, key deduplication and first-occurrence order; ordinary links, display aliases and explicit interpreter links retain existing `parseWikiLink` rules. No browser extraction regex added.
- `rebuildPageLinks(tx, pageId, content)` signature unchanged. It preserves previous non-null target IDs for keys still present as real AST nodes; new keys and unresolved null targets resolve by current name. Hidden resolved IDs remain non-null. Removed links disappear. Approval, admin edits and rollback retain the existing shared revision pipeline.
- `SubmissionFormProps` edit variant and `MarkdownEditor` gain optional `resolvedWikiLinks?: [string, WikiLinkTarget][]`. The edit page supplies existing `getWikiLinkTargets` entries filtered by `exists || unavailable`; these override current catalog names in preview. Null red links remain eligible for current catalog resolution. #24 must preserve this small addition when merging its edit page and form changes.
- `WikiLinkTarget.unavailable` and unavailable rendering from #21 are unchanged. The image sanitization/rendering pipeline remains intact.
- No schema, migration, production database, public API, or batch reconciliation CLI added. #28 can reuse the existing `rebuildPageLinks` entry point.

## Acceptance evidence

1. Shared AST: new supplementary unit fixture includes true ordinary/alias/explicit links, duplicate targets, fenced code, indented code, inline code and escaped examples. Old regex failed by extracting all four example types; new parser passed. Existing parser and Markdown unit tests also pass (23 tests across two files).
2. Browser mixed-body test uses actual edit preview DOM and HTTP submission/review. Preview and published body each show exactly 3 clickable links (ordinary + alias + explicit), exactly one real red-link gap, and literal code examples. Alias and explicit hrefs are verified.
3. Same mixed body contributes one backlink to the explicit target, target perspective heat of 1, and graph edge weight 2 (hub and perspective identities; duplicate alias is deduplicated). Code-only target has no backlink. Admin direct edit to examples-only removes all wiki-link DOM, backlinks, heat and graph edges. HTTP rollback restores the verified results.
4. Two identity browser cases cover ordinary hub and explicit perspective links. A DB fixture represents an already-renamed term; a new term and perspective reuse its old name. Preview and subsequent HTTP admin save retain original target identity. Truly unresolved red links resolve when their target is created. Deleting the original parent, editing and rolling back while it is hidden retains the unavailable state; restoring it makes the same original target reachable.
5. Browser red evidence was observed separately: before preview fix it linked to the replacement old-name page; after preview fix but before rebuild fix, saved content linked to that replacement page. Both now pass.
6. Existing editor browser suite (including mobile), #21 target/term/interpreter deletion/restoration matrix and new tests all pass together.

## Validation

- `pnpm install --offline --frozen-lockfile`: pass, independent node_modules.
- Dedicated PostgreSQL database `phosky_spec18_23`, migrations and local seed only. `.env` has independent auth secret, port 3123 and no MEILI_HOST.
- `pnpm typecheck`, `pnpm lint`, `git diff --check`: pass.
- `PW_PORT=3123 PW_CHANNEL=chrome pnpm test:e2e tests/e2e/wiki-link-semantics.spec.ts tests/e2e/visibility.spec.ts tests/e2e/editor.spec.ts --workers=1`: 11 passed in 1.2m.
- `SEARCH_CONTRACT_HOST=http://127.0.0.1:1 pnpm test`: 25 files passed, 2 skipped; 215 tests passed, 6 skipped (221 total), 44.63s. Meili intentionally disabled to avoid the shared fixed contract index; R2 not configured. Root/#29 owns final serial real contract and production build checks.
- Next dev used `--webpack --port 3123`, now stopped; no listener remains on 3123.

## Review and limitations

- No child reviewers spawned, following root orchestration; root owns the final Standards/Spec review. Implement and TDD skills read, as were CONTEXT, ADR-0003/0004, issue #23 and parent Spec #18. Relevant local Next page conventions read before editing the route.
- Existing code has no public writing-gap aggregate endpoint/UI and no internal aggregate query for it; this issue observes real red-link gaps in published/preview DOM and all available public navigation signals, without adding a test-only API. Null relationships use the same extractor; #28/#29 can map any additional reconciliation evidence.
- Rename itself is a precondition fixture here; #24 owns the actual rename workflow and #29 the combined end-to-end execution. Identity preservation applies to keys still present in the current relationships; removing a key and later reintroducing it intentionally follows normal new-link resolution.
- Historical false links are not batch corrected here; that remains #28. No push, GitHub comment, or issue closure performed.
