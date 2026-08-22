-- ---------------------------------------------------------------------
-- One allocation row per reservation and lot (Sprint 0057)
-- ---------------------------------------------------------------------
-- `billing_credit_allocations` records which lots funded which hold. The
-- application has always intended exactly one row per (reservation, lot)
-- pair, and nothing in the database said so.
--
-- The intent is provable rather than assumed. There is exactly one INSERT
-- into this table in the whole repository — inside `allocateReservation`
-- (`src/modules/credits/lot-store.ts`) — and it is a single batch insert of
-- one row per entry in an allocation plan. `planAllocation`
-- (`src/modules/credits/lots.ts`) iterates its candidate lots and pushes at
-- most one entry per lot, and those candidates come from a SELECT over
-- `billing_credit_grants` keyed by primary key, so they are deduplicated by
-- construction. Every other statement touching this table is a SELECT or an
-- UPDATE: settlement and release mutate rows in place and never insert.
--
-- What was missing is what happens when `allocateReservation` runs twice for
-- one reservation. That is not hypothetical: `claimReservation` inserts the
-- reservation row before `admitHold`, and the allocation happens after the
-- claim returns, so a crash or a concurrent caller can leave an active hold
-- with no lots behind it. Sprint 0057 teaches the retry path to complete such
-- an allocation — and the only thing standing between that recovery and a
-- second full set of allocation rows was an application-level check.
--
-- `src/modules/credits/store.ts` states the house rule this repairs:
-- "The guarantee is the unique index, not this check." This table was the one
-- place in the billing schema where that rule was not applied.
--
-- Both columns are `not null` (see the table definition in
-- 20260818120000_billing_credits_stripe_entitlements.sql), so this is a hard
-- invariant with no NULL-semantics gap. Postgres treats NULLs as distinct in a
-- unique index by default, so a nullable key column here would have permitted
-- unlimited (reservation, NULL) rows while looking like it forbade them.
--
-- Verified against the live database before this was written: 28 allocation
-- rows, zero rows with a null key, and zero (reservation_id, grant_id) pairs
-- occurring more than once. Had that last number been anything else, the
-- sprint's instruction was to stop and report rather than migrate — a
-- duplicate would have meant the assumed invariant was wrong, not the data.
--
-- No backfill and no data change: this only forbids a state that does not
-- exist.

create unique index billing_credit_allocations_reservation_lot_idx
  on public.billing_credit_allocations (reservation_id, grant_id);

comment on index public.billing_credit_allocations_reservation_lot_idx is
  'One allocation per (reservation, lot). Makes a retried authorization unable to insert a second set of allocation rows for a hold that already has them (Sprint 0057).';
