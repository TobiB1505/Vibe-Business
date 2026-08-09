# Sprint 0 — Application Bootstrap & Development Foundation

Status: Complete
Branch: `feat/sprint-0-bootstrap`

## Goal

Establish the technical foundation of Vibe Business V0.1: a running Next.js application with strict TypeScript, a clean modular structure, validated environment configuration, a minimal working auth flow, and working lint/typecheck/test/build/CI — with no business functionality yet.

## Context

[PRODUCT.md](../../PRODUCT.md), [ARCHITECTURE.md](../../ARCHITECTURE.md), and ADRs [0001](../decisions/0001-modular-monolith.md)–[0008](../decisions/0008-secrets-management.md) fixed V0.1's product scope and foundational architecture (Next.js/TypeScript modular monolith, Supabase Postgres + Auth, GitHub App, Vercel, Anthropic behind an `AIProvider` boundary, untrusted-execution principle, Postgres audit log, host-managed secrets). Nothing had been implemented yet — this sprint turns those decisions into a running application skeleton.

## Scope

- Next.js (App Router) + TypeScript application at the repository root, strict mode, ESLint, `src/` layout.
- pnpm as package manager, `pnpm-lock.yaml` committed, expected Node version documented (`.nvmrc`, `engines.node`).
- Modular `src/` structure: `app/`, `components/{ui,layout}`, `modules/{auth,projects,github,audits,opportunities,execution,previews,approvals,usage,credits,audit-log}`, `lib/{supabase,env,utils}`, `types/` — modules populated only where Sprint 0 has real content; otherwise left as documented boundaries (`README.md`), not fake code.
- Minimal landing page (`/`) and application shell (`/app`), per the Sprint 0 spec's exact copy.
- Supabase server/browser client helpers (`src/lib/supabase/`) per current `@supabase/ssr` conventions, plus a session-refresh `middleware.ts`.
- Central, validated environment access (`src/lib/env/env.ts`, zod-based), `.env.example`.
- Minimal auth foundation: Supabase Auth email magic link, via a Server Action + `/auth/callback` Route Handler — no browser Supabase client needed for this flow.
- Migration directory structure (`supabase/migrations/`) with no tables yet.
- Vitest unit tests for the two pieces of real logic that exist (`env.ts`, `cn.ts`).
- `pnpm dev|build|start|lint|typecheck|test` scripts, all green.
- GitHub Actions CI (`.github/workflows/ci.yml`): install, lint, typecheck, test, build on push/PR to `main`. Requires no secrets.
- README updated with local development instructions and links to the governing docs.

## Non-Goals

Everything PRODUCT.md and ARCHITECTURE.md defer past Sprint 0, explicitly including:

- Business Readiness Audit, Repository/Live-URL Analysis, Opportunity Engine — no logic, no AI calls.
- GitHub App, OAuth, repository listing/permissions, webhooks, branch/PR creation — no GitHub credentials of any kind.
- Anthropic API integration, agent loops, model routing — the `AIProvider` boundary stays a documented concept (ADR 0005), not code.
- Preview generation (`PreviewProvider` implementation).
- Credit ledger, balances, pricing, payment integration.
- Background job / queue technology (ARCHITECTURE.md §7 item 10 — explicitly deferred; none introduced).
- Untrusted repository execution: no third-party repository is cloned, installed, or executed anywhere in this sprint (ADR 0006 respected by simply not touching this surface).
- Full business data model / table set (only the auth infrastructure Supabase Auth itself needs — no bespoke Sprint 0 tables were required, so none were created).
- `/app` route gating: `getSession()` exists and works, but `/app` does not yet redirect unauthenticated visitors — see [src/modules/auth/README.md](../../src/modules/auth/README.md).

## Acceptance Criteria

- [x] Next.js + TypeScript application exists and runs (`pnpm dev`).
- [x] Modular monolith structure is recognizable and matches ARCHITECTURE.md's module boundaries.
- [x] `/` renders the landing screen (verified in-browser).
- [x] `/app` shell exists and renders (verified in-browser).
- [x] Supabase foundation exists (server client, browser client, middleware).
- [x] Auth foundation exists (magic-link Server Action, callback route, `getSession()`).
- [x] Secure env structure exists (zod validation, clear errors, no server-only vars importable client-side).
- [x] No secrets committed.
- [x] No GitHub App functionality implemented.
- [x] No AI functionality implemented.
- [x] No queue technology introduced.
- [x] No full business tables built.
- [x] No third-party repositories executed.
- [x] `pnpm lint` succeeds.
- [x] `pnpm typecheck` succeeds.
- [x] `pnpm test` succeeds.
- [x] `pnpm build` succeeds.
- [x] CI workflow exists.
- [x] README updated.
- [x] This sprint document exists.

## Validation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all run clean locally with **zero environment variables set** — confirmed by running the full sequence against an unconfigured environment.
- Manual in-browser verification (dev server) of `/`, `/login`, `/app`: all three render as specified, no console errors.
- Manual verification of the failure path: submitting the login form without a configured Supabase project produces a clear runtime error naming the exact missing/invalid variables and pointing to `.env.example` — confirms the "fail loud, not silent" requirement actually works, not just in theory.
- Confirmed no code path instantiates a Supabase client (server or browser) at module scope in a page that gets prerendered — this is why the build needs no placeholder env vars at all (simpler outcome than the fallback the sprint brief anticipated).
- `git diff` / `git status` reviewed; secret-pattern scan run; dependency list reviewed against what Sprint 0 actually uses (see final report for detail).

## Risks / Notes

- **`SUPABASE_SERVICE_ROLE_KEY` intentionally not introduced.** The Sprint 0 brief's example `.env.example` included it, but nothing in Sprint 0's actual code needs elevated/service-role access (the magic-link flow uses only the anon key via cookie-based sessions). Added only when a concrete feature needs to bypass RLS server-side — see `src/lib/env/README.md` and `.env.example`. Flagged explicitly since it's a deliberate deviation from the brief's example, not an oversight.
- **`/app` is not access-gated.** `getSession()` is implemented and correct, but no page currently calls it to redirect. This was a deliberate choice so the shell stays viewable/testable without a configured Supabase project (see `src/modules/auth/README.md`); wiring the gate is straightforward future work, not a missing capability.
- **No React Testing Library / component tests.** The two Vitest tests cover the only non-trivial pure logic that exists (`env.ts` validation, `cn.ts`). UI rendering was verified manually in-browser instead of adding a DOM-testing dependency for two static screens — revisit once components carry real logic.
- **Node 24.13.0 pinned in `.nvmrc`** as the actual version this sprint was built and tested against; `engines.node` in `package.json` uses Next.js's own stated minimum (`>=20.9.0`) rather than pinning to 24 there, so the package doesn't falsely claim a hard requirement it doesn't have.
- **Turbopack is Next 16's default build/dev engine** — no explicit opt-in was made or needed; this is an unmodified Next.js default, not a Sprint 0 decision.
