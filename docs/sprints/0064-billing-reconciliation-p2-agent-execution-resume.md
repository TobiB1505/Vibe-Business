# Sprint 0064 — ADR 0041 §P2: agent-execution pause/resume ownership

Status: **Application code only, no migration.** Reaches production through the normal PR/merge/Vercel deploy path.

## The gap this closes

Sprint 0063 shipped release-on-pause for every operation family and re-acquire-on-resume for `business_audit`, but found — while implementing, not while designing — that `agent_execution` had no resume mechanism at all: no code path in this repository ever transitioned an agent run out of `needs_user_input` after its interrupt was answered. A paused, credits-funded agent run stopped leaking its hold, but nothing could ever restart it. That gap was named explicitly in Sprint 0063's own record and in the ROADMAP rather than closed there.

This sprint was scoped by explicit instruction: analyze pause/resume ownership for agent execution and answer six specific questions (what happens to the reservation while paused, which persisted state owns the authority, when pause becomes abandonment, how resume restores ownership, how failure after resume interacts with CAS billing authority, and whether `pause_cycle` suffices) — architecture first, presented for approval, implementation only after. No timers, no sweepers, no new autonomous billing actor, no Sprint F, no lot-side repair.

## What was found before anything was designed

Traced directly against the actual orchestration code, not assumed: `agentExecutionWorkflow` is a single Vercel Workflow function. Pausing sets a local flag, runs cleanup (`cleanupAgentWorkspaceStep` destroys the sandbox unconditionally, including on a paused run — already true before this sprint), calls `finish(operationId, {kind: "paused"})`, and **returns**. Nothing suspends it; no code anywhere resumes that same instance. The platform's `workflow` package (v4.8.2) ships a durable suspend/resume primitive (`createHook`/`resumeHook`/`createWebhook`), confirmed present in `node_modules` and confirmed unused anywhere in this repository. Adopting it was considered and rejected: the sandbox is destroyed on pause regardless of which mechanism resumes the run, so a hook would not preserve anything a fresh workflow start doesn't already have to rebuild. Resume therefore means the same pattern `business_audit` already uses — terminate and restart a fresh instance for the same operation — not literal conversational continuation. Whether the agent's own context can meaningfully continue across a pause is a separate, larger design question, out of scope here.

Also confirmed before designing: agent execution is flat-priced (`agent_execution_dogfood: creditsToUnits(100)`, `credits/internal.ts`), the same shape as the three retail-priced families under a different price table — so re-acquiring the fixed price on resume is architecturally identical to `business_audit`'s already-shipped re-acquire, not a new problem. `completeAgentRun`/`failAgentRun`'s CAS guards already accepted `needs_user_input` as a source state before this sprint touched anything, which turned out to be exactly what finalizing a resumed-then-terminated run needed.

## What shipped

**No new column, no new status value, no new table.** `operation_runs.pause_cycle` (Sprint 0063) and `agent_execution_runs.credit_reservation_id` (nullable since the table was created) were sufficient for the whole lifecycle.

**`markAgentRunStarted`'s CAS widened** (`coding-agent/store.ts`) from `queued` only to `queued` or `needs_user_input`, so a resumed run both wins the claim and gets `started_at` re-stamped. The re-stamp is load-bearing, not cosmetic: `expireStaleAgentExecution` computes its deadline from `started_at`, and a resume that left the original timestamp in place could have a customer's answer, submitted days later, immediately read as already expired.

**A new `updateAgentRunCreditReservation`** (`coding-agent/store.ts`) points `agent_execution_runs.credit_reservation_id` at a freshly re-acquired reservation. Unscoped by status: the caller only reaches it after already winning `markAgentRunStarted`'s CAS, so ownership of the row is already settled.

**Re-acquire in `startAgentStep`** (`operations/agent-execution/execution.ts`), immediately after the CAS win and before any provider call: if the run's reservation pointer is non-null and no active hold exists for the operation, it re-acquires via `authorizeOperationCredits` keyed `operation:<id>:resume:<pauseCycle>` (mirroring `runInferenceStep`'s identical re-acquire for `business_audit`, added in Sprint 0063) and updates the pointer. On a fresh, never-paused run the pointer's original reservation is still active, so this is a no-op — first entry and resume share one code path rather than branching on which one this is.

**A real bug found and fixed before it shipped**: the existing release-on-pause code (Sprint 0063) read `context.run.creditReservationId` — a snapshot loaded once at the top of the function and never refreshed. Once resume could re-acquire a reservation *within the same `startAgentStep` invocation* (a resumed run immediately re-pausing on a second question), that snapshot became stale: the release would have named the reservation the re-acquire had just replaced, not the one actually held. Caught by this sprint's own multi-cycle test before it reached a review, not by a review. Fixed by tracking the current reservation id in a local variable, updated at the re-acquire and read at the release, instead of re-reading the stale `context.run`.

**A new resume-trigger, `resumeAnsweredAgentExecution`** (`coding-agent/service.ts`), mirroring `resumeAnsweredAuditOperation` exactly: re-scopes ownership by project and user, requeues the paused operation (`requeueAnsweredOperation`, matching on `needs_user` — the same idempotency guard `business_audit`'s resume already relies on), and starts a fresh workflow instance through the executor. Deliberately does not touch billing — that happens inside `startAgentStep`, gated on actually winning the claim. Wired into `answerDogfoodInterruptAction` (`agent-dogfood/[stepKey]/actions.ts`), called after every successful answer, including a replay of an already-answered interrupt — both steps are independently idempotent, so a retried submission neither re-answers nor starts a second workflow instance, and calling it defensively on every success closes the narrow window between an answer landing and a resume that never followed it.

## Authority model, in one line per question

1. **The reservation while paused**: owned by nobody. Released at the moment of pause (Sprint 0063), not held in limbo, not reclaimed by a sweep.
2. **Which persisted state owns the authority**: `agent_execution_runs.status`, via the same CAS every other transition in this file uses — whoever wins the swap out of `needs_user_input` may re-acquire and owns the later finalize call.
3. **When pause becomes abandonment**: today, immediately — release-on-pause already reflects that. Once resume exists, nothing here adds a deadline for an unanswered interrupt (forbidden by instruction and by rule 24); an explicit cancel is a future, separate, request-triggered action, not a background actor.
4. **How resume restores ownership**: the resume trigger only moves `operation_runs` back to `queued` and starts a fresh instance; `startAgentStep` restores billing ownership right before real spend resumes.
5. **Failure after resume**: unchanged CAS guards, but the finalize call must read the *updated* reservation pointer, not a stale one — the bug above, and its fix.
6. **Does `pause_cycle` suffice**: yes, as-is. Only `markAgentRunStarted`'s CAS needed widening.

## Tests

`coding-agent/store.test.ts` (new): `markAgentRunStarted`'s widened CAS wins from `queued` and from `needs_user_input`, re-stamps `started_at` on the latter, refuses from every terminal status, and only one of two concurrent callers wins; `updateAgentRunCreditReservation` points the run at the new reservation.

`operations/agent-execution/execution.test.ts` gains a `pause and resume` block: re-acquires a fresh, distinct reservation and updates the pointer on resume, including proving `started_at` changed; a second pause/resume cycle takes a third, still-distinct reservation, keyed correctly per cycle; completion after resume settles the *re-acquired* reservation, not the original released one; failure after resume releases the re-acquired reservation, not the original. The multi-cycle test is what caught the stale-snapshot release bug above — it failed before the fix, cleanly, with the exact wrong reservation id in the assertion diff.

`coding-agent/service.test.ts` gains a `resumeAnsweredAgentExecution` block: requeues and starts a fresh instance; a double submission starts no second one; refuses for a project the caller does not own; fails the operation and reports `ok: false` when the executor cannot start.

Full suite: **6,071 tests** (6,055 + 16 new), lint 0 errors, typecheck clean, build green.

## What this does not do

Whether the agent's own conversation or context can meaningfully continue across a pause/resume cycle — the sandbox is destroyed on pause today, independent of this design, and this sprint specifies the billing/CAS contract a resume mechanism must satisfy without solving, or assuming an answer to, what "resume" means at the harness level. No adoption of the platform's `createHook`/`resumeHook`/`createWebhook` primitives — considered, rejected, named as a viable but unchosen alternative. No change to Sprint 0063's `business_audit` or staleness-sweep code. Sprint F activation and lot-side repair remain untouched, per instruction.
