# Sprint 0061 — ADR 0042 Sprint D: the lot-side hot path

Status: **Implemented and tested against `FakeDatabase`, not yet deployed as an application change.** No migration — Sprint B0/B1's schema and functions are already live. TypeScript-only, in `src/modules/credits/lot-store.ts`, reaching production through the normal PR/merge/Vercel deploy path.

## What shipped

`returnToLot` had three callers. Two of them now call `materializeAllocationCapacity` — a thin `.rpc()` wrapper onto `materialize_allocation_capacity` — instead:

- `settleReservationAllocations`, right after flipping an allocation row to `consumed`/`released`.
- `releaseReservationAllocations`, right after flipping an allocation row to `released`.

Both sites already had a real `billing_credit_allocations` row in its terminal status at the point `returnToLot` used to run, so both had an allocation id to hand the primitive — which reads the amount to return from that row's own `credit_units`/`consumed_units` rather than being told it, and gates on that row's own `capacity_materialized_at` marker rather than a value-based compare-and-swap.

**The third caller does not convert, by design.** `allocateReservation`'s failure-unwind path gives back lot capacity taken by `takeFromLot` for a plan that never committed — the batch insert into `billing_credit_allocations` only runs after every take in the plan succeeds, so an unwound take has no allocation row at all. `materialize_allocation_capacity` is keyed by an allocation row's id and reads that row's own status; there is nothing here for it to read. This is the identical structural reason ADR 0042 gives for leaving `takeFromLot` itself unconverted — no independent durable row exists yet for a second caller to disagree with this one about. `returnToLot` (the original CAS-retry function) stays, scoped now to this one caller, and its docblock says so.

This was flagged to the user before implementation rather than resolved silently, because ADR 0042's own "Shape of the change" table states `returnToLot` moves to the primitive without this carve-out, and the carve-out is a real fork with a rejected alternative (inserting a synthetic terminal allocation row for every unwound take, so `returnToLot` could convert uniformly) that would have added audit rows for capacity that was never actually granted to a reservation — a schema-meaning decision, not a mechanical refactor. Confirmed: keep `returnToLot` on its original mechanism for the unwind path only.

## What this does not do

`repair_lot_allocation` (deployed in Sprint B1) still has no caller anywhere. Unlike the account side, where `getBillingBalance` already existed as a read path for Sprint C to attach a gated `repairAccountBalance` call to, there is no equivalent "read a lot's balance" call site today — `reconcileLotAllocation` (`lots.ts`) has zero callers outside its own test file, confirmed by grep before writing this record. Creating that read path is unscoped by this sprint and is left for whichever future sprint defines it — most likely alongside Sprint F's activation work, since a repair trigger with nothing to gate is not yet useful to build.

## Tests

`lot-store.test.ts`'s existing exactly-once-return tests (`does not return a lot's capacity twice when two settlements race`, `...when a settle and a release race`) are unchanged in their assertions and still pass, now proving the RPC call's own idempotency marker rather than the old CAS guard — the `.eq("status", "held")` swap-and-check that gates the call to `materializeAllocationCapacity` is untouched, so the property under test (a lost race returns nothing) is the same property, verified against the new mechanism underneath it. Two new tests prove an unrecognized `.rpc()` error propagates rather than being swallowed at both convertible call sites, matching Sprint C's equivalent coverage for the account side.

Full suite: **6,033 tests, lint 0 errors, typecheck clean, build green.**
