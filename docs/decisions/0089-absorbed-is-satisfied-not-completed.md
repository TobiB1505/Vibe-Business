# 0089 - Absorbed is satisfied, not completed

Status: Accepted
Date: 2026-09-04

Extends [ADR 0088](0088-a-founder-closes-what-vibe-cannot-run.md), which recorded this question as open, and [ADR 0054](0054-agent-action-plan-completion-evidence.md), whose completion authority is deliberately left untouched. Changes no execution, approval or merge authority.

## Context

`classifyExecutionDependency` folds an unfinished `analysis` prerequisite into the agentic run that depends on it, instead of letting it stand in front of that run. The agent then establishes that work inside its own boundary on the way to its delivery.

Nothing downstream knew. `absorbedPreparationKeys` went into the spec identity — two runs carrying different preparation are different execution boundaries — but reached no column, so no projection could ask *was this step covered by a run that succeeded?* `firstActionableStep` therefore kept offering the absorbed step as the plan's entry point, and a founder who acted on it would have been redoing work the agent had already done. Worse, `completedStepsForExecutionRouting` did not know either, so the classifier would absorb the same step into a *second* paid run.

The obvious repair is to mark the absorbed step completed. It is wrong, and the reason is the whole of this decision: **the step was never carried out as a piece of work in its own right.** A product that records it as completed can no longer answer a question its owner can reasonably ask later — *was this analysis done on its own, or did it come free with a build?* That is not a detail. Vibe's entire claim is that it says truthfully what happened.

## Decision

**Absorption satisfies a step for sequencing. It never completes it.**

Two sets, produced from one pass over the same records so they cannot disagree about whether the run succeeded:

- `completedStepsFromEvidence` — unchanged, and still the audit trail. A step is in it only if a founder resolution, a founder attestation, or a verified-and-validated run *for that step* says so.
- `satisfiedStepsFromEvidence` — completions plus steps a **successful** absorbing run covered. This is what `firstActionableStep`, `isUnblocked` and `planProgress` read; the sequencing type is named `SatisfiedSteps` so the distinction is visible at every call site.

**"Successful" is not a new judgement.** An `AbsorbedStepSatisfaction` is emitted from inside the same four-record verdict that lets a run's own steps count as complete — spec, succeeded planner run with a Prepared Change, `change_verified`, passed validation that verified the changed files. So the four states collapse to two facts:

| The absorbing step B is | A is |
|---|---|
| planned | open — no record exists |
| running | open — no record exists |
| failed, unverified, or unvalidated | open — no record exists |
| complete | satisfied, and named as covered by B |

The head must additionally be complete before absorption counts: a run has not established anything on the way to a delivery it has not made.

**Durably, in two columns**, `absorbed_step_keys` and `absorbed_step_orders`, mirroring the build chain — written from the validated spec document by the same insert, and constrained in SQL: equal lengths, non-blank keys, ascending orders, disjoint from the chain, and **never containing the head**, which is the exact inverse of the chain's constraint and the reason the two pairs are separate. A run that absorbed its own head would satisfy its own prerequisite.

**On screen it says what it is.** A covered row reads *"Covered by step 03"* and keeps its number; the tick belongs to work somebody carried out.

**For routing, merged rather than merely validated** — the same bar the delivered steps already meet, because a successor is prepared against the default branch and work that has not reached it is not there to build on.

## Consequences

**Easier.** The plan stops asking a founder to redo work the agent performed, and the next run stops re-absorbing preparation a merged run already covered — which was a real second charge rather than an untidiness.

**Preserved.** The audit trail. `completedStepOrders` still means "carried out", and a reader a year from now can separate the two.

**Harder, deliberately.** Two sets have to be kept apart in every new call site. The type name is the guard: a function taking `SatisfiedSteps` is asking what is left to do, and one taking completion evidence is asking what happened.

**Not decided here.** Whether an absorbed step should carry its own evidence of *what the run established* — a stored finding rather than a satisfied flag. That is a claim about content, not about sequencing, and it needs the agent to report something Vibe can verify (rule 77) before it can mean anything.
