# Sprint 0062 — ADR 0041 P4: zero-credit settlement idempotency

Status: **Implemented and tested against `FakeDatabase`.** No migration, no new column, no new function — a pure logic fix in `credits/service.ts`. (Named "Sprint E" only as the next entry in this document's own sequence; ADR 0041's text names P4 as an obligation, not a lettered sprint the way P3's B0/F are.)

## The bug

`credit_delta <> 0` forbids a zero-delta ledger row, so `settleReservation` skips `postLedgerEntry` entirely when `actualCredits === 0` — a legitimate outcome (an operation that did no billable work) that closes the reservation with `status: "settled"`, `settled_credits: 0`, and posts no charge.

A retry of that same settlement — a replayed workflow step, a double-submitted request — used to look for its idempotency answer in exactly one place: `findLedgerEntryByIdempotencyKey`. For every other settlement that place is correct, because a charge is durable proof the first attempt finished. For a zero-credit settlement it is structurally empty by design, so the retry found nothing, fell through to `decideSettlement`, and was refused `reservation_not_active` against a reservation it had already, correctly, settled.

Confirmed as a real regression rather than assumed: the new test (`reports a retried zero-credit settlement as already settled, not refused`) was run against the pre-fix code first and failed with exactly `{ ok: false, refusal: "reservation_not_active" }`, then run again against the fix and passed.

## The fix

`settleReservation` now checks `reservation.status === "settled"` directly, before the ledger lookup, and returns success computed from the reservation row itself — `settledCredits` (set by `closeReservation` for every settlement, charged or not) and `reservedCredits` — rather than from a ledger entry that may not exist. The ledger lookup and its `charge_without_hold` anomaly detection are unchanged and still run for every status the new check does not short-circuit (`active`, `released`, `expired`); the `if (reservation.status === "settled") return settled;` line inside the old ledger-lookup branch is removed as dead, since that branch is only reached once the top-level check has already ruled the status out.

Matches ADR 0041 §P4 exactly: *"the reservation row is guaranteed to exist and reach a terminal status for every legitimate settlement, charged or not, and is therefore the correct idempotency key for the case the ledger cannot represent."*

## Tests

`service.test.ts` gains four tests: the regression itself (retried zero-credit settlement now reports `alreadySettled: true` instead of a refusal), that no ledger row is ever posted for it even across a retry, that the whole hold comes back, and that an ordinary nonzero settlement's replay still reports the right charged/released amounts now that it is answered from the reservation row rather than the ledger for the `settled` case. All nine of `service.test.ts`'s prior tests (Sprint 0057's crash-recovery and `charge_without_hold` coverage) are unchanged and still pass.

Full suite: **6,037 tests, lint 0 errors, typecheck clean, build green.**
