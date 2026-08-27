# Deploying a schema change, and undoing a deploy

**VB-039.** Two mechanisms move Vibe Business into production and only one of them is automatic. This document says what order they go in, why that order and not the other one, and what to do when a deploy has to be undone.

## The skew this exists to prevent

| | How it reaches production | Who triggers it |
|---|---|---|
| **Application code** | Vercel's GitHub integration builds and promotes on every push to `main` | Nobody — merging *is* the deploy |
| **Database schema** | `pnpm db:push` against the linked project ([rule 29](../../CLAUDE.md)) | A person, deliberately, as a separate act |

So a merge deploys code within minutes and changes no schema. If the code in that merge reads a column the database does not have, production is broken from the moment the deployment is promoted until somebody notices and runs the migration — and the people best placed to notice are the customers.

**The migration goes first. Always.** Not "usually", not "when it seems risky": the ordering is not a judgement about a particular change, it is the only ordering under which the automatic half cannot outrun the manual half.

## The order

1. **Write the migration** in `supabase/migrations/`. That directory is the source of truth for schema; the remote database converges to match it, never the reverse ([rule 34](../../CLAUDE.md)).
2. **Read the history before touching anything.** `pnpm db:status`. A migration may already exist remotely without matching local history — never assume a table's absence or presence, and never blindly rerun ([rule 30](../../CLAUDE.md)).
3. **Apply it.** `pnpm db:push`. Never by copy-paste into the SQL Editor while the linked CLI workflow is available — that is an emergency fallback, not a workflow ([rule 29](../../CLAUDE.md), [sprint 0002a](../sprints/0002a-supabase-cli-workflow.md)).
4. **Read the result back out of the catalog.** Not out of the apply response. `pg_constraint`, `pg_policies`, `pg_proc.proacl` — whichever the change actually touched. A response that says success is a claim; a catalog read is an observation.
5. **Then merge.** The deployment that follows finds the schema already there.

If the CLI cannot be linked in the environment you are in, applying through the Supabase MCP is acceptable — it is the same authenticated path, not a SQL Editor paste. It stamps its own wall-clock version, so **rename the local file to the version the remote recorded** afterwards; otherwise `db push` will try to apply it a second time and local history has silently diverged.

## What makes migrate-first safe: every migration is backwards-compatible

Migrating first only helps if the *old* code keeps working against the *new* schema for the minutes between step 4 and step 5. That is a constraint on how migrations are written, not a hope:

- **Add, don't rename.** A renamed column breaks the deployed code instantly. Add the new one, backfill, ship the code that reads it, and drop the old one in a later migration.
- **New columns are nullable or defaulted.** A `NOT NULL` without a default fails any insert the currently-deployed code makes.
- **Widen before you narrow.** New enum values and relaxed constraints are safe to add ahead of the code. Tightening one is only safe once no deployed code can violate it.
- **Revokes are the exception and are still ordered this way.** Removing a privilege the deployed code still uses breaks it — which is exactly how [VB-015](../sprints/0103-wave1-security-before-public-traffic.md) had to be split into a revoke and a repair.

A change that genuinely cannot be made backwards-compatible is a change that needs two deploys, not a change that justifies reversing the order.

## Undoing a deploy

### Code

Vercel keeps every previous deployment. Promoting the last known-good one is the rollback, and it is immediate. Do that first and diagnose afterwards — a production incident is not the moment to write a fix.

Then revert the merge on `main` with `git revert`, so the next deployment does not re-promote the same broken build. Never force-push `main`.

### Schema

**Schema rollback is forward-only.** There is no `down` migration in this repository and there must not be one:

- A `down` that drops a column drops the data in it. That is not a rollback, it is a second, worse incident.
- A `down` run against a database whose *code* has already rolled back is being asked to undo a change the new code may still be mid-way through using.
- `supabase db reset` against a linked remote project destroys it. It is forbidden as a normal-workflow command ([rule 31](../../CLAUDE.md)) and this is one of the situations where somebody would reach for it.

So the answer to a bad migration is **a compensating migration applied the same way as any other**: written to `supabase/migrations/`, checked against `db:status`, pushed, read back. If the bad migration only *added* something, the compensating one drops it and the incident is over. If it removed or rewrote something, the data is the problem and the restore path below is the honest answer.

### When the data itself is wrong

Supabase's own point-in-time recovery is the only mechanism that undoes a destructive migration, and it restores the **whole project** to a moment — every table, every tenant, including work done correctly since. It is a last resort with a real cost, and using it is a decision, not a step in a runbook.

**This has never been exercised.** No restore drill has been run against this project. Until one has, treat "we can restore" as an assumption rather than a capability — which is the strongest argument for the compatibility rules above.

## The CI gate this deliberately does not have

The obvious automation is a CI job that runs `db push` on merge, which would make the two halves one act and remove the ordering problem entirely.

It is not built, for a specific reason rather than a general one: that job needs a credential that can rewrite the production schema, held by CI, usable by anything that can trigger a workflow. This repository's whole posture on the service-role key ([rule 53](../../CLAUDE.md)) is that RLS-bypassing authority lives in as few places as possible, and a schema-owner credential is strictly more powerful than that one.

A CI job that *verifies* rather than applies — asserting that every local migration file is present in the remote history before a merge is allowed — needs only read access and would catch the skew this document is about without holding the authority to cause it. That is the shape worth building, and it is not built yet.

## What is checked automatically today

- `pnpm db:test` runs every migration against a real PostgreSQL cluster from scratch, so a migration that cannot apply cleanly to an empty database fails before it reaches the remote one.
- CI runs lint, typecheck, the unit suite, the browser suite and the build on every pull request. **None of them touch the database**, by design — CI holds no credential that could reach it.
