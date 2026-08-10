# Infrastructure — Supabase CLI Migration Workflow

Status: Complete. CLI installed, project linked, migration history reconciled and verified against the linked remote project, `db push` run (no pending migrations), `db lint --linked` clean.
Branch: `chore/supabase-cli-workflow`

## Goal

Stop using manual SQL Editor copy/paste as the normal way Vibe Business database migrations reach the remote project. Establish the official Supabase CLI workflow — linked project, `db push`, migration history verification, remote lint — as the standard path, with manual SQL Editor use demoted to an emergency fallback only.

## Why this was introduced

Sprint 1's and Sprint 2's migrations (`20260809210125_github_connection_and_projects.sql`, `20260809225438_repository_intelligence.sql`) were written and committed to this repository, but neither session had Supabase CLI credentials available, so both were documented as "apply manually via the SQL Editor" and never actually verified as applied end-to-end. That's a real gap: the repository's migration files are supposed to be the source of truth, but nothing confirmed the remote database's applied-migration history agrees with them. This infrastructure sprint closes that gap — and, going forward, prevents it from reopening — before Sprint 3 adds more schema.

## Previous workflow

1. Write a migration file in `supabase/migrations/`.
2. Copy its contents.
3. Paste into the Supabase Dashboard's SQL Editor and run it manually.
4. No record in Supabase's own migration-history tracking confirms this happened; no automated check compares local migration files against what the remote database actually has.

This works for a single manual application but has no way to detect drift, no protection against re-running a migration, and depends entirely on a human remembering to do it.

## New workflow

```bash
pnpm db:status   # supabase migration list — inspect local vs. remote BEFORE touching anything
pnpm db:push     # supabase db push — deploy pending migrations only
pnpm db:status   # confirm local and remote history now agree
pnpm db:lint     # supabase db lint --linked — lint the linked remote schema
```

Full sequence for a new migration, from [supabase/README.md](../../supabase/README.md):

1. Create the migration file in `supabase/migrations/` (`pnpm supabase migration new <description>` or by hand, following the existing `YYYYMMDDHHMMSS_description.sql` convention).
2. Review the SQL.
3. Run the application quality gates (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`).
4. `pnpm db:status` — check migration history before pushing.
5. `pnpm db:push` — deploy.
6. `pnpm db:status` — verify local/remote agree.
7. `pnpm db:lint` — check the linked remote schema.

**Manual SQL Editor copy/paste is now documented only as an emergency/exceptional fallback** (e.g. the CLI genuinely cannot reach the project), never the routine path — see [CLAUDE.md](../../CLAUDE.md) rule 29.

## Migration history reconciliation

**Performed and verified.** The CLI was authenticated with a user-supplied personal access token (`supabase login --token ... `; the token was never written to any file in this repository — see [Security](#security-note)). `supabase projects list` was used to confirm both reachable projects by name before linking anything: `dcbwlctscooefwnivxzv` = "Vibe-Business" (this project) and `aoakudtnyyvxmxzlngsb` = "Planner-Agent" (explicitly unrelated — never linked, per rule 33). Only the Vibe-Business ref was linked (`supabase link --project-ref dcbwlctscooefwnivxzv`), which succeeded without requiring the database password.

`supabase migration list` then showed the expected gap: both local migrations (`20260809210125`, `20260809225438`) present locally, but **no remote migration-history rows** — exactly the anticipated state, since Sprint 1 and Sprint 2 were applied manually via the SQL Editor and never went through the CLI.

Per the safety rule above, this was **not** treated as "therefore the tables don't exist" or "therefore it's safe to just push." Before running `migration repair`, the following was independently verified against the linked remote database via `supabase db query --linked`, to confirm the schema was genuinely already applied and not just assumed from table names:

- All 6 expected tables present (`information_schema.tables`): `github_connections`, `github_installations`, `projects`, `repository_connections`, `audit_events`, `repository_intelligence_snapshots`.
- Row Level Security enabled on all 6 (`pg_tables.rowsecurity = true`).
- Sprint 2's partial unique index `repository_intelligence_single_in_flight_idx` present with a byte-for-byte matching definition (`pg_indexes`).
- 5 specific named constraints from both migrations present exactly (`pg_constraint`): `github_connections_user_id_key`, `github_connections_github_user_id_key`, `github_installations_user_installation_key`, `repository_connections_github_repository_id_key`, `repository_intelligence_completed_has_result`.

Only after that evidence did `supabase migration repair --status applied --linked 20260809210125 20260809225438` run, marking both migrations as applied in the remote history without re-executing any SQL. A follow-up `migration list` confirmed local and remote timestamps now fully agree.

## Safety rules

Recorded here and as [CLAUDE.md](../../CLAUDE.md) rules 29–34:

- Manual SQL Editor deployment is an emergency fallback, never the routine workflow.
- Always inspect migration history (`pnpm db:status`) before `pnpm db:push`. A remote database can already contain a migration's schema effects without matching local history — never infer execution state from table existence alone, and never blindly rerun a migration.
- Never run a destructive remote reset (`db reset` against a linked/remote project) or any other irreversible remote command as part of normal workflow.
- Never guess a Supabase project ref. Derive it from safe existing configuration.
- **Never link or deploy to the `Planner-Agent` Supabase project.** It is a separate, unrelated project reachable through this environment's Supabase MCP connection — confirmed unrelated to Vibe Business in Sprint 1 and re-confirmed here. This workflow uses the Supabase CLI directly, not that MCP connection, specifically to avoid any ambiguity about which project is targeted.
- Migration files remain the source of truth; the remote database converges to match them.

## Commands

| Script | Underlying command | Purpose |
|---|---|---|
| `pnpm db:status` | `supabase migration list` | Compare local migration files against the remote's applied-migration history |
| `pnpm db:push` | `supabase db push` | Deploy pending local migrations to the linked remote project |
| `pnpm db:lint` | `supabase db lint --linked` | Lint the linked remote database schema |

One-time local setup (per machine, not part of the repeatable workflow above):

```bash
pnpm supabase login              # interactive; opens a browser
pnpm supabase link --project-ref dcbwlctscooefwnivxzv
```

The project ref (`dcbwlctscooefwnivxzv`) is not a secret — it's the subdomain of the project's public API URL (`NEXT_PUBLIC_SUPABASE_URL` in `.env.example`/`.env.local`) and was derived from there, not guessed. `supabase link` will prompt for the database password separately; it is never passed on the command line, logged, or committed.

## Validation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — pass. Adding a dev-only CLI dependency and doc/config changes did not affect application behavior.
- `pnpm db:status` (`supabase migration list`) — ran before and after reconciliation; confirmed the pre-repair gap and the post-repair alignment.
- `pnpm db:push` (`supabase db push --linked`) — ran; result: `upToDate: true`, "Remote database is up to date." (a valid, expected outcome once history was repaired — there was nothing pending to deploy).
- `pnpm db:lint` (`supabase db lint --linked`) — ran; **no schema errors found**.
- Post-reconciliation schema sanity checks (all via `supabase db query --linked`, read-only): RLS policy counts per table match the migration files exactly (`audit_events` = 2, append-only design; the other 5 tables = 4, full CRUD RLS pattern). All 8 expected foreign keys present with the correct delete behavior (`SET NULL` from `audit_events` to `auth.users`; `CASCADE` from user-owned tables to `auth.users` and from project-owned children to `projects`; `RESTRICT` on the two installation/connection-dependent FKs) — confirms `auth.users` is referenced, never modified. All 19 expected indexes present across the 6 tables, matching both migration files exactly (primary keys plus every named unique/regular index). A row-count-only check (no row contents inspected, per the brief's instruction not to expose user data unnecessarily) on `auth.users` (3), `public.projects` (2), and `public.github_installations` (1) confirmed real data intact — nothing was dropped or reset.

## Manual setup

Authentication and linking were completed during this session using a user-supplied personal access token, and do not need to be repeated on this machine. Recorded here for any other machine or future session that needs to reproduce it:

1. Authenticate the CLI. Either:
   - Run `pnpm supabase login` in an interactive terminal (opens a browser to approve), or
   - Create a personal access token at <https://supabase.com/dashboard/account/tokens> and either run `pnpm supabase login --token <token>` or set `SUPABASE_ACCESS_TOKEN` in your shell before running CLI commands.
2. Link the project: `pnpm supabase link --project-ref dcbwlctscooefwnivxzv`. In this session this succeeded without a database password prompt; if prompted, it comes from the Supabase Dashboard → Project Settings → Database.
3. Run the reconciliation sequence from [Commands](#commands) above, in order, reading the output of each `db:status` before proceeding to `db:push`.

## Security note

The personal access token used to authenticate this session was provided directly in chat by the user and used only in-memory via CLI flags/environment for the `login` step. It was never written to any file in this repository, any log file, or this document — confirmed via `git grep` across tracked files before committing. The CLI's own local session state (including `supabase/.temp/`) is gitignored and was confirmed untracked before this commit.

## Risks

- **CI still has no production Supabase access**, by design (CLAUDE.md rule already in effect, reaffirmed here). `pnpm db:push`/`db:lint` are developer/deployment-time commands, not part of the GitHub Actions workflow. If a future sprint wants automated deployment, that's a new, explicit decision — not something this infrastructure sprint introduces silently.
- **`supabase/config.toml`** was generated with `supabase init`'s defaults (unmodified) — it configures a full local Docker-based Supabase stack (Studio, local Postgres, Storage, Auth email testing, etc.) that this project does not currently use; only the CLI's remote-linking and migration commands are used. Keeping the untouched default is intentional: it's the standard, well-tested CLI output, and trimming it risks subtly breaking commands that read it. No secrets live in it — sensitive fields use `env(...)` placeholders per the CLI's own convention.
