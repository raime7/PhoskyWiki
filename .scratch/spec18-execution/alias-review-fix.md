# Alias roundtrip review fix — #24 / #26

Commit: d906e000175f6d0f57bd0bb86fa9bee6ab39bc28
Base: e5907c0
Branch/worktree: codex/spec18-alias-fix / D:/PhoskyWiki-worktrees/spec18-alias-fix
Dedicated database: phosky_spec18_24; Next webpack port 3124. Service stopped after verification.

## Finding and fix

The old form flattened alias arrays using commas (resubmission) or ideographic commas (term editing), then split them again at submission. Existing single aliases such as “甲、乙” or “Alpha, Beta” silently became multiple values even when only the summary changed. Embedded line breaks were also split.

- Added shared formatAliasInput / parseAliasInput in src/lib/alias-input.ts. All three metadata paths (new term, term edit, resubmission) now use the same representation and parser.
- Bare ASCII/fullwidth commas delimit aliases; ideographic comma remains content. A single alias containing delimiters is automatically quoted. Quoted text supports escaped quotation marks, backslashes, line breaks and other control characters, so a single-line input preserves the original strings.
- Kept existing comma input for simple aliases. Added concise visible help with a quoted example. Incomplete quotes, invalid escapes or extra characters after a closing quote are rejected before HTTP submission. The raw draft is saved before validation and remains editable after error/reload.
- Local drafts now mark aliasesFormat=quoted-v1. Old drafts whose alias text matches the old prefill regain the exact source/proposal array boundaries; other legacy draft text is interpreted with the old path's grammar once, then encoded in the new format. New quoted drafts preserve the exact raw editing text, including incomplete input awaiting correction.
- No schema, server auth, submission lifecycle, review policy or unrelated UI changes.

## Evidence

Environment setup: pnpm install --offline --frozen-lockfile; pnpm db:migrate; pnpm db:seed, exclusively against phosky_spec18_24. No shared search index configured. Six leftover term24-* test admins from early #24 red iterations were demoted in this isolated DB before compatibility cases that assume only the seed administrator; no production/shared account state changed.

TDD:
1. New browser tests initially failed in both summary-only editing and resubmission. Observed HTTP payload changed [“甲、乙”, “Alpha, Beta”, “中文，逗号”, ... , “换行\\n别名”] into split entries. This was the actual externally observable regression.
2. After shared conversion integration, both browser cases passed.
3. Supplementary control-character serializer test failed for backspace/form-feed, then passed after all control characters were quoted.

Final checks:
- pnpm test tests/unit/alias-input.test.ts tests/integration/term-edit.test.ts tests/integration/resubmission.test.ts: 3 files, 15 tests passed (8 pure conversion + 7 HTTP integration).
- pnpm typecheck: passed, including final test assertions.
- pnpm lint: passed.
- git diff --check: passed; worktree clean after commit.

Browser command: PW_PORT=3124 PW_CHANNEL=chrome pnpm test:e2e tests/e2e/alias-roundtrip.spec.ts tests/e2e/term-edit.spec.ts tests/e2e/resubmission.spec.ts --workers=1, against pnpm dev --webpack --port 3124.
- Six unchanged compatibility cases (term-edit 2 + resubmission 4) all passed in the last combined run.
- Final dedicated alias run: PW_PORT=3124 PW_CHANNEL=chrome pnpm test:e2e tests/e2e/alias-roundtrip.spec.ts --workers=1: 3 passed, 16.6s.
- Alias scenarios cover: API-created complex alias arrays, legacy edit draft migration, summary-only edit and fresh draft reload, history API verifies unchanged array; new-term quoted input and invalid quote error/reload/correction; both new-term and term-edit rejection/resubmission, old resubmission draft migration, new draft reload, exact outgoing full array and resulting submission detail.
- Existing browser cases cover the original metadata review/publishing flow and all resubmission variants.

Nonfinal runs recorded accurately:
- Initial combined run: 8 passed / 1 failed. Failure was existing resubmission navigation from /terms to the just-created term during first webpack compilation; server logged “The destination stream closed early”. The same unchanged case passed on warmed rerun.
- After adding old-draft fixtures, one alias test filled a field before async draft restoration completed. The fixture now explicitly waits for the old draft value before performing the edit; final dedicated run passed. No sleep or suppressed assertion was introduced.

## Follow-up

No outstanding alias finding. The root agent will run the final combined full Vitest/real Meili, production build and dual review on the integrated patch. This patch intentionally did not rerun all 75 E2E cases or unrelated external contracts.
