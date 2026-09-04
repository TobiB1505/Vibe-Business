# 0142 — Covered is not carried out

**Date:** 2026-09-04
**Decision:** [ADR 0089](../decisions/0089-absorbed-is-satisfied-not-completed.md)

## The question, and the founder's answer to it

Sprint 0141 closed the deadlock and left one thing open: whether a run that *absorbs* an `analysis` prerequisite should also complete it. The founder answered, and rejected the convenient version outright:

> „Ich würde nicht einfach sagen: absorbiert = done. Das wäre technisch bequem, aber semantisch unsauber. […] Wenn du beides einfach done nennst, verlierst du diese Information."

Their rule, implemented as given: absorption satisfies a step for the *flow*, never for its execution history; and it counts only once the absorbing step has genuinely finished.

| B is | A is |
|---|---|
| planned | open |
| running | open |
| failed | open |
| complete | skipped for sequencing, recorded as covered by B |

## What was actually broken

Two things, and the second one costs money.

**The plan asked for work that was already done.** `absorbedPreparationKeys` has gone into the spec identity since Core-4 — two runs carrying different preparation are different execution boundaries — but it reached no column, so no projection could ask whether a step had been covered. `firstActionableStep` kept returning it.

**And the next run would have absorbed it again.** `completedStepsForExecutionRouting` had the same blind spot, so `classifyExecutionDependency` would fold an already-covered step into a second agentic run — the agent re-establishing, inside a second paid execution, exactly what the first one established.

## What was built

Two columns mirroring the build chain, written from the validated spec document by the same insert, with five CHECK constraints — and one of them is the chain's exact **inverse**: absorbed preparation may never contain the head. A run that absorbed its own head would satisfy its own prerequisite. Another forbids a step being both delivered and covered, so one row can never say a step was carried out *and* that it never needed carrying out.

Two projections from **one pass**, deliberately not two functions: they must agree about whether the run succeeded, and two readers could drift. The drift would be a founder told an absorbed step was handled by a run that failed.

`completedStepsFromEvidence` is untouched and remains the audit trail. `satisfiedStepsFromEvidence` is the sequencing answer, and the type it returns is named `SatisfiedSteps` rather than `CompletedSteps` — the rename is the guard, because it puts the distinction in front of every future call site instead of in a comment.

On screen a covered row reads **"Covered by step 03"** and keeps its number. The tick belongs to work somebody carried out.

## Verification

Every state in the founder's table is a test, and each was proved by breaking the rule and watching a named test fail.

Removing the head-completion gate — absorption counting before B finishes — fails *"stays open while the absorbing step is unfinished"* and *"blocks the plan again if the absorbing step is not complete"*. Emitting absorption from the spec alone rather than from inside the run's verdict fails four store tests, including all three shapes of an unsuccessful run. Relaxing the two inverse SQL constraints fails *"refuses a run that absorbed its own head"* and *"refuses a step that is both absorbed and delivered"*.

Planned, running and failed collapse to one assertion at the store, and that is the design rather than a shortcut: the record cannot exist for a run that has not succeeded, verified and validated, because it is written from inside the verdict that decides all three.

Browser, because the distinction only exists where a founder reads it: a covered row names the run that covered it and does not read as done.

Domain 8,549 · SQL 397 · browser 515 · lint 0/0 · build green.

## What this does not do

**It does not record what the run established.** A covered step says *nobody needs to do this*, not *here is the answer it produced*. Storing a finding is a claim about content, and rule 77 means Vibe would have to verify it rather than read the agent's account of it — a different problem, deliberately not solved on the way past.

**It does not backfill.** The fourteen existing specs carry `'{}'`, which is the honest value: whatever they absorbed was never recorded here, and a stored row is never reinterpreted under rules it was not written against (rule 65).
