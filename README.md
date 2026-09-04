# Vibe Business

**Status: Active development.** The Core Loop runs end to end — see [Current state](#current-state).

Vibe Business is the business layer for AI-built products.

Core thesis: Building software is becoming dramatically easier. Turning software into a business is not.

You vibe-coded the product. Now vibe the business.

## What this is

Vibe Business is for people who have already built a website, web app, or digital product using an AI/vibe-coding tool (Lovable, Claude Code, Codex, Cursor, Replit, v0, Bolt, or similar), and now face the business problems that follow a build: monetization, pricing, distribution, conversion, retention, and ongoing optimization.

GitHub is the central integration layer, so the platform works with projects regardless of which tool originally built them.

## Local Development

**Requirements:** Node — [.nvmrc](.nvmrc) pins the version CI uses; [package.json](package.json)'s `engines` states the minimum the code supports. pnpm (`corepack enable` handles this — see the `packageManager` field).

```bash
pnpm install                # install dependencies
cp .env.example .env.local  # then fill in what you need — see below
pnpm dev                    # start the dev server at http://localhost:3000

pnpm lint                   # eslint
pnpm typecheck              # next typegen && tsc --noEmit
pnpm test                   # vitest
pnpm test:e2e               # playwright (also run by CI)
pnpm build                  # production build
pnpm atlas                  # build the project atlas — see below
```

`pnpm build`, `pnpm lint`, `pnpm typecheck` and `pnpm test` all run without any environment variables configured — CI runs them with no secrets at all.

Running the *application* needs a configured Supabase project; individual features additionally need their own credentials (GitHub App, Anthropic, Vercel Sandbox, Stripe). [.env.example](.env.example) documents each variable and the feature that requires it, and [docs/setup/](docs/setup/github-app.md) covers the one-time setup each provider needs.

Database migrations run through the Supabase CLI against a linked project:

```bash
pnpm db:status              # supabase migration list — always inspect before pushing
pnpm db:push                # apply migrations to the linked project
```

`pnpm atlas` writes `.atlas/index.html`: one page describing what this repository
contains — every module with its size, dependencies, tables, decisions and findings;
every tuneable limit, price and deadline in one register; a dependency matrix with
import-cycle detection at both module and file level; every database table against the
modules that name it; and the gap headlines from
[docs/ROADMAP.md](docs/ROADMAP.md). It is derived from the code, git and the documents
on every run and is never committed, so it cannot go stale the way a hand-written
overview would.

`pnpm screenshots:uis1` and `pnpm screenshots:uis2` render the fixture routes
under `/e2e/` and write PNGs for a person to look at. They assert nothing — they
exist because "does one action dominate?" and "are there too many chips?" are
questions a passing test is happy to ignore. Point them at a server already
running with `VIBE_E2E_FIXTURES=1`; `BASE_URL`, `OUT_DIR` and `CHROMIUM_PATH`
override the defaults. Their output is what the screenshots in
[the 2026-08-17 UX audit](docs/audits/2026-08-17-product-ux-audit/README.md)
are.

Two JSON files sit in the repository root and belong to neither the build nor
the test suite: `premium-ui.json` is the input configuration for an external UI
review tool, kept because it is used. `premium-audit.json` was that tool's
output and is gitignored — a generated artifact with a local filesystem path
inside it does not belong in version control.

Probe and dogfood scripts (`ai:probe-audit-schema`, `ai:dogfood-action-plan`, `billing:dogfood`, `execution:dogfood`, `agent:preflight`, `agent:canary`, `agent:dogfood`) are excluded from `pnpm test` on purpose: they run against real providers and real projects, and some of them spend money. Read the owning module's README before running one.

## Documentation

- [docs/](docs/README.md) — index of everything below
- [PRODUCT.md](PRODUCT.md) — product vision, target user, core flow, V0.1 scope and non-goals
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces fit together, and the index of every architecture decision
- [CLAUDE.md](CLAUDE.md) — working agreement for AI-assisted implementation sessions
- [docs/decisions/](docs/decisions/README.md) — architecture decision records
- [docs/sprints/](docs/sprints/README.md) — sprint log
- [docs/ROADMAP.md](docs/ROADMAP.md) — known gaps, in the order they are worth closing
- [docs/business/](docs/business/README.md) — measured unit economics and credit pricing analysis
- [docs/setup/](docs/setup/github-app.md) — one-time environment setup (GitHub App, Supabase Auth, Sentry)
- [docs/deployment/environment.md](docs/deployment/environment.md) — how development/preview/production URLs are resolved
- [docs/PROJECT_HISTORY_AND_LEARNINGS.md](docs/PROJECT_HISTORY_AND_LEARNINGS.md) — how the product got here: history, measured results, durable principles

## Current state

The V0.1 Core Loop is implemented end to end: a founder connects a repository and optionally a live URL, Vibe builds repository, live-product and (optionally) authenticated Deep Scan intelligence, forms a product understanding, produces a Business Readiness Audit, ranks opportunities, plans a move, prepares the change with a coding agent on an isolated branch, validates it in an isolated sandbox, serves an interactive preview of it beside the check rather than after it, takes an explicit human approval bound to that exact commit and to the preview of it, fast-forwards the default branch, and then verifies what became true in production.

Underneath it: durable operation execution, four provider usage ledgers, a Vibe Credits ledger with Stripe as the funding rail, an append-only application audit log, and an economy layer that estimates what a run will cost and measures how wrong the estimate was.

What is deliberately **not** built: no production Credit rate card is active (`CREDIT_RATE_CARDS` ships empty), Vibe deploys nothing, and business outcome measurement has no connected data source yet. [docs/ROADMAP.md](docs/ROADMAP.md) records the gaps that are worth closing and what each one is blocked on.
