# supabase/

Migration structure for the Supabase Postgres database ([ADR 0002](../docs/decisions/0002-supabase-postgres-and-auth.md)).

## Status

- `20260809210125_github_connection_and_projects.sql` (Sprint 1) — `github_connections`, `github_installations`, `projects`, `repository_connections`, `audit_events`. RLS enabled on every table with explicit policies; see [docs/sprints/0001-github-app-connection.md](../docs/sprints/0001-github-app-connection.md) for what each table is for and the manual steps to apply this migration to a real project.
- `20260809225438_repository_intelligence.sql` (Sprint 2) — `repository_intelligence_snapshots`. Versioned JSONB snapshot payload (derived facts only, never raw source), RLS via project ownership, plus a partial unique index that allows at most one in-flight run per project + commit + analyzer version. See [docs/sprints/0002-repository-intelligence.md](../docs/sprints/0002-repository-intelligence.md).

Sprint 0 introduced no business tables ([ARCHITECTURE.md §7](../ARCHITECTURE.md#7-deferred--open-decisions) item 4) — auth (users, sessions) is fully managed by Supabase Auth's built-in schema, which needed no migration of ours.

## Convention

- Migrations live in `supabase/migrations/` as timestamped SQL files: `YYYYMMDDHHMMSS_short_description.sql`.
- Create one with the [Supabase CLI](https://supabase.com/docs/guides/local-development) (`supabase migration new <description>`) once it's installed locally, or add a correctly named file by hand — either way, one migration per meaningful schema change, committed to this repo.
- Row Level Security is enabled and policies are added in the same migration that creates a user-/project-scoped table, per ADR 0002 — never retrofitted later.
- The Supabase CLI itself is not a project dependency (not in `package.json`) — install it separately if you need local migration tooling. See [README.md](../README.md) for local development setup.
