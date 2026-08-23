# 0043 - Where the Data API's privileges come from

Status: Accepted

Date: 2026-08-23

## Context

Every table in this repository is reachable through PostgREST because of a Postgres default privilege the **Supabase platform** applied at create time — `public / tables → {postgres, anon, authenticated, service_role} = arwdDxtm` — not because any migration said so. Read back from the deployed database on 2026-08-23: all 49 tables in `public` grant all seven privileges to all four roles. `anon` — the role an unauthenticated browser holds with the publishable key — has `INSERT`, `UPDATE`, `DELETE` and `TRUNCATE` on `billing_credit_ledger`, `billing_credit_grants`, `free_audit_grants` and 46 others.

That is a rule 34 violation with a deadline attached. Supabase is moving the platform default to *revoke*, and `supabase/config.toml`'s `auto_expose_new_tables` — set by Sprint 0057 E2b for local/CI parity, and explicitly labelled there as "NOT the intended permission architecture" — **is removed on 2026-10-30**. On that date a repository that still relies on the default has no stated API surface at all.

**What is not wrong today.** RLS is enabled on all 49 tables, verified directly, and it is genuinely doing the work: all 124 policies resolve `auth.uid()`, which is NULL for `anon`, so `anon` satisfies no policy anywhere. The ten billing tables carry `SELECT` policies only — no write policy exists, so RLS default-denies every write from any role that does not bypass it. The system behaves correctly. What it lacks is a second line: the grants say "anyone may do anything," and one accidentally permissive policy is the whole distance to a customer writing themselves Credits.

## Decision

**The repository states its own Data API rights, per table and per role, and stops inheriting them.** Three migrations, deliberately separated by blast radius rather than bundled by topic.

### A — explicit grants (shipped, zero effective change)

`20260823210000_data_api_explicit_grants.sql` grants, for all 49 tables:

- **`service_role` → full CRUD.** It is the only writer for all ten billing tables and the only path durable workflow steps have (ADR 0013, rule 53). It bypasses RLS, which is why what sits above it is the boundary that matters.
- **`authenticated` → exactly the commands its own RLS policies exist for**, derived per table from the deployed database's policy set rather than transcribed: 18 tables get full CRUD, 17 get `SELECT` only (including nine of the ten billing tables), and the rest fall between. `billing_stripe_events` gets nothing — it has no policies at all, deliberately, being Vibe's operational record of its payment provider's traffic.
- **`anon` → nothing, on any table.** Not a tightening but a statement of fact: `anon` can satisfy no policy in this repository, and login runs through GoTrue against the `auth` schema, not PostgREST on `public`.

**This changes nothing about the deployed database's effective permissions.** `grant` only ever adds, so stating a narrower set cannot remove the wider platform default already in place. That is the point: the statement moves into the repository without a behaviour change on a database serving live traffic.

### B — default privileges revoked (shipped, zero risk to running traffic)

`20260823220000_data_api_default_privileges.sql` revokes the default privileges for tables, sequences and functions created by `postgres` in `public`. `alter default privileges` applies at `CREATE` time only — it cannot touch an existing table or an in-flight request. From here, a migration that creates a table must grant explicitly, and one that forgets fails loudly in CI rather than silently inheriting a default that is going away.

This is what lets `auto_expose_new_tables` be deleted from `config.toml` now, ahead of its removal date, with the repository's behaviour matching the future platform default deliberately instead of discovering it on the day.

### C — the tightening (NOT shipped, deliberately)

Revoking the surplus from the existing 49 tables — `anon`'s writes above all, and `authenticated`'s privileges beyond what its policies use — is the only genuinely dangerous step, and it is not in this decision's scope. It gets its own reviewed migration, because:

- **`anon`'s unreachability is inferred, not measured.** The argument is that every policy resolves `auth.uid()`. Before revoking, that needs an empirical check that no unauthenticated request path touches PostgREST on `public` — the landing and login pages included. A wrong revoke there is an instant `42501` on the front door.
- **Policy subqueries execute as the invoking role.** `public.projects` alone backs the policies on 35 other objects. Revoking `SELECT` on it from `authenticated` would silently convert all 35 to deny-all. Any `SELECT` revoke must be checked against that dependency set.
- **It will surface latent bugs loudly.** A caller writing where no policy allows it currently gets a silent zero rows; after C it gets `42501`. That is an improvement and a reason to ship it when someone is watching.

## Consequences

- The repository, not a platform default, now says what the Data API exposes — for every table that exists and every table that will.
- `auto_expose_new_tables` is gone before its removal date rather than after it, and CI now proves the repository's own grants are sufficient instead of proving a platform default exists. ADR 0040's `42501` guardrail is inverted by this and is strictly better for it.
- The `anon` exposure is unchanged and still real until C ships. This decision narrows nothing; it makes the target explicit and the future safe. That gap is named in [docs/ROADMAP.md](../ROADMAP.md) rather than implied closed.
- Every future migration that creates a table carries a grant statement, or its table is invisible. That is new friction, chosen deliberately.

## What this decision does not establish

- **Not the tightening.** C above is designed here and shipped elsewhere.
- **Not a review of the RLS policies themselves.** This decision takes the policy set as given and derives grants from it. Whether each policy is correct is a separate question it does not open.
- **Not function `EXECUTE` rights beyond the default revoke.** Six `public` functions were already locked to `service_role` (Sprint B1); the remaining two are unexamined here, and B's default revoke affects only functions created after it.
