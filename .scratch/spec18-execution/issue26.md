# #26 — 从驳回记录继续修改并重提

Commit: 52bc8a5b757573b0a36caa77c8681d6b5c81febc
Branch/worktree: codex/spec18-26 / D:/PhoskyWiki-worktrees/spec18-26
Base: fb1ee13 (includes integrated #19–24).
Dedicated DB: phosky_spec18_26; browser port 3126; independent node_modules/.env. Migrations and seed ran only here. No migration/schema change needed: supersedes_id already exists.

## Delivered / acceptance mapping

- Personal rejected submission detail exposes 修改后重新提交. New /profile/submissions/[id]/resubmit uses existing authenticated owner-only history read; pending/approved/nonowner ids are unavailable. HTTP supersedes now verifies rejected state, original submitter, original kind; edit must retain original pageId. New perspective may change termId/interpreterId as required.
- All five proposal forms reuse SubmissionForm and restore full editable fields: new term title/summary/aliases/board content; interpreter title/summary; perspective term/interpreter/content; term edit title/summary/aliases; perspective edit content. Reason displayed alongside form. Perspective editor receives current stored resolved Wiki-link identities.
- Edit reopen loads current real term snapshot/head or a single current perspective revision, shows latest vs original proposal, and requires explicit checkbox when original base differs. confirmedBaseRevisionId is parsed by existing POST /api/submissions. Under the existing createSubmission transaction, resubmitted edits lock target, lock perspective parents, require submitted base == live head, and require explicit confirmation bound to live head if old proposal base differed. Repeated head advance returns409 with instruction to reopen/reconcile and draft retention. No silent base substitution.
- Resubmission localStorage key is phoskywiki:draft:resubmit:<ownerId>:<rejectedId>, separate from ordinary editor drafts and other rejected records. All editable fields autosave, including both perspective parent selections and new interpreter metadata. Retrying restores local work even when its base advanced; requires confirmation instead of deleting it. Before a request the draft is saved immediately. Network errors, response/validation errors and deletion retain it. Only pending/direct success clears that key. Existing regular new-interpreter form also gains metadata draft retention.
- Missing/deleted edit target or parent renders understandable message plus retained editable proposal/draft with submit disabled. New-perspective missing original parent remains selected as an unavailable option; user can wait or choose another live parent. Server revalidates parents and title through existing transaction; term resubmission also explicitly rechecks rename collision. No restore operation or mutation of old submission.
- New pending row uses existing supersedes_id plus fresh quorum calculation. Personal detail now displays prior-submission link, quorum and preserved named vote/reason records, making lineage and old decision observable in rendered DOM.

## Verification

- pnpm db:migrate and pnpm db:seed: passed on dedicated DB only.
- TDD HTTP red: foreign editor supersedes incorrectly201 instead of403; fixed then passed.
- TDD HTTP red: stale resubmit incorrectly201 instead of409; fixed then passed.
- pnpm test tests/integration/resubmission.test.ts: 2 passed (final 12:53). Includes pending predecessor refusal, wrong owner403, different kind400, independent new id, immutable rejected terminal409, stale old base, silent new base refusal, explicit confirmation success, next head advance refusal.
- Browser initial red: no 修改后重新提交 entry. After implementation basic restore/network test passed. Follow-up development runs had initial compilation navigation timing and exact-label test-selector failures; switched to waiting for real URL and accessible combobox role; final runs all passed.
- PW_PORT=3126 PW_CHANNEL=chrome pnpm test:e2e tests/e2e/resubmission.spec.ts --workers=1: 4 passed (37.4s, final 12:52–53).
  1. UI reject -> own detail -> full new-term prefill -> network abort -> reload draft -> resubmit -> new lineage -> UI first/second approval -> actual public title/summary/body -> old rejected detail and votes unchanged. Old quorum1/new quorum2 after fixture adds second admin; old terminal HTTP409.
  2. Both term and perspective edit: real latest/original diff, disabled until manual confirmation, editable proposal, metadata validation error/reload retention, independent resubmit/approval/public DOM; second editor URL404 and POST403; delete target, reload, understandable disabled state and retained local content.
  3. Interpreter full fields and draft restoration, new perspective both parent fields/body, delete parent after opening -> server error/draft retained -> reload unavailable option -> change term -> resubmit/approve -> public perspective body.
  4. Editor promoted to admin (DB fixture only): direct resubmit succeeds, only matching retry draft cleared, unrelated normal draft retained, public interpreter summary updated, old record still rejected.
- PW_PORT=3126 PW_CHANNEL=chrome pnpm test:e2e tests/e2e/term-edit.spec.ts tests/e2e/editor.spec.ts --workers=1: 7 passed (34.9s). Existing field draft/baseline behavior, Markdown editing/autocomplete/preview, duplicate parent selection, mobile, metadata two-vote publishing and identity links remain covered.
- pnpm typecheck: passed final source/tests.
- pnpm lint: passed final source/tests.
- SEARCH_CONTRACT_HOST=http://127.0.0.1:1 pnpm test: 29 files passed, 2 skipped; 233 tests passed, 6 skipped, 50.02s (12:54:53 start). Five real Meilisearch contracts deliberately skipped for isolated parallel work per orchestrator; one R2 contract skipped without credentials. Not reported as passed. #29 owns final real Meili contract.
- git diff --check: passed. Worktree clean after commit.
- Development service stopped (Ctrl-C session69494); port3126 has no listening process.

## Integration/review notes

- #25 does not need this commit and did not share this worktree. Potential overlapping getMySubmission/history detail edits should preserve new termId/interpreterId/supersedesId/quorum/votes fields and existing baseSnapshot suppression.
- createSubmission remains one transaction; #22 parent-lock semantics for new_perspective retained. Resubmitted perspective edits additionally check parent liveness under locks. Existing normal non-resubmitted edit semantics intentionally unchanged.
- No new test-only API; assertions use public route responses or browser DOM. SQL only prepares accounts/roles and cleans fixtures.
- No push, GitHub comments or issue close. Required final two-axis code-review delegated to main agent per explicit user instruction. Production build is left for integrated final validation; no production deployment performed.
- No known unfinished #26 acceptance item. Regular comma-separated alias input retains its preexisting syntax; no unrelated alias format redesign or server draft storage was introduced.
