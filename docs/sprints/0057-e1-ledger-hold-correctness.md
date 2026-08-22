# E1 — LEDGER & HOLD CORRECTNESS — the money seams stop losing writes

**Status: implemented, not merged.** One migration, deployed and verified. No pricing change, no new dependency, no AI call, no money spent. `CREDIT_RATE_CARDS` is still `[]`.

## Why this first

`docs/ROADMAP.md` opens with *"Now — financial correctness"* and says why: these are the only entries on the list where the current behaviour can silently cost money or lose it. Both architecture reviews put this before everything else, and the economics review is explicit that no other sprint may precede it — every measurement improvement and every pricing discussion stands on a ledger whose cache can drift under concurrency.

## The review undercounted, and that is the first finding

The [economics review](../audits/2026-08-21-economics-architecture-review/README.md) named four defects (F1–F4) and reproduced exactly one of them line by line. Verification for this sprint found roughly twelve, including three the review never mentions and one whose direction it gets backwards.

*[Clarified 2026-08-22, during E2 — the original counts stand and are not changed.] Two different counts appear in this record and they cover different things. "Roughly twelve" counts **findings**: everything verification turned up, including what was deferred rather than fixed (no reconciliation repairer), what a migration closed rather than a test (the missing unique constraint), and one whose fix is covered by another scenario's assertion. ["Eleven reproductions"](#eleven-reproductions-each-observed-failing-first) counts **red tests observed failing before the fix**. Neither number is wrong; the relationship between them was never stated.*

The one it got backwards matters most. F1 is described as a drift risk on a cache. It is worse than that: an unguarded write in `releaseHeldCredits` can **erase a hold that `admitHold` has already granted and returned success for**, leaving the account *under*-reserved — a live hold the cache does not count. `billing_credit_accounts_available_non_negative` is `posted - reserved >= 0`, so it only ever catches `reserved` growing too large and is structurally blind to this direction.

Three defects the review does not list at all:

- **`lot-store.ts` never checked its own swaps.** `settleReservationAllocations` and `releaseReservationAllocations` both carried `.eq("status", "held")` as a compare-and-swap and then ignored the result — Supabase's `.update()` without `.select()` returns no row count, so a lost swap and a won one are the same empty response — while `returnToLot` ran unconditionally on the next line.
- **`allocateReservation` had no `try/finally`.** A throw from `takeFromLot` escaped with capacity taken and nothing given back: precisely the partial allocation its own docblock calls impossible.
- **`settleReservation` discarded `closeReservation`'s `{ closed }`**, so a settlement that lost its race still emitted `credit_charge.settled` and still returned `alreadySettled: false`.

## Two proofs demanded before implementation, both negative

Both came from review of the plan, before any code was written, and both changed the sprint.

### Proof 1 — terminal operation status cannot authorise releasing a hold

The plan's stale-hold sweeper was to release when `expires_at` had passed **and** the linked operation was terminal. That is only safe if a terminal `operation_run` implies billing is finalised. It does not:

```
src/modules/operations/business-audit/execution.ts
  :661   const transitioned = await completeOperationRun(...)   ← status = 'completed'
  :672   await settleOperationBilling(...)                       ← charge happens HERE
```

The comment between them says so outright: *"After the terminal transition, which is guarded so it happens at most once — so the charge inherits exactly-once from the state machine."* The same order holds in `action-plans/execution.ts:405/416` and in `opportunities/execution.ts`.

So there is a real window in which `status = 'completed'` and the reservation is still `active`, awaiting its charge. A sweeper reading terminal status as release authority would race settlement and manufacture exactly the state this sprint defines as an error: **charge exists, hold released.** It would create the inconsistency it was meant to clean up.

**The sweeper was removed from the sprint** rather than shipped with a heuristic. It is deferred as what it actually is — a lease model, where a running execution renews its claim, or a finalisation marker on the reservation proving settlement can no longer arrive. That is ADR-sized.

One piece survived, because it reasons about neither the clock nor operation state: the `agent_reservation_invalid` path. The budget binding check refused, so the run never started and no settlement is coming.

### Proof 2 — a retry could launder an unrepaired drift into a success

`postLedgerEntry` commits the ledger row and *then* materialises it. The `alreadyPosted` early return sat **before** the materialisation (`store.ts:282`, with `applyPostedDelta` at `:288`). So once this sprint made materialisation failure throw:

```
Request 1:  ledger row committed  →  CAS exhausted  →  ERROR      (correct)
Request 2:  unique violation → alreadyPosted: true  →  SUCCESS    (wrong)
            …while ledger and materialized balance still disagree
```

A reported error becoming a silent one on the very next request. This was found by reasoning about the plan, not by running it, and confirmed against the code before the fix — which makes it the sprint's clearest argument for reviewing a plan against invariants rather than against a defect list.

## Three invariants, written before any code

**I1 — Charge existence determines financial idempotency; reservation state determines whether cleanup is still needed. Never conflate them.** A charge that exists means the run is economically settled and no second charge may be posted. It says nothing about whether the hold was closed.

**I2 — A held reservation's allocation state must be structurally explainable:** fully allocated, or empty because a crash landed inside the one known window. Never partial, never re-allocated on top of an unexplained state.

**I3 — A financial result is never reported as successful when the canonical ledger mutation succeeded and its materialised account update did not** — and this holds across retries.

## What changed, in commit order

**1 · `credits/contention.ts`.** `retryDelayMs` and `sleep` were byte-identical in `store.ts` and `lot-store.ts`, and `HOLD_ATTEMPTS`/`ALLOCATION_ATTEMPTS` were the same value under two names — with the PR #46 livelock rationale written above only one of them. Extracted first, because the next commit would otherwise have written a third and fourth copy and refactored them away immediately.

**2 · CAS on the two unguarded cache writers, and drift made loud.** `applyPostedDelta`'s docblock claimed "read-modify-write on a single row, which Postgres serializes". Postgres serializes concurrent UPDATEs *of one row*; it does not serialize a SELECT and a separate UPDATE issued as two round-trips with no transaction. Both writes are now guarded by the value they read. Exhaustion throws a named `MaterializationError` carrying the account, column and delta, because by then the canonical row is already committed. The `reconcileBalance` claim in that comment was **deleted rather than restated** — that function has one caller, which logs and then returns the drifted figure anyway, and that caller has none outside the module. Proof 2's fix landed here too: the `alreadyPosted` path now proves the materialisation before inheriting the first attempt's success.

**3 · The settlement retry finishes its cleanup.** The `existingCharge` early return now closes the hold. Four states, one of them new:

| Charge exists | Reservation state after the attempt | Result |
|---|---|---|
| yes | was `active`, this call closed it | `alreadySettled: true` |
| yes | already `settled` | `alreadySettled: true` |
| yes | `active`, a concurrent settlement won the close | `alreadySettled: true` |
| yes | `released` or `expired` | **`charge_without_hold`** — a refusal |

`alreadySettled` derives from charge existence, never from `closed`. The audit event is now gated on the close having happened, matching what `releaseReservation` always did.

**4 · Allocation swaps checked, unwind exactly once.** `.select("id")` on both held-status swaps; `returnToLot` only on a won swap. `allocateReservation` gets a commit flag and a `finally` — and the old insert-error unwind was **removed rather than kept alongside**, because two unwind paths would return the same capacity twice for one failure, which is this commit's own defect one level up.

**5 · Authorization recovery, release guard, refused agent hold.** The `alreadyHeld` branch classifies instead of assuming: complete returns as before, empty allocates, **anything else is refused**. `releaseOperationCredits` gained the status guard its settle counterpart always had — it previously released allocations *first*, handing capacity back for a hold that had been charged, then reported success.

**6 · `UNIQUE (reservation_id, grant_id)`.** The one place in the billing schema where `store.ts`'s own rule — *"The guarantee is the unique index, not this check"* — was not applied.

## The ordering that Proof 4 forced

Commits 4 and 5 are in this order deliberately, and the plan originally had them reversed.

I2 holds structurally: the allocation insert is a single batch, so rows are 0 or complete. But the invariant the recovery path actually needs — **"0 rows ⟺ no capacity taken"** — did not hold before commit 4. A throw from `takeFromLot` escaped with capacity taken and no rows. So a recovery re-allocating on "0 rows" would have taken capacity **a second time** from a lot that had already given it. Commit 4 is what makes commit 5 safe.

## Eleven reproductions, each observed failing first

| Defect | Before | Expected |
|---|---|---|
| Lost posted delta | `1200000` | `1300000` |
| Erased hold (two closes) | `300000` reserved | `0` |
| Replay over a drift | resolved successfully | `MaterializationError` |
| CAS exhaustion silent | resolved successfully | `MaterializationError` ×2 |
| Hold left active by a crash | `active` | `settled` |
| Charged + released | `{ ok: true }` | `charge_without_hold` |
| Double `returnToLot` (two settles) | `0` allocated | `100000` |
| Double `returnToLot` (settle + release) | `0` allocated | `300000` |
| Missing unwind on throw | `100000` stranded | `0` |
| Retry left allocations empty | `[]` | non-empty |
| Release of a settled reservation | `{ ok: true }` | refused |

## Gate — two of them captured verbatim

Reverting `applyPostedDelta`'s swap guard:

```
FAIL  src/modules/credits/store.test.ts > the materialized balance cannot be
      silently overwritten > does not lose a posted delta when two entries interleave
AssertionError: expected 1200000 to be 1300000 // Object.is equality

- Expected
+ Received

- 1300000
+ 1200000
```

Reverting the swap check in `settleReservationAllocations`:

```
FAIL  src/modules/credits/lot-store.test.ts > capacity is returned exactly once
      > does not return a lot's capacity twice when two settlements race
AssertionError: expected +0 to be 100000 // Object.is equality

- Expected
+ Received

- 100000
+ 0
```

Both reverts were discarded and the suite re-run green.

## The migration, and one reconciliation worth recording

The CLI workflow is unusable in this container — no access token, so `db:status` cannot resolve a project ref. The migration went through the Supabase management API, the same fallback Sprints 0031, 0037 and 0040 used.

**The project was not guessed** (rule 32): the ref was derived from `NEXT_PUBLIC_SUPABASE_URL` and matched against the account's project list, which returns exactly one, named `Vibe-Business`. Remote history was inspected first (rule 30): 53 migrations, latest `20260820200000`.

**The preflight was the sprint's stop condition**, and it was clean: 28 allocation rows, zero null keys, zero `(reservation_id, grant_id)` pairs occurring more than once. Any duplicate would have meant the assumed invariant was wrong rather than the data, and the instruction was to stop and report rather than migrate.

Verified by reading the database back rather than trusting the apply: `CREATE UNIQUE INDEX billing_credit_allocations_reservation_lot_idx ON public.billing_credit_allocations USING btree (reservation_id, grant_id)`.

**The management API stamps a wall-clock version rather than the filename's** — it landed as `20260822084053` where the file is `20260822000000`. That is the drift rule 34 forbids, and Sprint 0031 recorded the same event and the same fix. The ledger row was reconciled to the filename version, which preserves ordering (`20260820200000 < 20260822000000`) and leaves local and remote identical: **54 files, 54 ledger entries, matching versions, zero wall-clock remnants.**

Worth recording precisely because it did not go smoothly: the reconciling write was refused on the first attempt by this environment's permission layer. It was **not worked around**. Renaming the file to match the stamp would have inverted rule 34's direction — the file is the source of truth and the remote converges to it — so the sprint stopped and reported instead, and the write was made after the operator granted it.

## What was not done, and why

- **The stale-hold sweeper.** Removed by Proof 1. Orphaned holds are still never reclaimed, and that gap is now recorded *with its cause* rather than as an oversight.
- **No reconciliation repair path.** `reconcileBalance` still computes drift that nothing repairs, and `reconcileLotAllocation` still has zero callers. Commit 2 deleted the comments claiming otherwise; I3 exists so the absence is loud rather than silent.
- **`returnToLot` can still permanently strand capacity** after ten attempts, logging and returning. A money-losing path, deferred because its fix is a durable repair mechanism rather than a local correction.
- **Zero-credit settlement is still not idempotent.** `service.ts:411` skips `postLedgerEntry` when `actualCredits === 0` because the `credit_delta <> 0` CHECK forbids the row, so the retry cannot hit the early return.

## What has not been proved

- **Nothing against real Postgres.** Every reproduction here runs against `FakeDatabase`'s hand-written re-implementation. It models statement atomicity honestly and does not serialize sequences, so it reproduces lost updates faithfully — but it cannot reach MVCC, `40001`, deadlocks, or the livelock class, because `CONTENTION_ATTEMPTS` uses `Math.random()` and real `setTimeout`. The 20-vs-1000 scenario that found the original livelock stays out of reach, and the constant could still silently return to 3.
- **The new unique index is unexercised.** Its presence is asserted as a string in migration text, because `credits/schema.test.ts` says in its own docblock that the fake does not evaluate constraints. A migration whose behaviour nothing runs is exactly the weakness E2 exists to close.
- **`charge_without_hold` has never occurred in production.** It is a state made visible, not a state observed.

**So the honest claim after E1 is "application-level financial races reproduced and fixed" — not "the billing engine is correct under real PostgreSQL concurrency."** That is E2, and financial correctness is not marked validated until E2 is green. Nothing is scheduled in between.

## Validation

lint 0 errors (15 pre-existing warnings, none new) / typecheck / **6,008 tests** / build / **312 E2E** green.

Migration `20260822000000_credit_allocation_identity` deployed via the management API, remote history inspected first, index read back, ledger reconciled to the filename.
