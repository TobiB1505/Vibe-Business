# Sprint 0060 — ADR 0041 Sprint C: the account-side hot path

Status: **Implemented and tested against `FakeDatabase`, not yet deployed as an application change.** No migration in this sprint — Sprint B0/B1's schema and functions are already live in production. This is a TypeScript-only change to `src/modules/credits/store.ts` and `service.ts`, landing through the repository's normal PR/merge/Vercel deploy path rather than a direct database write.

## What shipped

Three of `credits/store.ts`'s five compare-and-swap writers are retired, replaced by `.rpc()` calls onto the ADR 0041 §P3 primitives Sprint B1 deployed:

- `postLedgerEntry`'s `applyPostedDelta` (the CAS retry loop moving `posted_credits`) is replaced by `materializeLedgerEntry`, a single call to `materialize_ledger_entry`.
- `claimReservation`'s `admitHold` and `closeReservation`'s `releaseHeldCredits` are both replaced by calls to the *same* function, `materialize_reservation_hold`, at the two points in a reservation's life where its own row lock finds the row in the admit phase or the release phase respectively. There is no longer a CAS loop on either side of a hold's lifecycle.

`admitHold` catches `23514` (`billing_credit_accounts_available_non_negative`) and translates it to the existing `{ ok: false, refusal: "insufficient_credits" }` shape — the same refusal the old CAS predicate produced, now decided entirely by the constraint underneath it rather than by an application-level read-then-compare. Nothing else about `claimReservation`'s or `closeReservation`'s public contract changed.

**`assertPostedBalanceMaterialized` and `MaterializationError` are deleted as dead code.** The scan-compare-throw check on `postLedgerEntry`'s replay path existed because there was no repairer — the class's own docblock said so. There is one now: a replayed post re-invokes `materializeLedgerEntry` on the same ledger entry, which checks that row's own `materialized_at` marker and finishes the materialization if a crash left it pending, or no-ops if it already landed. Self-heal instead of throw, at the exact call site the class's docblock named as the reason it had no alternative. Grepped first to confirm no consumer existed outside `store.ts`/`store.test.ts`.

**The repair call site is added, gated, and inert.** `getBillingBalance` (`service.ts`) now calls `repairAccountBalance` — a new thin `.rpc()` wrapper onto `repair_account_balance` — when reconciliation finds drift, but only behind `process.env.BILLING_REPAIR_ENABLED === "true"`, which nothing sets. Matching ADR 0041's Rollout section precisely: while unset, this call site behaves exactly as it did before this sprint — drift is still logged, `repair_account_balance` is not called-and-skipped, it is simply never reached. When it does run (a future activation), the function re-reads the account and re-derives `consistent` from the same ledger/reservation rows already fetched, so a caller who triggers a repair gets the corrected balance back in the same request rather than a repair applied invisibly for the next reader.

## Why this is safe to deploy incrementally

Sprint B1's own proof already covers the mixed-version window this deploy opens: `materialize_reservation_hold` is phase-aware and idempotent regardless of which caller — old CAS code (before this deploy) or the new `.rpc()` call (after it) — reaches a given row first, because every effect is gated by that row's own marker rather than by which code version wrote it. The only hazard ADR 0041 names for this stage is repair reading a stale marker before certification — and that cannot happen here, because repair still never runs.

## Tests

Extended `FakeDatabase`/`fakeSupabase` (`src/modules/operations/test-support.ts`) with `.rpc()` support: five hand-written mirrors of the deployed SQL functions (`fakeMaterializeLedgerEntry`, `fakeMaterializeReservationHold`, `fakeMaterializeAllocationCapacity`, `fakeRepairAccountBalance`, `fakeRepairLotAllocation`), kept line-by-line close to the migration for the same reason `checkConstraints` mirrors it by hand, all routed through the same `checkConstraints` every other write already goes through — so a fake `.rpc()` call refuses an overspend with the same `23514` a real constraint violation raises.

`credits/store.test.ts` updated rather than merely kept green:

- The two "materialized balance cannot be silently overwritten" concurrency tests are unchanged in their assertions, with their docblock rewritten — they now prove the RPC call's atomicity (one locked-row unit of work per call, so two concurrent calls can never interleave their reads) rather than a CAS loop's correctness.
- The drift-detection replay test (which manually corrupted `posted_credits` and expected `MaterializationError`) is replaced by a genuine self-heal test: a ledger row is inserted directly with no materialization, simulating a crash between insert and materialize, and the replay is shown to finish the materialization and land the correct balance — the behavior the removed class's docblock said did not exist yet.
- The CAS-exhaustion tests (a mock client that made every guarded `UPDATE` lose its swap forever) are removed — there is no retry loop left to exhaust — and replaced by two tests proving an unrecognized `.rpc()` error (not the specific `23514` each call site translates) propagates rather than being swallowed, for both the posting path and the admission path.

One pre-existing fixture broke and was fixed as part of verifying this sprint, not worked around: `agent-execution/lifecycle.test.ts`'s `stale()` helper seeded a `billing_credit_reservations` row directly with `status: "active"` and a matching `reserved_credits` already set on the account, but never set `admitted_at`. Under the two-phase primitive, `materialize_reservation_hold`'s release branch requires `admitted_at IS NOT NULL` to fire — exactly the same phase-aware condition Sprint B0's backfill applied to real data. The fixture now sets `admitted_at`, matching what the backfill would have set for a real pre-existing active reservation whose hold is already reflected in the account's cache.

Full suite: **6,031 tests, lint 0 errors, typecheck clean, build green.**

## What this does not do

`credits/lot-store.ts` is untouched — `returnToLot`'s stranded-capacity gap is Sprint D. `BILLING_REPAIR_ENABLED` is referenced but not set anywhere, so `repair_account_balance` has not been invoked against a real account by this deploy. Activation — verifying the drain conditions ADR 0041 §P3's Rollout section names and setting the flag — is Sprint F, and remains a separate, deliberate operator action.
