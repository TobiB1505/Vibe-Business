# ADR 0037 — Automatic Validation Hand-off, and Review Classification

- **Status:** Accepted
- **Date:** 2026-08-20
- **Establishes:** one durable operation may enqueue the next
- **Does not alter:** the visual-review domain's rule that no capture is automatic
- **Sprint:** [0048](../sprints/0048-automatic-validation-and-review-classification.md)

## Context

Two separate things stopped at the same place.

**A finished agent run went nowhere.** `agentExecutionWorkflow` ended by
recording `execution_completed` / "Ready for review". The prepared change then
sat waiting for a human to click "Validate change" — a click that is the same
click every time, on a change the user already asked for and paid to produce.

**The only review that exists is visual.** `src/modules/review/` has exactly one
profile, `public_visual_review_v1`: a before/after screenshot comparison. It is
good at that and has no way to ask whether it is the right instrument.
Photograph a backend-only change and you get two identical pictures of a page
that did not change — a confident, useless result that looks like a review.

## Decision

### 1. A durable operation may enqueue the next one

`agentExecutionWorkflow` gains a final step, `enqueueValidation`, which calls
**`startChangeValidation`** — the same function the button calls.

This is the first time one operation starts another, which is why it is written
down. The alternative shapes were considered and rejected:

- *A database trigger.* Puts control flow somewhere no test can see it.
- *A new "run and validate" orchestration.* Two entry points to validation, able
  to drift, which is the failure this codebase keeps paying for.
- *Calling the workflow directly.* Skips every guard in the entry point.

The constraint that makes it safe is that **the step resolves three identifiers
and calls the existing function**. Ownership, prepared-change readiness,
snapshot presence, profile support, depth resolution, identity reuse, in-flight
detection and the unique index all come along unchanged, because none of them
were reimplemented.

Idempotency is not added either. A second call finds a reusable passed run or an
active operation with the same input identity and returns without provisioning.
The existing guards *are* the idempotency, which is the only kind worth relying
on.

The step runs **after** the run is recorded as succeeded, and its own outcome
cannot change the workflow's. Validation failing to start leaves precisely the
state that existed before this ADR: a change waiting for a click.

### What this does not extend to

**No review is auto-started.** `src/modules/review/service.ts` states that
nothing there is automatic because a browser session costs money by the second,
and that rule is untouched. This ADR authorizes one hand-off — execution to
validation — not a general "each stage starts the next".

### 2. Review classification, deterministic and advisory

`ReviewClassification` — `visual` | `code` | `visual_and_code` — computed from
three Vibe-owned inputs: the changed paths Vibe verified, the analyzer's
resolved execution surface, and the evidence-derived
`ExecutionSurfaceRequirement`. No model call, no commit message, no agent
output, for the same reason the risk classifier and depth resolver hold that
line: the thing being reviewed must not choose how it is reviewed.

A path is visual when the analyzer's own route table says a route is served from
it, or when it is a file whose contents can only reach rendered output. The
route table is consulted first because "does this file put pixels on a page" is
a question the analyzer has already answered for this specific repository at
this pinned commit — reading that answer is not a filename heuristic.

`code` is the fallback in both directions, including for a change with no paths
at all. The asymmetry is deliberate: a code diff can be reviewed for any change,
while a visual comparison of a page that did not change produces two identical
images and the false impression that something was looked at.

### It is not persisted

Every input is already stored, it gates nothing, and it has no reuse semantics —
unlike `validation_depth`, which decides what actually runs and must never be
reinterpreted later. Recomputing on read keeps one source of truth. **No
migration.**

## Consequences

**Easier.** The pipeline runs one stage further without a click. A later review
flow has a trustworthy answer to "which review?" before it is built.

**Harder.** Every agent run now provisions a validation sandbox automatically.
That is Vibe's infrastructure cost, not the customer's credits — validation has
no reservation and no settlement, only `sandbox_usage_events` — but it is real,
roughly five minutes of microVM per run, and it will show up there. It is
recorded as a judgement rather than a mechanism because that is what it is: the
position taken is that validating the result of an execution the user already
started is part of delivering it, not a new spending decision.

**Foreclosed.** Nothing. The manual "Validate change" button is unchanged and
remains the recovery path whenever the automatic hand-off does not fire —
which is why its outcome is recorded as `agent_execution.validation_enqueued`
for every result including failure. A silent miss would otherwise look exactly
like a user who has not clicked yet.
