# Infrastructure — Supabase CLI Migration Workflow

Status: CLI tooling and documentation complete; **project linking and remote verification blocked on manual authentication** (see Manual setup)
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

**Not performed.** This step requires an authenticated, linked Supabase CLI session, which requires interactive human action (see Manual setup below) that could not be completed in this session. No `migration list`, `db push`, `migration repair`, or `db lint --linked` command was run against the real project — none of their output is fabricated or assumed.

Per the sprint brief's own explicit instruction ("If CLI authentication requires interactive login that cannot be completed autonomously: stop at that point and provide the exact command"), this is reported as a blocker, not glossed over. See [Manual setup](#manual-setup) for exactly what unblocks it, and the final report for the precise commands to run once unblocked.

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

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — see the final report for results. Adding a dev-only CLI dependency and doc/config changes should not affect application behavior.
- `pnpm db:status`, `pnpm db:push`, `pnpm db:lint` — **not run**; blocked on the authentication step above. Explicitly not claimed as passing.

## Manual setup

**Required before the CLI workflow can be used for real:**

1. Authenticate the CLI. Either:
   - Run `pnpm supabase login` in an interactive terminal (opens a browser to approve), or
   - Create a personal access token at <https://supabase.com/dashboard/account/tokens> and either run `pnpm supabase login --token <token>` or set `SUPABASE_ACCESS_TOKEN` in your shell before running CLI commands.
2. Link the project: `pnpm supabase link --project-ref dcbwlctscooefwnivxzv`. It will prompt for the database password (from the Supabase Dashboard → Project Settings → Database).
3. Run the reconciliation sequence from [Commands](#commands) above, in order, reading the output of each `db:status` before proceeding to `db:push`.

Do this once per machine (or once in CI if a future sprint decides to automate deployment — deliberately not done here, see Risks).

## Risks

- **Reconciliation is unverified.** Until the manual steps above are completed, it remains unconfirmed whether the remote database's migration-history tracking already lists the Sprint 1/2 migrations (applied manually, so plausibly untracked) or whether `migration repair` will be needed. Both are anticipated and documented, but neither has been observed.
- **CI still has no production Supabase access**, by design (CLAUDE.md rule already in effect, reaffirmed here). `pnpm db:push`/`db:lint` are developer/deployment-time commands, not part of the GitHub Actions workflow. If a future sprint wants automated deployment, that's a new, explicit decision — not something this infrastructure sprint introduces silently.
- **`supabase/config.toml`** was generated with `supabase init`'s defaults (unmodified) — it configures a full local Docker-based Supabase stack (Studio, local Postgres, Storage, Auth email testing, etc.) that this project does not currently use; only the CLI's remote-linking and migration commands are used. Keeping the untouched default is intentional: it's the standard, well-tested CLI output, and trimming it risks subtly breaking commands that read it. No secrets live in it — sensitive fields use `env(...)` placeholders per the CLI's own convention.
