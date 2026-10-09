# PhoskyWiki — Agent Notes

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels are used as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Subagents

Every subagent dispatch is announced first, including the ones a skill mandates (e.g. the book pipeline's polish and review agents). In the message right before the dispatch, give the user a plan: how many agents, each one's task, inputs and outputs, whether they run in parallel, the concrete model each one runs on, an estimated token cost, and why a subagent fits better than doing the work inline (a fresh context for independence, parallel throughput, keeping bulky reading out of the main context). Owner standing rule, 2026-10-09.

The owner's Claude quota is small, so weigh cost against benefit. Delegate to Codex whatever it can do (e.g. book-pipeline polish and review): call `codex exec` (ChatGPT plan) directly from Bash, which costs no Claude tokens, rather than wrapping it in a Claude subagent. Spend Claude subagents only on work Codex can't do.

Writing work needs a strong model: polish runs on `gpt-6.1-sol`, review on `gpt-6-astra`, both at `model_reasoning_effort="high"`. Never use luna-class or legacy models (gpt-5.x) for text. The gpt-6 models need Codex CLI ≥ 0.162. The global WSL `codex` is older and root-owned, so use the user-local install `~/.local/codex-cli/node_modules/.bin/codex` (it ships the bubblewrap its sandbox needs; the binary bundled with the Windows desktop app lacks it).

## Context management

When context usage reaches 140k tokens, compact automatically (run `/compact`) to summarize the conversation before continuing. Do not wait for the context window to fill completely — compact proactively at the 140k threshold so long tasks are not interrupted.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
