# Sprint 0054 — Economy Intelligence Engine v1

**Status:** implemented. Lint (0 errors) / typecheck / **5,751 unit tests across 325 files** / build green.
No migration, no persistence, no UI, no paid call, no billing change.
`CREDIT_RATE_CARDS` is still `[]`.

## Problem

Vibe meters its own runs precisely and every one of those measurements looks
backwards. Nothing in the repository could answer *what will this improvement
probably cost?* before an agent starts, or *how wrong was that guess, and why?*
after it finishes.

Run #9 made the gap concrete: a byte-identical Action Step to run #6, same risk
class, change kind, evidence and pricing class, against a repository that had
grown three files the step needed — 2.16× the model spend. Both would have been
quoted the same. Nothing in the codebase could have anticipated the difference,
because nothing looked at how the repository moved between them.

The missing piece is not a price. It is the evidence a price would have to be
answerable to.

## What was built

A new domain, `src/modules/economy/intelligence/`, that reads Product,
Repository, Execution, Context and Validation Intelligence and adds nothing to
them. Sixteen source files, all pure functions. See
[ADR 0038](../decisions/0038-economy-intelligence-layer.md) for the decisions and
[ECONOMY_MODEL.md](../business/ECONOMY_MODEL.md#economy-intelligence-sprint-0054)
for the measured results.

- **Versioned assumptions** (`model-version.ts`) — margin target, repository
  reference scale, validation effort, adjustment bounds, safety buffers, on the
  same half-open intervals as `ai/pricing.ts`. Append-only.
- **Provider-agnostic rates** (`provider-rates.ts`) — states no price, delegates
  to `ai/pricing.ts`, accepts a supplied rate for any other provider.
- **Signals** — repository complexity, repository drift, context pressure. None
  contains a nanodollar amount.
- **The estimator** (`pre-execution-estimate.ts`) — sees only pre-execution
  inputs, enforced by a source scan.
- **Confidence** (`confidence.ts`) — weakest link, required field, carries its
  sample size.
- **Protected cost** (`safety-margin.ts`) — internal, buffered by confidence,
  never customer-facing.
- **Prediction snapshot** (`prediction-snapshot.ts`) — replays to its own
  estimate exactly, matched dataset rows included.
- **Actual economics and reconciliation** — four components, one of which may be
  `measured`; comparability answered explicitly; a clamped adjustment proposal.
- **Learning** (`learning-dataset.ts`, `prediction-bias.ts`) — leave-one-out
  backtest, cohort bias detection with a hard sample floor.
- **Explanation** (`variance-explanation.ts`) — named reasons from measured
  signals, or an explicit unexplained share.
- **Simulation** (`growth-simulation.ts`) — the fourth stress axis the earlier
  model could not express.

## What the sprint found

**The estimator is off by about a quarter.** Leave-one-out over runs #3–#9:
24.3% mean absolute error, +51.3% at worst, no systematic bias. Runs #3 and #6
are the same step 2.5× apart.

**And the reason is the dataset, not the engine.** No delivered run carries
repository size — the `repo_*` columns landed at 2026-08-20T20:00Z and the newest
run was created at 15:07Z the same day. The backtest exercises the historical
term and cannot exercise the repository or drift terms at all.

**Compounded stress breaks the simulated margin.** Model C holds above the 75%
target on every single axis and lands at 59.0% with provider +50%, infrastructure
+50%, failure rate 40% and repository 5× together. That figure exists only
because growth is now an axis.

**Nothing yet clears the learning floor.** Every cohort in the dataset is below
20 comparable observations, so every correction is exactly 1.

## Two defects the tests caught

- The economy module's isolation guard read only the top level of
  `src/modules/economy`. A new subdirectory would have been silently unguarded
  while the suite stayed green. Fixed first, before anything was added to guard.
- A draft assumed `fast` validation skipped the build and that `deep` ran more
  steps than `standard`. Neither is true — `fast` skips only `test`, and `deep`
  currently runs the same four steps. The pinning test caught both.

## What has not been proved

- The engine has never estimated a live run. It is not wired into
  `coding-agent/service.ts`, and a test asserts nothing outside
  `src/modules/economy/` imports it.
- The repository and drift terms are untested against reality, because no
  delivered run has the data.
- The `complex` pricing class still has zero observations.
- All runs remain `non_production_economics`.
- Past roughly 5× growth the repository policy ceiling bounds the simulation
  rather than the evidence.

## Gate

Nothing activated. `CREDIT_RATE_CARDS` is `[]`, `resolveRateCard` returns null at
every instant, and no Stripe, wallet, balance, top-up, reservation or settlement
code changed. `sprint-0054-safety.test.ts` is that sentence in executable form.

**Verdict: NOT READY for credit settlement.** The engine is ready; the evidence
is not. What closes the gap is named and countable — repository context on
roughly twenty runs, at least one observed `complex` run, and one production
(non-dogfood) execution.
