# 0038 - The Economy Intelligence Layer

Status: Accepted (extends 0024)
Date: 2026-08-20

Builds on [0024](0024-vibe-credits-economic-layer.md), [0030](0030-agent-execution-observability.md), [0036](0036-risk-adaptive-validation-depth.md).

## Context

Vibe meters its own agent runs precisely. `ai_usage_events` records provider
spend to the nanodollar and reconciles against a versioned price book;
`sandbox_usage_events` records VM time; `agent_execution_runs` carries around
ninety observation columns including, since Sprint 0053, repository size and
context-candidate counts. Sprints 0049 through 0052 turned that into an analysis
module — cost derivation, a pre-execution pricing classifier, a frozen dataset of
delivered runs, rate-card simulations.

All of it looks backwards, one run at a time. Nothing could answer the two
questions a Credit system actually rests on:

- Before an agent starts: *what will this improvement probably cost?*
- After it finishes: *how wrong was that guess, and why?*

Without the first, a Credit quote is a number somebody picked. Without the
second, it stays that number forever, because nothing measures it being wrong.

Run #9 made the gap concrete. It executed a byte-identical Action Step to run #6
— same risk class, same change kind, same evidence, same pricing class — against
a repository that had since grown three files the step needed. It cost 2.16× as
much in model spend. Both runs would have received the same quote. Neither the
classifier nor the cost deriver could have anticipated the difference, because
neither looks at how the repository moved between them.

ADR 0024 §8 remains binding: there is no production rate card, and this does not
invent one. What is missing is not a price. It is the evidence a price would have
to be answerable to.

## Decision

### 1. Economy Intelligence is its own layer, not an extension of the others

A new domain, `src/modules/economy/intelligence/`. It reads Product, Repository,
Execution, Context and Validation Intelligence and adds nothing to them. Those
layers answer *what is this product*, *what must be done*, *how large is the
technical space*; economics is a different question and belongs in a different
place, so that a change to how validation depth is chosen is not also a change to
how a run is priced.

### 2. It stays a read-only island for now

No migration, no Supabase client, no write, no UI, no wiring into the execution
flow. `isolation.test.ts` — extended to recurse, since it previously stopped at
the module's top level — enforces the first three; a test asserts nothing outside
`src/modules/economy/` imports the module at all.

This is a deliberate ordering, not timidity. Wiring the estimator into
`coding-agent/service.ts` means persisting a quote, which means designing a
schema for something whose shape is still being learned. `PredictionSnapshot`
exists as a type so the Credit Settlement sprint inherits a shape to write rather
than one to invent, and is exercised by tests today so it is known to hold
everything an explanation needs.

### 3. Estimation inputs are pre-execution only, enforced by a source scan

`estimateExecutionEconomics` may see the pricing class, risk class, change kind,
evidence ids, surfaces, repository context and drift, expected validation depth,
and provider rates. It may not see tokens, runtime, sandbox milliseconds or any
usage row, and its test scans the source for those identifiers.

The reason is not fastidiousness. An estimator that *can* reach a run's own
outcome will eventually be "improved" into one — at which point the
prediction-versus-reality comparison compares a number against itself and
reports perfect accuracy forever, which is worse than having no comparison.

### 4. Repository complexity and drift are signals, never cost lines

Neither `repository-signal.ts` nor `repository-drift.ts` contains a nanodollar
amount, and a test asserts it. Repository size is not billed by anyone; its whole
cost effect is already inside the model spend, so giving it a slice of the same
total counts the money twice — the argument `cost-drivers.ts` already makes for
measured spend, applied to predicted spend.

They are two signals rather than one because they answer different questions.
Complexity is *how big is this at one commit*; volatility is *how much did it
move since the last run*. A 100,000-file repository where the step edits a README
is large and cheap. Run #6 → #9 was volatility, and a single fused "repository
score" would have made it unexplainable.

Both feed a bounded multiplier. Vibe has executed against exactly one repository,
so the true size-to-spend relationship is unmeasured, and the honest form of an
unmeasured relationship is a gentle clamped correction rather than a confident
curve.

### 5. A cost is never representable without its confidence

`EstimateConfidence` is a required field of every shape in this layer that
carries an amount. "This costs 400 Credits" and "based on 148 similar
improvements we expect about 400 Credits" are the same number and different
claims, and only the second is one Vibe can make on a project it has never
executed against. The sample size travels with the level so the second sentence
is constructible.

Confidence is the weakest of its axes, never an average. Vibe knows its provider
prices exactly and always will; letting that certainty average away "we have no
comparable run" is precisely how a confident wrong number gets made.

### 6. The protected cost is internal and stays internal

`safety-margin.ts` buffers an estimate by a fraction that shrinks as confidence
grows. It is named `protectedCostNanoUsd` rather than "safe", because it does not
make a run cost less — it is what Vibe plans against *given* its uncertainty.
`quote-simulation.ts` does not read it and a test asserts it never starts to:
charging a customer for Vibe's uncertainty is a separate decision nobody has
made.

### 7. Learning enters the estimator as a scalar, so predictions stay reproducible

`prediction-bias.ts` detects cohorts the estimator systematically misprices and
produces a correction. The estimator takes that correction as a number, never by
reading the learning dataset — which is what lets the loop close without
violating decision 3. Replaying an old estimate with its recorded correction
reproduces it exactly.

Below the policy's sample floor the correction is exactly 1, not a hedged
fraction. A cohort nothing is known about is never corrected by another cohort's
error.

### 8. Every prediction is reproducible from its own snapshot

`PredictionSnapshot` plus its named `EconomyModelVersion` recomputes its estimate
exactly, including after a JSON round trip, and a test asserts it. The matched
dataset rows travel inside the snapshot rather than being re-queried, so an
estimate made against seven runs does not silently recompute against fifty once
the dataset grows.

Weighting policies are named. Age, model-generation and repository-similarity
decay are real and unmeasurable on a dataset spanning two days, one repository
and one model, so those factors exist and are pinned at exactly 1 — "not yet
weighted by age" is visible in the data rather than absent from it.

### 9. Reconciliation proposes; it never activates

`reconcileExecutionEconomics` returns a clamped multiplier a later pricing policy
may choose to apply. It changes no rate card and writes no row, and the bounds
live in the economy model version so widening them is a version bump that leaves
the old bound visible. A loop that can raise its own cost expectation without
limit is an outage with a feedback path.

It uses the median rather than the mean, so one run that hit a provider outage
cannot drag the correction for every run after it.

### 10. A variance is explained by named evidence, or declared unexplained

`variance-explanation.ts` attributes a variance only to signals that moved in the
same direction as it, from a closed vocabulary, citing measured quantities. No
prose is generated and none is interpolated from repository or website content
(rules 25 and 36). `unexplainedShare` reports what the named reasons do not
account for, because a layer that always produces an explanation is a layer whose
explanations mean nothing.

### 11. All economic assumptions are versioned

`EconomyModelVersion` holds the margin target, repository reference scale,
validation effort assumptions, adjustment bounds and safety buffers, on the same
half-open `[effectiveFrom, effectiveTo)` intervals as `ai/pricing.ts` and
`credits/retail.ts`. Versions accumulate and never mutate. `resolveEconomyModel`
throws rather than falling back to the newest, because a silent fallback applies
assumptions that did not exist when the estimate was made.

## Consequences

**Easier.** A quote can be produced, explained and audited before any Credit
system exists. A cost surprise has a named cause instead of an apology. Provider
price changes flow through one boundary and move future predictions without
touching past ones. A rate card can be evaluated against four stress axes,
repository growth included.

**Harder.** Every number in this layer must carry its confidence and its
provenance, which is more code than a float. Adding an estimation input means
proving it exists before execution. Changing an assumption means issuing a
version rather than editing a constant.

**Foreclosed.** Pricing directly from repository size. Deriving Credits from
estimated cost — the quote prices a class, so it stays stable while the cost
moves underneath it, which is the whole reason run #6 and run #9 quote the same.
Any unbounded automatic price adjustment.

**Deliberately still open.** Whether a Credit rate card is ever activated, and at
what level — ADR 0024 §8 is untouched. Whether the protected cost informs a
maximum authorization. Whether repository drift should ever affect what a
customer pays, as opposed to what Vibe expects. When historical weighting gains a
real decay curve. Where a `PredictionSnapshot` is persisted, and under what
retention.

## What this sprint proves, and what it does not

The engine is measured, not asserted: a leave-one-out backtest over runs #3–#9
puts it at roughly 24% mean absolute error, +51% at worst, with no systematic
bias. That is not good, and the reason is visible — with no repository context
the estimator is predicting little more than a class mean, and runs #3 and #6 are
the same step 2.5× apart.

No delivered run carries repository size. The `repo_*` columns were added at
2026-08-20T20:00Z; run #9, the newest, was created at 15:07Z the same day. The
backtest therefore exercises the historical term and cannot exercise the
repository or drift terms at all.

That is a gap in the evidence rather than a defect in the engine, and the
distinction decides what to do about it: the fix is runs with repository context,
not a cleverer formula.
