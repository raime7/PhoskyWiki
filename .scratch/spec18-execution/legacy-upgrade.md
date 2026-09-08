# Legacy schema upgrade rehearsal

Date: 2026-09-08, 13:03 Asia/Shanghai. Implementation main 6e6306d. Dedicated DB phosky_spec18_legacyupgrade only.

1. Migrated empty isolated DB using old-schema worktree D:/PhoskyWiki-worktrees/spec18-19 at 9bb9b5f, through0012.
2. Prepared known fixture: page90001 term Legacy upgrade term; actual summary Actual summary before migration; aliases Known alias / Second alias; two old content revisions from2020. DB access used solely for fixture preparation.
3. Main pnpm db:migrate applied0013.
4. Node --conditions react-server --import tsx .scratch/spec18-execution/verify-legacy-upgrade.mjs called the real GET /api/pages/90001/history route. PASS: status200, exactly3 revisions, newestsource baseline with exact known title/summary/aliases; old content A/B unchanged, snapshot null/source legacy.
5. Repeated pnpm db:migrate and same HTTP verification: PASS, still exactly3 revisions (one baseline, two untouched old revisions).

No main development/production DB was touched. Smoke script and fixture are scratch-only; product regression for legacy compatibility also remains in term-edit/term-history tests. Initial scratch script relative import typo was corrected before both successful HTTP assertions; no product failure.
