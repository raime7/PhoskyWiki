# Integration checkpoints for later workers

## #23
- Shared AST extraction should remain synchronous because seed/rebuild and render callers currently are synchronous.
- Existing markdown.ts owns WikiLinkNode traversal. Coordinate with #21 unavailable state additions there.
- rebuildPageLinks currently clears then resolves by name; retain target identity for keys present before rebuild. Distinguish null unresolved targets from resolved hidden/deleted targets.
- Preserve published image pipeline behavior.

## #24
- review.ts SubmissionInput already has aliases/supersedes. Existing submission kind edit currently only accepts perspectives.
- Term metadata must get its own structured revision snapshot and head; old content-only rows cannot claim historical metadata. Preserve old rows and add traceable baseline from actual fields.
- Expose reusable metadata compare/apply shapes for #25, full proposal data for #26.
- Avoid racing schema migration filenames with downstream workers; downstream starts from integrated #24.

## #27
- listRelatedTerms already sorts before local slicing, but its LocalGraphData input can be capped before matching. Validate full candidate set upstream, not just array slice in recommend.ts.
- useGuestInterests currently subscribes only to storage events and reads localStorage without guard. Same-tab settings updates need an explicit event/shared subscription, plus denied/corrupt storage fallback.
- filterLiveInterests private today; account/guest must share normalization + filtering + expansion.

## Final #29
- Dedicated DB and server; never test main development DB.
- Verify combined rename -> rebuild -> old link, delete parent -> system reject -> restore -> resubmit, metadata edit -> rollback, hidden perspective -> guest recommendation.
- Evidence at immutable implementation commit; record exact commands and passed/failed/skipped with reasons.
- Main user edits in .gitignore/AGENTS.md/spec doc/.scratch are not implementation changes.
