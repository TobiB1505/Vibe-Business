# Sprint 0070 — the failed-start release, gated on the authority it always needed

Status: **Implemented and proven. Four production defects fixed. No migration, no new mechanism** — the fix reuses a compare-and-swap that already existed and whose return value was simply never checked, exactly as Sprint 0057 E2b's Defect A did for agent execution.

## The gap this closes

`docs/ROADMAP.md`'s first "Next" entry ended: "Any future caller pair that can reach `settleOperationCredits` and `releaseOperationCredits` concurrently for one reservation needs its own upstream authority established the same way; **nothing enforces that structurally today outside agent execution**." That sentence was tested rather than trusted — the same method E2b's own Defect A record prescribes: *"Enumerating every caller answered it. It does not hold."*

## What the audit found

Every production call site of both primitives was enumerated and traced back to whatever gates it.

**Confirmed correctly gated, no change needed** — the CAS boolean is checked and returned on *before* billing is reached: all six completion/failure steps across `business_audit`, `action_planning` and `opportunity_generation` (byte-identically: `const transitioned = await completeOperationRun(...); if (!transitioned) return;`), the staleness sweep in `operations/staleness.ts`, `business_audit`'s pause-release, and all four agent-execution finalizers fixed by E2b. The ROADMAP's claim about the three deterministic families holds precisely.

**Four sites were not gated.** The failed-start branches of `startBusinessAuditOperation`, `startOpportunityOperation`, `startActionPlanOperation` (all `operations/service.ts`) and `startAgentExecution` (`coding-agent/service.ts`) each called `failOperationRun` and **discarded its boolean**, then released the hold unconditionally. That is the identical unchecked-CAS shape as the original agent-execution defect — and it was sitting in the identical *kind* of place E2b's own Defect B record already warned about: "start-failure paths are where the discipline slips."

**Why it is a real defect, not a theoretical one.** `executor.start` returning `!ok` says *this attempt* failed. It does not say no workflow is running. `VercelWorkflowExecutor.start` wraps a network call in a `try/catch`, so a throw on the **response** — timeout, connection reset — of an enqueue that already succeeded server-side yields `{ ok: false }` for a live run that will finish, settle, and charge. In that interleaving the workflow wins `completeOperationRun` and settles; this path's `failOperationRun` loses the CAS (unchecked) and releases anyway. Charge standing, hold recorded released — precisely the `charge_without_hold` state class D demonstrated at the primitive level, now reachable through a real customer path.

The only thing that stood between that and a real occurrence was the shared wrapper's own guard (`billing.ts`: `if (!reservation || reservation.status !== "active") return;`) — a **read-then-act, not a CAS**. It narrows the window; it does not close it. And per class D's measured finding, once inside that window release wins the close deterministically while settle's charge lands anyway.

## What shipped

**The fix, four times, one line each**: `const failed = await failOperationRun(...); if (failed) await release...`. No new authority, no lease, no sweeper, no new table — the CAS was already there and already returned whether it won. Losing does not change what the invocation tells its own caller: the start failed either way.

**Reproduced red before the fix, at the `FakeDatabase` level, in both files** — the proof standard this repository has used since E2b, not a test written against the fix and assumed to mean something. `operations/service.test.ts`'s "does not release a hold it did not win the right to release" and `coding-agent/service.test.ts`'s "leaves the hold alone when something else already finalized the operation" both fail against the pre-fix code with the exact signature the defect produces — `expected 'released' to be 'active'` — and pass against the fix. Verified by reverting each site in turn, running, and restoring.

**Proven against real PostgreSQL**: a second scenario in `agent-start-failure.concurrency.ts` — a concurrent finalizer wins the terminal transition through an independent client, then the executor refuses; the operation's `completed` state must stand and the reservation must still be `active`. Deterministic by construction rather than a timing race, and the file says so plainly. What real Postgres supplies that `FakeDatabase` cannot is that the CAS's `.in("status", ACTIVE_STATUSES)` predicate is evaluated by Postgres against a row another connection already committed.

## What this does not do

**It does not make the primitives mutually exclusive.** Class D's finding stands unchanged; the primitives were never meant to be the authority boundary.

**It does not build the structural enforcement**, and the ROADMAP's own framing of that gap is now corrected rather than repeated: there *is* a shared wrapper (`settleOperationBilling`/`releaseOperationBilling`), but it is not an authority boundary — its guard is a status read, not a CAS, and its signature takes an `operationRunId` with no way to know whether the caller won anything. Making the gate un-forgettable means making the win-boolean the only way to obtain the thing that can settle or release. Feasible, and left as the named next step rather than folded into a defect fix: it must be parameterised over *which row is the authority* (`operation_runs` for the deterministic families, `agent_execution_runs` for agent execution — deliberately, since `execution.ts` runs `completeOperationRun` *after* the agent swap and after settlement), and it needs a named escape hatch for the one genuinely ungated-and-safe site rather than silence — `coding-agent/service.ts`'s `agent_reservation_invalid` branch, which is reached before `claimAgentExecutionRunRow`, so no run row exists and nothing else can be finalizing.

**No migration. No production behavior change beyond the four gates.**
