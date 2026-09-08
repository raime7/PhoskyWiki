# Spec #18 execution ledger

Start/review baseline: 855285b5be39d1dc8aafeef31a6c0a77d1e08905 (user confirmed start HEAD).
Integration branch: main, D:/PhoskyWiki. Preserve initial uncommitted .gitignore, AGENTS.md, .scratch/, docs/specs/0002-mvp-gap-closure.md.
One independent subagent per issue; max three concurrent workers. Worker branches codex/spec18-N under D:/PhoskyWiki-worktrees/spec18-N. Dedicated databases phosky_spec18_N, ports 3100+N. No production writes, no GitHub comments/closures/push requested.

| Issue | Depends | Status |
| --- | --- | --- |
| #19 graph text | none | running issue19 |
| #20 review external assertions | none | running issue20 |
| #21 perspective visibility | none | running issue21 |
| #22 parent publish validation | #21 | queued |
| #23 AST wiki links | none | queued, next slot |
| #24 term metadata | none | queued, next slot |
| #25 history rollback | #24 | queued |
| #26 rejected resubmit | #24 | queued |
| #27 guest interests | none | queued |
| #28 historical links | #23 #24 | queued |
| #29 combined acceptance | #19 #20 #22 #25 #26 #27 #28 | queued |

Implementation skill: D:/PhoskyWiki/.agents/skills/implement/SKILL.md; per-issue commits and tests. Final two-axis review with independent Standards and Spec agents from pinned baseline, repair findings, rerun relevant checks. Spec already confirms HTTP/SSR DOM and browser seams, pure helpers supplementary; real isolated PG, search/object store fakes, contract outcomes explicitly reported.

Reports: issueN.md in this directory. Parent and child issue bodies cached as spec18.json and children.json. Refresh comments with gh before implementing. New agents should receive compact task-specific briefs, not entire exploration outputs.

Baseline validation: pnpm typecheck PASS; pnpm lint PASS (main at 855285b, initial user changes preserved).

#19 integrated: 9bb9b5f (main cherry-pick), 221 Vitest pass / 1 R2 skip; 6 browser pass, graph 8 pass. #24 starts next.

#21 integrated source 7db6cd0, Vitest 218 pass / 6 skip, HTTP 27 pass, browser matrix 3 + history. Next #22 and #23.

#20 integrated source2bf1fba: HTTP12/12 DOM3/3 full212pass6skip. #22 running from6d71dbc; #23 next from current main; #24 running from5651abb.

## Integrated commit map
- #19: main 5651abb (worker 9bb9b5f), complete.
- #21: main 6d71dbc (worker 7db6cd0), complete. Search stale-index total/facets may lag; hidden hits filtered against PG.
- #20: main 32604f0 (worker 2bf1fba), complete. Fast HTTP12 + DOM3. Main initial user changes preserved.
- #22: running /root/issue22, worktree codex/spec18-22 from6d71dbc.
- #23: running /root/issue23, worktree codex/spec18-23 from32604f0.
- #24: running /root/issue24, worktree codex/spec18-24 from5651abb. Proposed nullable revision snapshot JSONB + metadataBaseline + creator/provenance, edit_term form.

Next scheduling: first free slot #27; when #24 integrated, #25 and #26 are independent successors, #28 after #23+#24. Finally #29 after all. Each gets NEW agent (not reuse an earlier issue agent), compact brief fork_turns none. Worktrees use newly integrated main as base. Review agents after implementation slots free, full skill baseline smells prompt and pinned merge-base diff; user confirmed baseline.

Environment lesson: Meili contract uses fixed pages-contract-test index. Worker full suites set SEARCH_CONTRACT_HOST=http://127.0.0.1:1 and explicitly report skip. #19 ran true Meili successfully. #29 must run true Meili serially; R2 lacks credentials unless available then. No MEILI_HOST in worker .env. Browser system chrome; separate port per worker. No production migration/rebuild.

#22 integrated source b10981d: HTTP10/browser2 full228pass6skip, no schema/history edits. #27 starts with dependencies preinstalled.

#23 integrated source67a5ae1: full215pass6skip/browser11pass/typechecklintpass. Public edit props resolvedWikiLinks optional; parser and rebuildPageLinks signatures stable. Main now includes#19,#20,#21,#22,#23; #24/#27 running.

#24 integrated sourcea918dd9; conflicts imports retained both + createSubmission outer tx from#22 and direct provenance from#24; #23 preview props auto-merged. Integration DB phosky_spec18_integration migrations passed; 50 focused tests passed (term-edit,parent,review,wikilinks,markdown), typecheck passed. #25/#26 dirs/node_modules/.env/DB precreated ready from current main.

Current main fb1ee13 includes#19-24. #25/#26 running fromfb1ee13 with DB/env precreated. #27 running frome4ac015, HTTP401-neighbor truncation red-green done; term/page integration will preserve external metadata edit entry. #28 precreated fromfb1ee13; dependency install session8944 pending. Final review standards sources: AGENTS.md,CONTEXT.md,docs/adr/*,docs/TECH-STACK.md; Spec#18/19-29 cached.

#28 environment/node_modules install done; #29 worktree/env/DB/node_modules prepared fromfb1ee13, true SEARCH_CONTRACT_HOST localhost7700 (only run after workers stop contracts).

#27 integrated mainf0e148b (workerfd80cb8), auto-merged term page; full230pass6skip, browser27pass, build/typecheck/lint pass. #28 start now fromf0e148b. #25/#26 still running.

#25 integrated sourced7cfc6d: full235pass6skip, E2E5pass, typecheck/lint pass; source history has kind/metadataRows/limitation, PageAction hydration gating. #29 ready from current main; #26/#28 still running.

#29 agent started preparation from6bc18f2 only (matrix/evidence; await #26/#28 fixed integration signal before final tests). #26/#28 running. Final reviewers MUST be two fresh independent Standards/Spec agents after #29 completion, fixed review base855285b confirmed by user. Report under separate Standards/Spec headings and finding counts. Need resolve findings and recheck before final.

#26 integrated main6e6306d (source52bc8a5), full233pass6skip E2E11pass. #29 permitted ff main and write/debug independent deletion->restore->UI resubmit combination before final#28, no commit before finalff. #28 asked to send CLI interface. Completed9/11: #19-27. Pending#28,#29 and final two-axis review.

#28 integrated source78a4f51, full239pass6skip E2E2pass; repeatCLI 450processed0failed4unresolved rawJSONequal. All10 functional/issues#19-28 done; #29 final acceptance now may start after ff. Legacy migration rehearsal PASS, detailslegacy-upgrade.md.

## Final acceptance in progress
#29 functional base3fee401, added5combination browser tests committed4385b54407b5502898ac9ac3edb809899f85de66 in its worktree (not integrated yet; docs pending). Typecheck/lint/default pnpm build(Turbopack) passed. Vitest250pass/1R2skip, trueMeili5pass. Production3129 fullE2E first52pass23fail of75, failures predominantly auth limits; agent rerunning individual failed original tests at11s window on unchanged4385b54, retainsJSON/logs. Wait for final report+commits before cherry-pick. Then final fresh Standards/Spec reviewers from855285b. No production changes. Main currently3fee401 and original user edits only.

Final review baseline855285b -> a935c62; pure whitespacee5907c0 added. Standards1 P2 judgementaliasroundtrip (0hard); Spec2 P2(aliasroundtrip+graphHTTPstale cache). Reports review-standards.md/review-spec.md. Fixes delegated back toissue24 in newworktree spec18-alias-fix branchcodex/spec18-alias-fix envDB24port3124; issue21 spec18-cache-fix branch envDB21port3121. Both basee5907c0. Must integratefixes, rerun reviewers (keep original reports, write recheck files), appropriate final validation and append finalreview resolution to docs/spec18-delivery.md before done.

Cache fix integrated worker3d913b1 -> main8fc4da0. Real browser red3; green11, graph/visibilityHTTP10, full245pass6skip; server3121stopped. Alias fix has 3 newbrowser green +8pure tests and typecheck/lint, compatibility tests ongoing. Final verification worktree codex/spec18-final from8fc4da0 at D:/PhoskyWiki-worktrees/spec18-final, ownoffline dependencies/env, DBphosky_spec18_final port3130; migrations+seedPASS. Need ff main after alias then fullVitesttrueMeili/static/build and targetedproductionbrowser. Recheck reviewers after fixedHEAD; preserve originalreview reports.

COMPLETE: alias worker d906e000 integrated main ab83ca4; cache8fc4da0. Both independent reviewers rechecked fixed855285b...ab83ca4, Standards original1P2 resolved0new0open/0hard; Specoriginal2P2 resolved0new0open. FinalworktreeDBphosky_spec18_final: typecheck/lint/defaultTurbopackbuildPASS; Vitest258pass1R2skip, trueMeili5PASS. Production3130 targetedbrowser7: initialalias3PASS+4adminloginprepFAIL; unchangedgraph2PASS andCLI2PASS afterauthwindow. Actual auth diagnostic Origin present statuses200,200,200,429; missingOriginfirstattempt403 retainedseparately. ServerPID155340 verifiedcommandownfinalworktree stopped; port3130nolisten. Finaldocs committed58ba444; baseline...HEADdiffcheckPASS, rootstatus onlyoriginal.gitignore/AGENTS.md/untracked.scratchanddocs/specs0002. No push/issuecomment/closure/deploy. Complete reportdocs/spec18-delivery.md; finalpatchlogs and both recheckreports inscratch.
