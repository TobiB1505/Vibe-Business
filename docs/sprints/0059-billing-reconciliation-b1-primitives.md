# Sprint 0059 — ADR 0041 Sprint B1: the shared materialization primitives

Status: **Deployed and verified against real Postgres.** No wiring — nothing in `src/` calls any of these five functions yet. No billing behaviour changed.

## What shipped

`supabase/migrations/20260823010000_billing_reconciliation_primitives.sql`, matching [ADR 0041](../decisions/0041-billing-reconciliation-authority.md) §P3 exactly:

- `materialize_ledger_entry(uuid)`, `materialize_reservation_hold(uuid)`, `materialize_allocation_capacity(uuid)` — one idempotent, transactional primitive per cache, each locking exactly one durable row (`SELECT ... FOR UPDATE`) and checking its own marker inside the same transaction as the effect it applies. Safe to call twice, from any two callers, in any order.
- `repair_account_balance(uuid)`, `repair_lot_allocation(uuid)` — thin scans that find rows with a `NULL` marker and call the primitive above on each. Neither recomputes or overwrites a cache column directly.
- `SECURITY INVOKER`, `SET search_path = ''`, no dynamic SQL, `EXECUTE` revoked from `PUBLIC`/`anon`/`authenticated` and granted to `service_role` only, on all five — matching the `execution_specs` precedent this schema already corrected once for exactly this mistake.

## Re-derived proof, against this actual code

Two concurrent calls to the same primitive for the same row: both attempt `SELECT ... FOR UPDATE`; one blocks until the other commits; the second re-reads the row, sees the committed marker, and no-ops. Exactly once, regardless of arrival order — including the specific failure ADR 0041's second revision found in the prior repair-only design: a repair that recomputes a total can fold in a hot-path writer's not-yet-applied delta, and that writer's own next attempt then re-applies it. These primitives never recompute a total — each applies exactly one row's own delta, gated by that row's own marker — so the class of bug does not exist to reappear.

`materialize_reservation_hold`'s two-phase branching checked against `voidReservation`'s actual behaviour: a reservation voided before its admit ever succeeded never sets `admitted_at`, so it never passes the admit branch (`status != 'active'`) and never reaches the release branch either (`admitted_at IS NULL` blocks it) — nothing is ever subtracted for a hold that was never added.

## Security, verified live

`supabase get_advisors --type security`, run immediately after deploy: **zero findings against any of the five new functions.** All four listed findings are pre-existing and already documented — `billing_stripe_events`'s RLS-enabled-no-policy (deliberate design, §67, recorded in sprint 0038), `set_updated_at`'s mutable search_path and `rls_auto_enable`'s `SECURITY DEFINER` `anon`/`authenticated` reachability (both recorded in sprint 0039), and Auth's leaked-password-protection setting (unrelated to any migration). None introduced by this sprint.

## Functional proof, against real data

Sprint B0's backfill already marked every existing row materialized for its current phase, which makes "call repair against real data and confirm it changes nothing" a genuine, low-risk test of the deployed code rather than a synthetic one. Read `posted_credits`/`reserved_credits` for both real accounts and `allocated_credit_units` for all five real lots; called `repair_account_balance`/`repair_lot_allocation` against every one; re-read. **Byte-for-byte identical, before and after** — `5780000`/`0` reserved and `0`/`0` posted-reserved unchanged on the two accounts; `0`, `220000`, `0`, `100000`, `1000000` unchanged across the five lots. No error, no drift, no unexpected write.

## What this does not do

Nothing calls these functions yet. `BILLING_REPAIR_ENABLED` does not exist. `getBillingBalance` still only logs drift. Sprints C and D wire the hot-path writers and the repair trigger; Sprint F activates it, gated on the drain conditions ADR 0041 §P3 Rollout defines.
