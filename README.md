# Vibe Business

**Status: Early development.** The application foundation exists (Sprint 0); no business functionality is built yet.

Vibe Business is an early-stage platform exploring the business layer for AI-built products.

Core thesis: Building software is becoming dramatically easier. Turning software into a business is not.

You vibe-coded the product. Now vibe the business.

## What this is

Vibe Business is being designed for people who have already built a website, web app, or digital product using an AI/vibe-coding tool (Lovable, Claude Code, Codex, Cursor, Replit, v0, Bolt, or similar), and now face the business problems that follow a build: monetization, pricing, distribution, conversion, retention, and ongoing optimization.

GitHub is the planned central integration layer, so the platform can work with projects regardless of which tool originally built them.

## Local Development

**Requirements:** Node (see [.nvmrc](.nvmrc)), pnpm (`corepack enable` handles this — see [package.json](package.json)'s `packageManager` field).

```bash
pnpm install                # install dependencies
cp .env.example .env.local  # then fill in your Supabase project's URL + anon key
pnpm dev                    # start the dev server at http://localhost:3000
pnpm lint                   # eslint
pnpm typecheck              # tsc --noEmit (via `next typegen` first)
pnpm test                   # vitest
pnpm build                  # production build
```

`pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` all run without any environment variables configured. A configured Supabase project (`.env.local`) is only needed to actually exercise the sign-in flow — see [.env.example](.env.example) and [src/modules/auth/README.md](src/modules/auth/README.md).

## Documentation

- [PRODUCT.md](PRODUCT.md) — product vision, target user, core flow, V0.1 scope and non-goals
- [ARCHITECTURE.md](ARCHITECTURE.md) — technical architecture: confirmed V0.1 decisions and deferred/open decisions
- [CLAUDE.md](CLAUDE.md) — working agreement for AI-assisted implementation sessions
- [docs/decisions/](docs/decisions/README.md) — architecture decision records
- [docs/sprints/](docs/sprints/README.md) — sprint planning

## Current phase

Sprint 0 (application bootstrap) is complete: a Next.js/TypeScript application with a modular structure, Supabase-backed auth foundation, and working lint/typecheck/test/build/CI. No business functionality — repository analysis, audits, opportunities, AI execution, previews, approvals, or credits — is implemented yet. See [docs/sprints/0000-application-bootstrap.md](docs/sprints/0000-application-bootstrap.md) and [ARCHITECTURE.md](ARCHITECTURE.md) for what's next.
