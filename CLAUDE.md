# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

PhoskyWiki: an atomic-note wiki for left philosophy / political economy / history. Each 词条 (Term) aggregates multiple 诠释者 (Interpreter) 视角 (Perspectives). Next.js 16 App Router monolith (pages + API in one deploy), PostgreSQL + Drizzle, Meilisearch as a derived index, better-auth, Tailwind 4 + shadcn/ui, pnpm, Node ≥ 22.

Use the vocabulary in `CONTEXT.md` (it lists terms to *avoid*, e.g. never call a Perspective a "版本", never call an Editor "作者"). Read the relevant ADR in `docs/adr/` before changing an area it covers, and call out any contradiction explicitly.

## Commands

```bash
docker compose up -d              # dev PostgreSQL + Meilisearch
pnpm db:migrate && pnpm db:seed   # apply drizzle/ migrations; reseed demo content + admin (never in production)
pnpm dev                          # http://localhost:3000
pnpm lint && pnpm typecheck
pnpm db:generate                  # generate a migration after editing src/db/schema.ts
```

### Tests need an isolated database

`tests/isolated-environment.ts` refuses to run unless `DATABASE_URL` is explicitly set and its db name ends in `_test` (it never reads the dev DB from `.env`). It also blanks R2 credentials and forces `MEILI_INDEX_UID=pages-test`.

```bash
docker compose -f compose.test.yml up -d --wait
export DATABASE_URL=postgres://phosky:phosky@127.0.0.1:55435/phoskywiki_test
export BETTER_AUTH_SECRET=isolated-test-secret-0123456789abcdef0123456789
export SEARCH_CONTRACT_HOST=http://127.0.0.1:57735
export MEILI_MASTER_KEY=isolated-test-meili-master-key
pnpm db:migrate

pnpm test                                        # Vitest: tests/unit + tests/integration
pnpm exec vitest run tests/unit/foo.test.ts      # single file
pnpm exec vitest run -t "name fragment"          # single test by name
pnpm test:e2e                                    # Playwright (Chromium); run db:seed on the test DB first
pnpm exec playwright test tests/e2e/review.spec.ts
PW_CHANNEL=chrome pnpm test:e2e                  # use system Chrome; PW_PORT changes the dev-server port
pnpm test:ops                                    # node --test for backup/monitor scripts
pnpm test:containers                             # builds the real production image and runs acceptance
```

- Vitest runs with `fileParallelism: false`: integration files `seedDatabase()` (TRUNCATE) and would clobber each other.
- Vitest sets `MEILI_HOST=""`, so search uses the injected fake (`src/lib/search/fake-index.ts`). Only `search-meili.contract.test.ts` talks to a real Meilisearch.
- `server-only` is stubbed for Vitest/tsx (`tests/stubs/server-only.ts`). Scripts that import app code run with `node --conditions=react-server --import tsx` (see `package.json`).
- Playwright uses `workers: 1` (shared seed data and admin-count quorum) and never reuses an existing server.
- Cross-browser (Firefox/WebKit) configs are opt-in: `playwright.targeted.config.ts` and `playwright.wiki-preview.config.ts`.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, migrate, vitest, test:ops, the release `node --test` scripts, then the container + Playwright job.

## Architecture

- **Pages and ID addressing (ADR-0003).** Every addressable unit (term, perspective, interpreter, school, disambiguation) is a row in `pages` plus a type-specific table. URLs are `/<type>/<slug>-<id>`. Only the trailing id matters: `src/lib/resolve-page.ts` 307-redirects old slugs or bare ids to the canonical path, and a type mismatch returns 404. Revisions, submissions, soft deletion and discussion all attach to pages. Discussions and comments hang off a term; they are not pages.
- **Write path = review pipeline (ADR-0004, `src/lib/review.ts`).** Submissions store the full proposed content plus `base_revision_id`, not a diff. Non-admin submissions need quorum `min(2, admin count at creation)`. Any reject is terminal. If the page head ≠ base at approval time, the submission auto-rejects. Admin edits skip the queue but share the same pipeline: **create revision → rebuild `links` (`page-links.ts`) → sync search index**. Page-level locks (`term-lock.ts`, `role-lock.ts`) coordinate edit, rollback and delete.
- **Search is derived (ADR-0002, `src/lib/search/`).** PostgreSQL is the only source of truth. Inside a transaction, call `queueSearchSync`. `transactionWithSearchSync` rebuilds documents from committed PG state after commit. An index write failure is logged and never rolls back the write. `pnpm search:reindex` rebuilds everything. Comment and discussion docs use offset ids (`search-types.ts`) so they don't collide with page ids.
- **Markdown and wiki links.** Markdown source is stored in PG and rendered via unified/remark/rehype-sanitize (`src/lib/markdown.ts`, `reading-markdown.ts`). `[[词条]]` resolves to the term hub. `[[词条|视角@诠释者]]` targets a specific perspective, so `@` is reserved in aliases. Missing targets render as red links. The editor is CodeMirror 6 (`components/markdown-editor.tsx`).
- **Visibility.** Soft-deleted pages and their child perspectives are hidden from the public. Use `page-visibility.ts` / `getLivePage` rather than querying `pages` directly in read paths.
- **Roles** (`user_role`: `editor` | `admin` | `trusted` | `superadmin`; helpers in `src/lib/roles.ts`). Guests can read everything. A superadmin counts as an admin for review.
- **Agent BYOK.** The browser calls an OpenAI-compatible endpoint directly and keeps the key in localStorage, so it never reaches the server. Generated writing goes only into the pending-review queue.
- **Images.** Cloudflare R2 via presigned browser upload (`object-store.ts`, `r2-object-store.ts`). Tests use fakes.
- Server-side modules start with `import "server-only"`. The `@/` alias maps to `src/`.

## Repo conventions

- `.gitignore` is a **strict allowlist** (`*` then `!` rules). A new root file or new file type is silently ignored until you add a scoped `!` rule. Everything under `docs/` except three JSON fixtures stays local and is never pushed.
- Code comments and docs are mostly in Chinese. Match the surrounding language.
- Production and ops runbooks live in `docs/production.md`, `docs/releases.md` and `docs/backups.md` (local only). Never run `db:seed` against production.
