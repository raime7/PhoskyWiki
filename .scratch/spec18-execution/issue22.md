# #22 [R04] 父页面失效时拒绝发布新视角

- Worktree: `D:/PhoskyWiki-worktrees/spec18-22`
- Branch: `codex/spec18-22`
- Base: `6d71dbc` (includes #19 and #21)
- Commit: `b10981d549fe7181bf68857f079da429eefd560f`
- Worktree clean. No push, GitHub comment or issue closure.

## Implementation

- New `src/lib/perspective-parents.ts` owns live typed-parent checking and locks both parent `pages` rows in ascending immutable id order using `FOR UPDATE`. Reasons distinguish missing/wrong-type parents and deleted parents, including affected parent titles.
- `createSubmission` now validates and creates the pending proposal or applies an administrator's direct publication in one transaction. Parent locks therefore cover both validation and the actual write. Creation against an already invalid parent returns HTTP 404 with a concrete reason, retaining the existing creation contract; no submission existed to reject at this point.
- Every approve attempt on an existing `new_perspective` submission locks and rechecks both parents before writing a vote. An unavailable parent makes the submission terminal `rejected` with a system reason and its existing notification, in the same transaction; no deciding vote, perspective page, or revision is published. Prior approval votes remain untouched.
- `applySubmission` also uses the same lock/check helper, covering direct publication and the board perspective created alongside a new term.
- Existing `setPageDeleted` already locks the same page row through the transaction; no history.ts/schema changes needed. Delete locks one page and never locks submissions. Approval locks its submission then sorted parents; creation locks sorted parents. Locks remain held through publication commit. Delete-first is rejected; approve-first commits and subsequent deletion hides the child using #21 visibility semantics.

## Acceptance evidence

- Red/green slice 1: both parent kinds, first approval then deletion, final approval returned `approved` on original code (2 failures); after patch both are rejected with concrete system reasons and a readable notification.
- Red/green slice 2: creation against deleted parents returned generic “不存在” originally (2 failures); both editor and admin now receive the concrete deleted-parent explanation.
- HTTP route tests: 10/10. Covers both parent kinds deleted before first approval and between first/final votes, editor/admin creation rejection, notification unread count/read endpoint, original terminal response after restore, independent superseding submission and successful two-vote publication, unique mount availability after rejection, public search absence and public revision history containing exactly the newly published proposal.
- Four parallel HTTP route races: term/interpreter deletion against final approval and direct administrator creation. Accepts either valid serial order, requires no public search content after delete, and after restore verifies either a complete one-revision publication or no publication and a new successful creation. Also checks completed-publication → deletion → restoration through public history HTTP 404/200.
- Browser: 2/2 passing (`perspective-parents.spec.ts`, system Chrome, port 3122). Both parent types display the exact system reason in the submission history and notification DOM; details preserve original proposal; restoring the parent leaves the old reason/status and 409 terminal response; an independent superseding submission displays pending and original content. Initial test-only locator errors were corrected to the actual notification container and awaited detail navigation; final run passed in 9.5s.

## Validation

- Dedicated PG database `phosky_spec18_22`, migration completed, own .env with port 3122; no MEILI_HOST configured. Seeded only this database.
- `pnpm test tests/integration/perspective-parents.test.ts`: 10 tests passed.
- `PW_PORT=3122 PW_CHANNEL=chrome pnpm exec playwright test tests/e2e/perspective-parents.spec.ts --workers=1`: 2 tests passed.
- `pnpm typecheck`, `pnpm lint`, `git diff --check`: passed.
- Final full Vitest: 26 files passed, 2 skipped; 228 tests passed, 6 skipped (234 total), 53.48 seconds. `SEARCH_CONTRACT_HOST=http://127.0.0.1:1` intentionally disables the shared Meili contract; R2 credentials absent. #29 owns real service contracts and final build/integration verification.
- Dev server session stopped; port 3122 has no listener. No background browser/test service remains.

## Integration/review notes

- Standards/Spec independent review is intentionally assigned to root per orchestration; no nested reviewer agents spawned. Read implement/tdd/references, repository ADRs 0001–0004 and local Next route guide.
- #24 overlap in `review.ts`: import list; `validateSubmissionInput` parameter is now Tx and its new_perspective block uses `lockPerspectiveParents`; `createSubmission` has an outer `transactionWithSearchSync` around validation + all writes (remove its former nested admin transaction); `reviewSubmission` adds a parent rejection block before edit stale-base logic; `applySubmission/new_perspective` uses the helper's locked titles. Preserve #24 metadata logic inside this outer transaction and its PageType import if still needed.
- No changes to history.ts, migrations, submission-history.ts or #26 UI.
- Concurrency tests observe externally valid serial outcomes; fixed sorted row-lock construction supplies the proof that no deletion can pass between validation and publication. They do not inspect DB rows or assert private lock internals. Database use in tests is limited to accounts/roles and cleanup.
