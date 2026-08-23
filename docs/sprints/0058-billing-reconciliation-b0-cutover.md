# Sprint 0058 — ADR 0042 Sprint B0: certified, lock-protected reconciliation cutover

Status: **Deployed and verified against real Postgres.** No functions yet (Sprint B1), no application code change, no billing behaviour change — schema only.

## What shipped

`supabase/migrations/20260823000000_billing_reconciliation_cutover.sql`, matching [ADR 0042](../decisions/0042-billing-reconciliation-authority.md) §P3 "Rollout" exactly:

1. Five `LOCK TABLE ... NOWAIT` statements, fixed order, modes derived per table from its actual writers (`share` on `billing_credit_accounts`/`billing_credit_grants`; `access exclusive` on the three tables gaining a column, forced by their own `ADD COLUMN` regardless).
2. An in-transaction certification, mirroring `reconcileBalance`/`reconcileLotAllocation` exactly, that aborts the whole migration on any drift.
3. Four new nullable marker columns (`billing_credit_ledger.materialized_at`, `billing_credit_reservations.admitted_at`/`hold_released_at`, `billing_credit_allocations.capacity_materialized_at`), backfilled phase-aware only after certification passes.

## Independent review before deployment

Every table/column/constraint/index/trigger/FK reference in the migration was re-checked against the live `CREATE TABLE` statements, not against memory of writing it. Findings: `billing_credit_ledger`'s `kind`/`sign_matches_kind` CHECK constraints were altered by a later migration to add an `expiry` kind — doesn't affect the certification formula (`SUM(credit_delta)` is unconditional on `kind`, matching `postedBalance` exactly). The reservation/allocation backfill fires the existing `set_updated_at` trigger — documented in the migration itself as a bookkeeping side effect, not a business state transition. Grepped every `.from("billing_credit_*")` call in `src/modules/credits/*.ts`: zero `.delete()`/`.upsert()` calls against any of the five tables — confirms no writer path the lock analysis missed.

## Preconditions closed before push

- **Pre-migration certification, live, read-only.** Ran the migration's exact certification formula against the real project (`dcbwlctscooefwnivxzv`) via the Supabase MCP's `execute_sql`, before any write: **zero drifted accounts, zero drifted lots**, checked against 2 accounts, 51 ledger rows, 247 reservations, 5 grants, 28 allocations — not a vacuous empty-table pass.
- **Migration history reconciliation.** A pre-existing, already-documented drift (sprints 0038/0039/0040) between the local filename `20260818120000_billing_credits_stripe_entitlements.sql` and the remote's recorded version `20260818090300` for the same migration — twice left on record as "a deliberate decision somebody should make on purpose." Reconciled per rule 34 (migration files are the source of truth; the remote converges to them): one-row `UPDATE supabase_migrations.schema_migrations SET version = '20260818120000' WHERE version = '20260818090300' AND name = 'billing_credits_stripe_entitlements'` — the bookkeeping ledger only, never `billing_credit_*` or any application data. Verified by independent read-back.
- **Transactional-application proof, live, against this project.** Documentation could not settle whether `apply_migration` (the same ledger `supabase migration list`/`db:status` reads, per sprint 0039) applies a file as one transaction — `supabase.com` is blocked by this environment's egress proxy, and web search returned only an unverifiable secondary summary. Branch and disposable-new-project fallbacks were both unavailable (branching needs a paid plan; a new free project is blocked by the account's 2-project limit). A direct-on-`billing_credit_accounts` version of the proof was authorized, then blocked by this session's own auto-mode safety classifier, independent of that authorization. Fell back to a self-contained scratch-schema version, still against the real project: `CREATE SCHEMA txn_proof_scratch; CREATE TABLE ...dummy; INSERT ...; ALTER TABLE ...dummy ADD COLUMN ...; RAISE EXCEPTION` — failed with the exact custom `P0001` message. Verified independently afterward: `information_schema.schemata` shows **zero** rows for `txn_proof_scratch` — the schema creation itself, the first statement in the file, did not survive the exception either — and `supabase_migrations.schema_migrations` has **zero** rows for the test's name. Conclusive: the whole file applies as one transaction; a failure anywhere rolls back everything, including DDL that already executed without its own error earlier in the same file.

## Deployment and verification

Deployed via the Supabase MCP's `apply_migration` — the same ledger the CLI reads, not the SQL Editor copy/paste rule 29 forbids. Succeeded.

Verified by independent read-back, not by the call returning success:

- All four columns exist (`information_schema.columns`).
- The migration's row exists in `supabase_migrations.schema_migrations`.
- Zero ledger rows still `NULL` on `materialized_at` (all 51 backfilled).
- Zero reservations still missing `admitted_at` (all 247 backfilled).
- Zero terminal reservations (`settled`/`released`/`expired`) missing `hold_released_at`; zero active reservations wrongly carrying it.
- Zero terminal allocations (`consumed`/`released`) missing `capacity_materialized_at`; zero held allocations wrongly carrying it.
- Re-ran the drift check after deployment: still zero drifted accounts. `posted_credits`/`reserved_credits`/`allocated_credit_units` — the actual financial figures — are untouched; only the four new columns changed.

## What this does not do

No repair function exists yet (`materialize_*`/`repair_*`, Sprint B1). No application code was changed. `BILLING_REPAIR_ENABLED` does not exist yet, so there is nothing to gate. This migration authorizes nothing and changes no billing behaviour — see ADR 0042 §P3 Rollout for why the schema and the activation are deliberately separate steps.

## Next

Sprint B1 (the three shared materialization primitives plus the two repair scans, reviewed before anything calls them) is the next piece of ADR 0042's implementation, per the sprint breakdown in the implementation plan.
