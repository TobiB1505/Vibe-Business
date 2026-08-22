# 0041 - Billing Reconciliation Authority

Status: Proposed
Date: 2026-08-22
Builds on [0013](0013-durable-operation-execution.md) (durable execution, and rule 24's origin), [0024](0024-vibe-credits-economic-layer.md) (the economic layer this governs)

## Context

### What Sprint 0057 already established, and where it stopped

Sprint 0057's corrective work (documented in [the E2b sprint record](../sprints/0057-e2b-ci-postgres-concurrency.md)'s "Verification found two real defects" section) proved a principle this ADR now names and generalizes: **a compare-and-swap on an entity's own terminal-status column is the only authority permitted to finalize the money tied to it.** Two independent implementations already carry it:

- Every deterministic operation family (`business-audit`, `opportunities`, `action-plans`, and the rest) gates its billing calls on `completeOperationRun`/`failOperationRun`'s return value — both are CAS on `operation_runs.status`, both return whether *this call* won the swap, and every caller has always checked it before reaching `settleOperationBilling`/`releaseOperationBilling`. `business-audit/execution.ts:656-682` is the canonical instance: `const transitioned = await completeOperationRun(...); if (!transitioned) return;` — the comment above the charge is explicit: "the charge inherits exactly-once from the state machine rather than needing its own guard."
- Agent execution's two independent finalizers — `finishAgentExecutionStep` (the durable workflow) and `expireStaleAgentExecution` (a request-time backstop) — did **not** check the equivalent boolean until Sprint 0057's corrective commits (`78b1888`, `2d99764`). Before that, both could finalize the same reservation; E2b measured the resulting `charge_without_hold` state 20 times out of 20 under real PostgreSQL MVCC. The fix reused `completeAgentRun`/`failAgentRun` — CAS on `agent_execution_runs.status`, already returning the boolean, simply never checked — rather than inventing anything.

So the *authority* half of the problem — who may act — has one answer, proven twice. What Sprint 0057 deliberately did not solve, and named as out of scope both times, is the four gaps `docs/ROADMAP.md` still lists under "Now — financial correctness":

1. **Drift repair.** `balance.ts`'s `reconcileBalance` and `store.ts`'s `MaterializationError` detect that a materialized cache column has stopped agreeing with the ledger that defines it. Nothing repairs it. `store.ts`'s own comment on `MaterializationError` says so: *"There is no repairer in this codebase — `reconcileBalance` computes drift and nothing acts on it — so the only honest response is to fail loudly."*
2. **Orphaned holds.** `operations/store.ts`'s terminal transitions are reachable only by a live step calling them. A workflow that dies mid-run — the exact failure `expireStaleAgentExecution` was built to answer for agent execution — has no equivalent backstop for any deterministic operation family. `completeOperationRun`/`failOperationRun` are gated on `ACTIVE_STATUSES = ["queued", "running"]` (`store.ts:86`); nothing ever calls them for a run nobody is watching.
3. **Stranded lot capacity.** `lot-store.ts:284`'s `returnToLot` logs and gives up after `CONTENTION_ATTEMPTS` (10) contended writes, on the stated argument that giving capacity back is "the customer-favourable direction" — which is backwards: the customer keeps paying for Credits nothing can spend.
4. **Zero-credit settlement is not idempotent.** `service.ts`'s `settleReservation` finds a retry's existing charge by ledger idempotency key — but `billing_credit_ledger.credit_delta <> 0` is a CHECK constraint (`20260817180000_billing_credits_core.sql:98`), so a zero-credit settlement posts no ledger row at all. A retry finds nothing, falls into `decideSettlement`, sees `reservation.status !== "active"` (already closed by the first attempt), and refuses with `reservation_not_active` — reporting a real success as a failure.

The user's instruction for this document is explicit: analyze these four as one architecture, not four bugfixes, and design the ADR — implementation is separate, later work.

### The precedent that already answers "how, without new infrastructure"

`expireStaleAgentExecution` (`operations/agent-execution/server-writes.ts:279`) already solved "nothing ever comes back to close an abandoned run" for exactly one case, and its own docblock states the doctrine this ADR generalizes:

> "The polling loop terminates every run it is watching. What it cannot do is survive the workflow itself dying... A durable execution that can leave a customer's Credits reserved forever is not one, so there has to be an answer that does not depend on the workflow being alive to give it. This is that answer: a read path notices, and repairs... Because the read is the moment it matters. Somebody is looking at this run's status; the alternative is a cron this product does not have and would need a decision to introduce (rule 24)."

It is fired from `getAgentExecutionStatus`, which the run page already polls. No sweeper, no schedule, no new table — a read chokepoint that already existed, carrying one more check. This is the shape every mechanism below reuses.

### Two detectors already exist and are already unused

`balance.ts`'s `reconcileBalance` and `lots.ts`'s `reconcileLotAllocation` are both pure functions that already compute "what should this cache column read, given the durable rows that define it" — for the account (`posted_credits`/`reserved_credits` vs. the ledger) and for a lot (`allocated_credit_units` vs. its allocation rows), respectively. Both have exactly the callers I1-I3 left them with in Sprint 0057 E1: `reconcileBalance` is called once, by `getBillingBalance`, which logs and returns the drifted figure anyway; `reconcileLotAllocation` has no caller at all. Neither needs to be invented. What is missing is the repair half, and the trigger.

### A gap this analysis found that neither Sprint 0057 nor the ROADMAP names

`operation_runs`'s terminal CAS (`completeOperationRun`/`failOperationRun`) is gated on `ACTIVE_STATUSES = ["queued", "running"]` — it does **not** include `needs_user`, even though `schema.ts`'s `isActive()` counts `needs_user` as active, and its own comment says why: *"A run waiting for an answer still holds..."* its reservation (`schema.ts:248`). An operation paused on a founder's answer that never comes is therefore invisible to the terminal CAS today — there is no path that ever fails it, staleness-aware or not.

Agent execution's own terminal CAS (`failAgentRun`/`completeAgentRun`, `coding-agent/store.ts:680-717`) already includes `needs_user_input` in its gate — so this specific asymmetry is `operation_runs`-only, not systemic. But `expireStaleAgentExecution`'s own eligibility check (`run.status !== "running"`, `server-writes.ts:305`) excludes `needs_user_input` from staleness *declaration* regardless — so a paused-forever agent run is unreachable for a different reason: nothing ever asks whether it should be declared stale. Both families therefore share the same live gap at the staleness-declaration layer, for a structurally different reason at the authority layer. Any design that only widens `expireStaleAgentExecution`'s pattern without addressing this is incomplete, and is treated as such below.

## Decision

Every one of the four gaps is one of exactly two questions — **who may act**, and **what is the durably correct value** — and both questions already have one answer apiece, proven or half-built. This ADR is four applications of two mechanisms, not four designs.

### P1 — Terminal-transition CAS is the only billing authority (doctrine, now named rather than emergent)

Restated as a standing rule rather than a pattern that happens to appear twice: **any entity that can independently trigger settlement or release of Credits must expose a CAS on its own terminal-status column, and every caller of a billing-affecting transition must check the boolean it returns before touching money.** `operation_runs.status` and `agent_execution_runs.status` are the two existing instances; a future billable entity (a third finalizer, a new execution surface) inherits this by doctrine, not by copying code.

The one correction P1 requires today: `operation_runs`'s `ACTIVE_STATUSES` must include `needs_user`, matching `isActive()` and matching what `agent_execution_runs`'s own CAS already does. This is safe to widen — a live execution step never calls `completeOperationRun`/`failOperationRun` while the operation's own status is `needs_user`, because reaching `needs_user` means the step already yielded control (`pauseOperationForUser`) and stopped running. Widening the gate cannot race an existing caller; it only makes the transition reachable for the new caller P2 introduces.

### P2 — Staleness is declared only at a read that already exists, never on a schedule

Generalizes `expireStaleAgentExecution` into a shared mechanism, `expireStaleOperation`, living beside `operations/store.ts` and reused by every operation family:

- **One read chokepoint, reused.** `operations/service.ts` already has the exact shape: `getOperationStatus(supabase, {projectId, operationId})` is the id-scoped read every polling surface calls, directly analogous to `getAgentExecutionStatus`. `expireStaleOperation` is wired in there, once, the same way `expireStaleAgentExecution` is wired into `getAgentExecutionStatus` today.
- **A per-operation-type policy table, not one constant.** Agent execution's deadline is `started_at + AGENT_SANDBOX_LIFETIME_MS + STALE_RUN_GRACE_MS` — sandbox lifetime is the correct outer bound *for that operation type* because the harness cannot outlive its VM. A business audit or an action plan has no sandbox; its outer bound is a different, explicit fact about its own execution shape (a token budget's worst-case wall clock, a provider timeout). This ADR requires the table be named and versioned the same way `rating.ts` centralizes `CREDIT_RATE_CARDS` and `operations.ts` centralizes model identifiers (rule 46's pattern): one file, one place a future operation type must add a row to, never a default that silently applies to something it was never measured against.
- **Widened eligibility, closing the gap this analysis found.** `expireStaleOperation` evaluates staleness for `queued`, `running`, **and** `needs_user` (once P1's gate widens to match), where `needs_user`'s policy is a distinct, likely much longer, deadline — a person being slow to answer is not the same failure as a workflow dying, and conflating their timeouts would fail a run somebody is still about to answer. The same correction applies to `expireStaleAgentExecution` for `needs_user_input`.
- **The authority for closing the money is unchanged — P1 already provides it.** `expireStaleOperation` calls `failOperationRun`; if it loses the swap, a live step finished first and this call reports nothing expired, exactly as `expireStaleAgentExecution` already does for the identical race. No new authority is invented here — P2 only decides *when* a caller shows up to use the authority P1 already governs.

### P3 — Materialization debt is marked at the row that carries it, and repaid by replaying exactly that row's delta — never by recomputing and overwriting an aggregate

**The naive design, considered and rejected.** The obvious shape — on drift, recompute the correct total from the ledger (or the allocation rows) and CAS-write that absolute value — is unsafe under the exact conditions that produce the drift in the first place. `CONTENTION_ATTEMPTS` exhaustion happens under sustained *concurrent* contention: several writers hitting the same account or lot at once. If a repairer recomputes the account's total from every committed ledger row while another writer B has committed its own ledger row but not yet won its own cache CAS, the recomputed total already includes B's delta. The repairer's CAS-write succeeds and folds B's delta into the cache early. B's own retry loop then reads the *already-updated* cache, adds its delta again — because nothing told it the cache already reflects it — and posts B's delta twice. The bug is not in the repairer's arithmetic; it is that a full recompute cannot distinguish "already applied by someone else" from "not yet applied," and the codebase's own additive CAS retries (`applyPostedDelta`, `releaseHeldCredits`, `takeFromLot`) have no way to detect that a value they are about to add has already been folded in by an outside actor.

**The design this ADR specifies instead.** Every write that moves a durable, authoritative row *and* a derived cache column already writes the durable row first (`postLedgerEntry` before `applyPostedDelta`; the allocation status flip in `settleReservationAllocations`/`releaseReservationAllocations` before `returnToLot`). What is missing is a durable marker, on the authoritative row itself, recording whether its effect has been folded into the cache yet:

- `billing_credit_ledger` gains a nullable `materialized_at timestamptz`. `applyPostedDelta`/`releaseHeldCredits` set it, in the same call, only on the CAS attempt that actually succeeds.
- `billing_credit_allocations` gains a nullable `capacity_settled_at timestamptz` (or equivalent), set by `returnToLot`'s caller only when that specific return succeeds.

**Repair becomes: find rows for this account (or lot) with a null marker, and replay each one's already-known delta through the existing, unmodified CAS retry — never compute or write an aggregate.** This composes safely with concurrent writers for the same reason the rest of this codebase's CAS loops do: each row's delta is applied at most once, guarded by that row's own marker, exactly like every other guard already in `store.ts` and `lot-store.ts`. A repairer and a live writer can safely race to materialize the *same* row — one wins the CAS, the other's attempt is a no-op, and neither double-counts, because the operation being retried is the same idempotent delta-apply that was already safe to retry ten times.

Trigger: the existing read chokepoints — `getBillingBalance` for the account, and the equivalent lot-level read for allocations — scan for unmaterialized rows belonging to what they are about to display and replay them before returning, the same "read is the moment it matters" reasoning P2 uses. No separate path is needed for the exhaustion case itself: exhaustion stops retrying immediately (as today) and leaves the marker unset, and the *next* read of that account or lot — by anyone, not necessarily the writer that gave up — finds and repays the debt. `reconcileBalance` and `reconcileLotAllocation` are unchanged and keep their present role: a loud, **never auto-corrected**, detector for drift the marker mechanism cannot explain — a manual database edit, a future bug in a path that does not use these markers at all. Per I2's own doctrine ("never re-allocate on top of an unexplained state"), unexplained drift stays an alarm, not an autocorrect.

**Migration safety this design must not skip.** Every ledger and allocation row that exists before this migration predates the marker and has, definitionally, already been materialized by the code paths that exist today. The migration must backfill `materialized_at`/`capacity_settled_at` to a fixed non-null value (its own `created_at`, not `now()`, to preserve history) for every existing row — never leave existing history `NULL`, or the first repair scan would attempt to replay the entire ledger and double-apply every already-correct row. If the live database currently holds any *already*-drifted account (a real, existing disagreement between a cache column and its ledger, from before this ADR), backfilling its rows as materialized would permanently hide that specific drift from the new mechanism — so the migration must be preceded by an explicit drift audit against the live `billing_credit_accounts`/`billing_credit_grants`, and any account found already inconsistent needs its own one-time reconciliation, decided and executed separately, before the backfill runs.

### P4 — Idempotency must be provable from a row guaranteed to exist for every legitimate outcome, including the zero-credit one

Extends I1 ("charge existence determines financial idempotency... never conflate [it with] whether the hold was closed") with the case I1 did not anticipate: an outcome that legitimately produces no charge at all. `settleReservation`'s existing early-return already contains the right shape for this — it treats an existing charge as authoritative and finishes whatever cleanup the first attempt did not. It is checked *after* trying to find that charge in the ledger, which is exactly wrong for the one outcome that never posts one. The fix: `settleReservation` checks `reservation.status === "settled"` directly, first, independent of any ledger lookup — the reservation row is guaranteed to exist and reach a terminal status for every legitimate settlement, charged or not, and is therefore the correct idempotency key for the case the ledger cannot represent.

## What this explicitly does not introduce

- **No lease, no heartbeat.** A running execution's liveness is Vercel Workflows' problem (ADR 0013); this ADR does not build a second, competing liveness model beside it. P2 asks "has anyone looked at this in longer than its policy allows", never "is the process that owns this still alive."
- **No cron, scheduler, queue, or any background execution beside Vercel Workflows** (rule 24). Every mechanism above fires from a read a caller was already making.
- **No stored procedure or database function.** Every CAS in this codebase, in every file read for this analysis, exists specifically *because* PostgREST cannot express a column-relative update — the comments in `store.ts`, `lot-store.ts` and `contention.ts` all say so independently. Reaching for a Postgres function to get atomic recompute-and-write for P3 would be the first RPC in this schema beyond triggers, and would abandon that discipline exactly where drift makes correctness matter most. Rejected for consistency, not for infeasibility.
- **No relaxed CHECK constraint.** `credit_delta <> 0` stays; P4 does not ask for a zero-delta ledger row.
- **No ledger row for a repair.** A materialization repair moves a cache column back into agreement with the ledger; it is not itself a financial event and must never be recorded as one. `adjustment` (`schema.ts:44`, "a deliberate **manual** correction, always carrying a stated reason") stays reserved for a human-authorized change to the actual balance — a support action, never something this mechanism posts on its own.
- **No new service, and no new module boundary crossed.** Everything above stays inside `src/modules/credits/` and `src/modules/operations/` (ADR 0001).

## Shape of the change

Named so a future implementation sprint has a map, not written here:

| Piece | Where |
|---|---|
| `materialized_at`, `capacity_settled_at` columns + backfill | new migration, preceded by a drift audit against the live database |
| Per-row delta replay (P3) | extends `store.ts` (account) and `lot-store.ts` (lot), reusing `contention.ts`'s existing retry shape against the new marker instead of throwing/logging on exhaustion |
| Repair trigger at read | `getBillingBalance` (`service.ts`) and the lot-level equivalent |
| `expireStaleOperation` + the per-operation-type deadline table | new module beside `operations/store.ts`, wired into `getOperationStatus` |
| `ACTIVE_STATUSES` widened to include `needs_user` | `operations/store.ts`; the equivalent widening for `needs_user_input`'s eligibility in `expireStaleAgentExecution` |
| `settleReservation`'s reservation-first idempotency check | `credits/service.ts` |

## Audit trail

Every automatic action here posts through the existing `recordAuditEvent`, the same convention `credit_charge.settled`/`credit_reservation.released` already use — nothing here invents a second logging path:

- `credit_balance.repaired` / `credit_lot.repaired` — account or lot id, the rows replayed, before/after cache values.
- `operation.expired_stale` — already the shape `expireStaleAgentExecution`'s own console line follows; made a proper audit event for every operation family rather than a `console.error`.

## Consequences

### Positive

- Closes all four ROADMAP entries with two mechanisms, not four, each of which is a direct extension of a pattern already proven correct in this codebase (P1's CAS, and P2's read-triggered backstop).
- No new infrastructure, no new liveness model, no departure from the PostgREST-only CAS discipline every other billing write already follows.
- The naive, unsafe version of P3 is named and rejected in this document, not discovered by a future incident — the reasoning is the deliverable as much as the design is.

### Negative / Tradeoffs

- **An operation that is both last in its own chain and never viewed stays stuck.** P2's trigger is a read somebody makes. ADR 0037 lets one durable operation enqueue the next, and that enqueue is itself a natural read-trigger for the operation before it — but a chain's *final* operation, if nobody ever opens the page again, has no other caller to notice it. This is a real, bounded gap, not hidden: the honest fix is a genuinely scheduled sweep, which rule 24 reserves for its own ADR, and this document does not claim to close it.
- **Per-operation-type staleness deadlines are a policy decision this ADR does not make.** It requires the table exist and be versioned; it does not choose the numbers. Choosing them wrong in either direction repeats agent execution's own tradeoff (`STALE_RUN_GRACE_MS`'s docblock: too short fails work a customer paid for, too long costs nothing but time) for every other operation family, and needs the same care.
- **The migration is not just "add two columns."** Backfilling `materialized_at`/`capacity_settled_at` incorrectly — as `now()` instead of `created_at`, or without first auditing for pre-existing drift — would either destroy history or permanently hide a real, already-existing defect from the mechanism built to find it. The audit is a prerequisite, not a step inside the same migration.
- **This ADR authorizes a shape, not a merge.** Every piece in "Shape of the change" is unimplemented. Rule 14 and the user's own instruction for this document are the same rule: design first, and stop here.

## Related

- [0013](0013-durable-operation-execution.md) — Vercel Workflows as the only durable execution provider, and rule 24's origin, which this ADR is written to respect rather than route around.
- [0024](0024-vibe-credits-economic-layer.md) — the ledger, reservation and allocation model this document reconciles.
- [Sprint 0057 E1](../sprints/0057-e1-ledger-hold-correctness.md) — invariants I1, I2, I3, and the explicit statement that a reconciliation repairer was deferred rather than invented.
- [Sprint 0057 E2b](../sprints/0057-e2b-ci-postgres-concurrency.md) — the corrective work that proved the terminal-CAS-authority principle (P1) under real PostgreSQL concurrency, and the ROADMAP entry this document closes the design for.
