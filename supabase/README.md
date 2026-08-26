# supabase/

Migration structure for the Supabase Postgres database ([ADR 0002](../docs/decisions/0002-supabase-postgres-and-auth.md)).

## Status

- `20260809210125_github_connection_and_projects.sql` (Sprint 1) — `github_connections`, `github_installations`, `projects`, `repository_connections`, `audit_events`. RLS enabled on every table with explicit policies; see [docs/sprints/0001-github-app-connection.md](../docs/sprints/0001-github-app-connection.md) for what each table is for and the manual steps to apply this migration to a real project.
- `20260809225438_repository_intelligence.sql` (Sprint 2) — `repository_intelligence_snapshots`. Versioned JSONB snapshot payload (derived facts only, never raw source), RLS via project ownership, plus a partial unique index that allows at most one in-flight run per project + commit + analyzer version. See [docs/sprints/0002-repository-intelligence.md](../docs/sprints/0002-repository-intelligence.md).
- `20260810004500_live_product_intelligence.sql` (Sprint 3) — `projects.production_url` (HTTPS-only, credential-free, check-constrained) and `live_product_intelligence_snapshots`. Kept as a separate table from repository intelligence on purpose: a project has two independent evidence sources. Derived facts only — never raw HTML, cookies, or query strings. See [docs/sprints/0003-live-product-intelligence.md](../docs/sprints/0003-live-product-intelligence.md).
- `20260810013000_business_readiness_audit.sql` (Sprint 4) — `project_business_context`, `business_readiness_audits`, `ai_usage_events`. The audit stores validated structured conclusions only — never prompts, raw model responses, or reasoning. `ai_usage_events` is insert-only under RLS with no select policy, so provider billing detail is not readable through the public API. See [docs/sprints/0004-business-readiness-audit.md](../docs/sprints/0004-business-readiness-audit.md).

Sprint 0 introduced no business tables ([ARCHITECTURE.md §7](../ARCHITECTURE.md#7-deferred--open-decisions) item 4) — auth (users, sessions) is fully managed by Supabase Auth's built-in schema, which needed no migration of ours.

## Convention

- Migrations live in `supabase/migrations/` as timestamped SQL files: `YYYYMMDDHHMMSS_short_description.sql`.
- Create one with the Supabase CLI (`pnpm supabase migration new <description>`), or add a correctly named file by hand — either way, one migration per meaningful schema change, committed to this repo.
- Row Level Security is enabled and policies are added in the same migration that creates a user-/project-scoped table, per ADR 0002 — never retrofitted later.
- Migration files are the source of truth for schema. The remote database must converge to match them, never the other way around.

## Deployment: the Supabase CLI workflow

**The normal way to deploy a migration is the linked Supabase CLI**, not the Supabase Dashboard's SQL Editor. See [docs/sprints/0002a-supabase-cli-workflow.md](../docs/sprints/0002a-supabase-cli-workflow.md) for the full write-up, safety rules, and manual project-linking setup. Short version:

```bash
pnpm db:test     # prove the schema's authority against a throwaway local cluster
pnpm db:status   # inspect local vs. remote migration history first — always
pnpm db:push     # deploy any genuinely pending migrations
pnpm db:status   # confirm local/remote agree
pnpm db:lint     # lint the linked remote schema
```

`pnpm db:test` runs `supabase/tests/*.migration.ts`. It provisions its own
PostgreSQL cluster with `initdb`, applies every migration to it, and destroys it
afterwards — so it needs PostgreSQL server binaries on the path, and there is no
connection string that could point it at a deployed project. It proves what
`db:lint` cannot: privileges, trigger context, and how a role behaves.

Manual SQL Editor copy/paste is an **emergency/exceptional fallback only** — for example if the CLI genuinely cannot reach the project. It must never be the routine path, because it silently diverges the Dashboard's applied-migrations record from what's in this repository (exactly what happened with the Sprint 1/2 migrations before this workflow existed).

The Supabase CLI is a pinned dev dependency (`package.json`) — no separate/global install needed. Project linking is a one-time local setup per machine; see the sprint document for exact commands and why the project ref is safe to derive from `NEXT_PUBLIC_SUPABASE_URL` rather than guessed.
