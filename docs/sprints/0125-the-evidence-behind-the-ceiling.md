# The evidence behind the ceiling

**Recorded 2026-09-02, after the work.** Etappe 4 of the plan built from the
codebase-fitness audit, and the only stage that waited on a product decision
rather than on code. The question put to the founder was *keep the predictive
economy layer with a consumer, or delete it*. The answer was keep it.

## The audit's number was wrong, and measuring changed the question

The audit called `economy/intelligence/` 2,894 production lines with no caller.
Two of those three facts held:

| | |
| --- | --- |
| production lines | 2,894 |
| already used by `pnpm agent:calibrate` | **1,096** |
| genuinely unreached | 1,798 |

`coding-agent/dogfood/calibration-report.ts` is production code, not a test, and
it imports seven of the seventeen files. So the choice was never "5,500 lines
in or out" — it was about 1,798 lines, and about which of them have an honest
home.

## What was almost built

The obvious consumer is the cost disclosure above **Run with Vibe**: replace the
fixed execution-class ceiling with a predicted number. It is what the plan
sketched, and it is not what shipped. Two things ruled it out, and the first was
already written in the layer's own code before this sprint started.

`quote-simulation.ts`, on why its Credit figure comes from the class and not the
estimated cost:

> `credits = cost * factor` would make a quote for the same work move every time
> the repository grew — which is exactly what run #6 → #9 did, at 2.16x, for an
> identical step.

And then the measurement, which is the part that settles it. Leave-one-out
backtest over the runs Vibe has actually paid for:

| | |
| --- | --- |
| comparable runs | 7 |
| mean absolute relative error | **24.3%** |
| worst case | +51.3% |
| direction | 3 under, 4 over — no systematic bias |
| runs with repository context | **0** |

The last row decides it. The repository term is one of the estimator's main
multipliers and has never been validated against an outcome, because the brief's
`repositoryScale` is not computed until a run starts. A dollar figure on a
founder's screen with that behind it is a precision claim Vibe cannot make, and
rule 78 is about exactly this.

## What shipped

The ceiling stays the number. Beneath it goes what the ceiling never said.

```
Estimated Credit use            Up to 100 Credits
· Based on 7 comparable runs Vibe has completed.
· Your repository is larger than the one this ceiling was measured against.
```

Or, when there is nothing behind it: *"No comparable run has been completed yet,
so this is Vibe's policy ceiling rather than a measured one."* Those two
sentences are the point — the same "Up to 100 Credits" reads identically whether
Vibe has done this seven times or never.

**No amount crosses the boundary.** `RunForecast` has four fields —
`comparableRuns`, `confidence`, `repositoryMeasured`, `drivers` — and a driver
is two closed enums. The estimator's own `detail` strings stop inside the
boundary file, because *"complexity 1.34x against the reference repository"* is
a calibration report's sentence and not a founder's. The copy is an exhaustive
record keyed on the enum, so a new driver without copy is a type error rather
than a blank line under a price.

One driver deliberately has no copy for its most common value: validation depth
resolves from a Prepared Change, which does not exist before a run, and *"Vibe
does not know yet"* beside a Run button reads as a warning when it is not one.

## The guard this ran into, and why it was not simply widened

`sprint-0054-safety.test.ts` failed on the first wiring, exactly as built to:

> The narrower rule the allowlist above must not be allowed to erode: a caller
> may ask what class a change is, and may not ask what it will cost. **A quote
> reaching the execution path is a quote that will eventually authorize
> something.**

That reason survives this sprint, so the guard was not deleted for one import.
Two things changed instead.

**The boundary type stopped being able to carry money.** The first draft
re-exported `EstimateCostDriver`, which meant the estimator's figures were one
`.detail` away from a screen and `view.ts` had to import from `economy/` to
render them. Projecting to two enums removed the second reader entirely — one
file now touches the estimator, not two.

**The permission became conditional, and the condition is checked.** Two new
tests, both verified to fail before they passed:

- `run-forecast.ts` may contain no `nanoUsd`, `estimatedCost`, `Credit`, `usd`,
  `price`, `quote` or `safety-margin`, checked by reading its source with
  comments stripped — the file's own docblock explains at length why it produces
  no cost, and matching that prose would fail it for saying so.
- `RunForecast` must export exactly the four reviewed fields, pinned by reading
  the type, so growing one is a deliberate edit with a reason beside it.

`quote-simulation.ts` and `safety-margin.ts` stay unreadable by anybody.

## One thing the estimator gained

The pre-run screen is the first caller that can hand it a repository — the
backtest had none for any run. The snapshot is projected through the compiler's
own derivation rather than a second one, so the forecast and the run's brief
cannot disagree about the tree. `candidatesAvailable` stays 0 because the
Context Compiler has not run, and `deriveRepositoryComplexity` drops a
non-positive axis, so that is an absent measurement rather than a repository
that offered nothing.

## Three files left unwired, on purpose

Naming them is the honest end of "wire a consumer", and each has a reason rather
than an omission:

- **`safety-margin.ts`** — `quote-simulation.ts` already ruled it out: the
  buffer exists because Vibe is unsure, and charging a customer for Vibe's
  uncertainty is a separate decision nobody has made.
- **`growth-simulation.ts`** — a rate-card planning tool. Its home is
  `docs/business/`, not a product surface.
- **`variance-explanation.ts`** — it explains why an actual differed from an
  estimate, and there is no post-run economics surface to explain it on.

Manufacturing consumers for these would be the same failure as writing thirteen
module READMEs to turn a suite green, one sprint earlier.

## Verification

7,370 unit tests, 464 browser tests, typecheck, lint and build clean. The
browser test is the one that matters here (rule 69): the E2E fixture renders the
**real** forecast against the real run history rather than hand-written strings,
and asserts on screen that no `$` and no second Credit figure appears beside the
ceiling. A hand-written fixture would have stayed green after the product
stopped saying it.

No migration, no schema change, no price changed, no rate card activated.
