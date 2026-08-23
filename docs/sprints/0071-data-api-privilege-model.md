# Sprint 0071 — the repository states its own Data API rights

Status: **Two migrations written, neither deployed. Zero effective permission change by construction.** The third and only dangerous step is designed and deliberately not shipped.

## The gap this closes

`docs/ROADMAP.md`'s "A newly provisioned Vibe database would have no working Data API" — the only roadmap item carrying a calendar deadline. `supabase/config.toml`'s `auto_expose_new_tables`, set by Sprint 0057 E2b for local/CI parity and labelled there as "NOT the intended permission architecture," **is removed on 2026-10-30** — 68 days from this sprint. On that date a repository still relying on the platform default has no stated API surface at all.

## What the audit found, and where the ROADMAP was wrong

Checked against the live database rather than accepted from the entry's own summary — which mattered, because two of its claims did not survive:

- **The migration count is 57, not 54**, and function-level grants have existed since Sprint B1 (six `EXECUTE` grants, eight revokes). "None contains a `GRANT`" is false at the token level. The durable claim — no *table-level* grant anywhere — held, and is what the entry meant.
- **The exposure was understated.** Not "every billing table" but **all 49**, each granting the full `arwdDxtm` to `anon`, `authenticated`, `service_role` and `postgres`. `anon` — the role an unauthenticated browser holds — has `INSERT`, `UPDATE`, `DELETE` *and* `TRUNCATE` on `billing_credit_ledger`, `billing_credit_grants`, `free_audit_grants` and 46 others.
- **The table count is 49, not 50.** A `CREATE TABLE` grep across migrations returns 50; `project_business_context` was dropped by `20260816020000` (replaced by `project_founder_intent`). The initial research pass missed the drop and listed it in the grant matrix. Deriving the list from the live database instead caught it — a migration built from that summary would have failed on its first statement.

**What is not wrong, and worth stating plainly:** RLS is enabled on all 49 tables, verified directly — zero gaps. All 124 policies resolve `auth.uid()`, which is NULL for an unauthenticated request, so `anon` can satisfy no policy on any table. The ten billing tables carry `SELECT` policies only; no write policy exists, so RLS default-denies every write from any role that does not bypass it. **The system behaves correctly today.** What it lacks is a second line: the grants say "anyone may do anything," and one accidentally permissive policy is the entire distance to a customer writing themselves Credits.

## What shipped

**Migration A — `20260823210000_data_api_explicit_grants.sql`.** 97 statements across all 49 tables: `service_role` full CRUD everywhere; `authenticated` exactly the commands its own RLS policies exist for, derived per table from the deployed policy set (18 tables full CRUD, 17 `SELECT`-only including nine of ten billing tables, the rest between, and `billing_stripe_events` nothing at all — it has no policies, deliberately); `anon` **nothing, anywhere**. Generated from the live policy matrix by script rather than transcribed, then diffed table-for-table against the live table list — 49 to 49, exact match, no invented and no missing table.

**Migration B — `20260823220000_data_api_default_privileges.sql`.** Revokes the default privileges for tables, sequences and functions created by `postgres` in `public`. Zero sequences exist, verified, so that clause is a no-op guard rather than a live concern.

**`auto_expose_new_tables` deleted from `config.toml`**, ahead of its removal date, with the comment rewritten to explain why removal is safe *now*: the repository states its own rights, so a fresh local stack derives its Data API surface from these migrations rather than from a default that is going away.

**ADR 0043** records the decision and the three-way split. **ADR 0040** gets a dated second revision pointing at it — its own "54 migrations contain no `GRANT`" sentence is left standing per rule 83, because it was true when written.

## Why neither migration can break production

**Migration A changes nothing about effective permissions.** `grant` only ever adds. Stating a *narrower* set cannot remove the wider platform default already in place, so the deployed database's effective privileges after A are byte-for-byte what they were before. That is the whole point: the statement moves into the repository without a behaviour change on a database serving live traffic.

**Migration B cannot touch an existing table.** `alter default privileges` applies at `CREATE` time and only at `CREATE` time — no existing table, no in-flight request, no running deployment is affected. It governs tables created from here on.

The safety net this creates is deliberate: with B deployed and `auto_expose_new_tables` gone, **CI proves A is correct**. If A missed a grant the application needs, the concurrency gate's own `42501` probe (ADR 0040) goes red in a disposable local stack — never in production, where the platform default still covers everything until the tightening ships.

## What this does not do

**Neither migration is deployed.** They are written, reviewed and validated as files; applying them to the live project is a separate, explicitly authorized step.

**The tightening is not shipped, deliberately.** Revoking the surplus — `anon`'s writes above all — is the only genuinely dangerous step and gets its own reviewed migration, for reasons named rather than hand-waved: `anon`'s unreachability is *inferred from policy predicates, not measured*, and needs an empirical check that no unauthenticated path reads through PostgREST first; revoking `SELECT` on `public.projects` from `authenticated` would silently convert the 35 policies whose subqueries read it into deny-all; and the change turns silent zero-row refusals into loud `42501`s, which will surface latent bugs and should happen when someone is watching.

**No RLS policy is reviewed or changed.** This sprint takes the policy set as given and derives grants from it. Whether each policy is itself correct is a separate question it does not open.

**Function `EXECUTE` rights beyond B's default revoke are unexamined.** Six `public` functions were locked to `service_role` in Sprint B1; two others exist and are not looked at here.
