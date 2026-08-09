# supabase/

Migration structure for the Supabase Postgres database ([ADR 0002](../docs/decisions/0002-supabase-postgres-and-auth.md)).

## Sprint 0 status

No migrations exist yet. Sprint 0 introduces no business tables ([ARCHITECTURE.md §7](../ARCHITECTURE.md#7-deferred--open-decisions) item 4) — auth (users, sessions) is fully managed by Supabase Auth's built-in schema, which requires no migration of ours. This directory exists so future schema changes are versioned from the start rather than applied ad hoc.

## Convention

- Migrations live in `supabase/migrations/` as timestamped SQL files: `YYYYMMDDHHMMSS_short_description.sql`.
- Create one with the [Supabase CLI](https://supabase.com/docs/guides/local-development) (`supabase migration new <description>`) once it's installed locally, or add a correctly named file by hand — either way, one migration per meaningful schema change, committed to this repo.
- Row Level Security is enabled and policies are added in the same migration that creates a user-/project-scoped table, per ADR 0002 — never retrofitted later.
- The Supabase CLI itself is not a project dependency (not in `package.json`) — install it separately if you need local migration tooling. See [README.md](../README.md) for local development setup.
