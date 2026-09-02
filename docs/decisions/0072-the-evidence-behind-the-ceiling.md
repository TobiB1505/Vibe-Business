# 0072 - The evidence behind the ceiling: the estimator informs, it does not price

Status: Accepted
Date: 2026-09-02

Amends [ADR 0038](0038-economy-intelligence-layer.md)'s "unwired island", and
narrows the guard `sprint-0054-safety.test.ts` holds. Changes no price and
activates no rate card.

## Context

`src/modules/economy/intelligence/` is 2,894 production lines and 2,621 test
lines. Sprint 0054 built it deliberately without a consumer — its own record
says "No migration, no persistence, no UI, no paid call, no billing change" —
and it has had none since. A codebase-fitness audit named it as dead weight and
the choice was put as *keep it with a consumer, or delete it*.

Measured before deciding, because the audit's figure was wrong: **1,096 of those
lines are already used**, by the calibration report behind `pnpm agent:calibrate`.
The genuinely unreached part is 1,798 lines.

The decision taken was to wire a consumer.

## What was almost built, and why it is not what shipped

The obvious consumer is the cost disclosure above **Run with Vibe**: replace the
fixed execution-class ceiling with a predicted number. Two things rule it out,
and the first was already written down in the layer's own code before this ADR
existed.

**A cost-derived Credit figure is unstable in the wrong direction.**
`quote-simulation.ts` says it plainly:

> `credits = cost * factor` would make a quote for the same work move every time
> the repository grew — which is exactly what run #6 → #9 did, at 2.16x, for an
> identical step.

The execution-class model exists to hold a quote still while the cost moves
underneath it. A predicted price would undo that on purpose.

**And the estimator is not accurate enough to quote.** Leave-one-out backtest
over the runs Vibe has actually paid for:

| | |
| --- | --- |
| comparable runs | 7 |
| mean absolute relative error | **24.3%** |
| worst case | +51.3% |
| direction | 3 under, 4 over — no systematic bias |
| runs with repository context | **0** |

The last row is the one that decides it. The repository term is one of the
estimator's main multipliers and it has never been validated against a real
outcome, because the brief's own `repositoryScale` is not computed until a run
starts. A dollar figure on a founder's screen with that behind it is a precision
claim Vibe cannot make, and [rule 78](../../CLAUDE.md) exists for exactly this.

## Decision

**The estimator is consumed for its structure and never for its magnitude.**

The Credit figure a founder sees stays the execution-class ceiling. What is
added beneath it is what the ceiling never said: how much evidence stands behind
it, and what about *this* run pushes toward the top of it.

```
Estimated Credit use            Up to 100 Credits     ← unchanged, class ceiling
· Based on 7 comparable runs Vibe has completed.      ← or: this is a policy
                                                        ceiling, not a measured one
· Your repository is larger than the one this
  ceiling was measured against.
```

Three properties make this safe rather than merely careful:

1. **No amount crosses the boundary.** `RunForecast` has four fields —
   `comparableRuns`, `confidence`, `repositoryMeasured`, `drivers` — and none is
   money. A driver is two closed enums; the estimator's own `detail` strings
   ("complexity 1.34x against the reference repository") stop inside the
   boundary file, because they are a calibration report's sentences and not a
   founder's.
2. **The copy is keyed on the enum, not the string.** `FORECAST_DRIVER_COPY` is
   an exhaustive record, so a new driver without copy is a type error rather
   than a blank line under a price.
3. **It runs on a page render, never on the start action.** Read-only, offline,
   pure over the static run history plus the snapshot the route resolver already
   read. Opening the Agent screen still spends nothing.

### The guard is narrowed, not removed

`sprint-0054-safety.test.ts` asserted that the predictive estimator reaches no
file outside `economy/`, with the reason: *a quote reaching the execution path
is a quote that will eventually authorize something.* That reason survives, so
the guard is not deleted for one import. It gains a named boundary file and two
tests that are the price of the permission:

- **`run-forecast.ts` may contain no amount**, checked by reading its source for
  `nanoUsd`, `estimatedCost`, `Credit`, `usd`, `price`, `quote` and
  `safety-margin`.
- **`RunForecast` exports exactly the four reviewed fields**, pinned by reading
  the type, so growing one is a deliberate edit to the test with a reason beside
  it.

Both were verified to fail before they passed. `quote-simulation.ts` and
`safety-margin.ts` stay unreadable by anybody: the first produces a Credit
figure from a hypothetical rate card, and the second buffers a number for Vibe's
own planning — *"charging a customer for Vibe's uncertainty is a separate
decision that nobody has made"*, in its own words.

### One thing the estimator gains

The pre-run screen is the first caller that can hand it a repository. The
backtest had none for any run. The snapshot is projected through the compiler's
own derivation rather than a second one, so the forecast and the run's brief
cannot disagree about the tree. `candidatesAvailable` stays 0 because the
Context Compiler has not run, and `deriveRepositoryComplexity` drops a
non-positive axis from its average — so that is an absent measurement, not a
repository that offered nothing.

## Consequences

- Roughly 1,000 of the 1,798 unreached lines now have a consumer a founder sees.
- **Three files still have none, and are not given one**: `safety-margin.ts`
  (deliberately excluded above), `growth-simulation.ts` (a rate-card planning
  tool whose home is `docs/business/`, not the product), and
  `variance-explanation.ts` (it explains why an actual differed from an
  estimate, which needs a post-run economics surface that does not exist).
  Manufacturing consumers for them would be the failure this ADR's own reasoning
  argues against.
- The accuracy figures above are a measurement of a moment. They will move as
  runs accumulate, and `learning-dataset.ts` recomputes them — but nothing reads
  them at runtime, and no number shown to a founder depends on them.
- Activating a customer-facing Agent price still requires a measured cost
  (rule 78). Nothing here is that measurement and nothing here is a price.

## What would change this decision

A predicted figure becomes defensible when the backtest has enough runs and a
validated repository term to make its error bound smaller than the class bands
it would sit inside. That is a measurement, not an opinion, and it belongs in a
later ADR with the numbers in it.
