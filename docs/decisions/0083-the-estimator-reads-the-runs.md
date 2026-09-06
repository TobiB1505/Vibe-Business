# 0083 - The estimator's sample is read, not transcribed

Status: Accepted
Date: 2026-09-03

Extends [0072](0072-the-evidence-behind-the-ceiling.md), which put the estimator behind the Run button and left it reasoning from a constant. Changes no price, no ceiling, no boundary and no permission.

## Context

`economy/historical-runs.ts` says what it is in its own docblock:

> Read directly from Supabase (`dcbwlctscooefwnivxzv`) on 2026-08-20 by this sprint, joining `agent_execution_runs` → `execution_specs` → `action_plan_steps` for the `status = 'succeeded'` runs, in creation order.

Read once, by a person, and typed into the repository. The file has no database access and cannot acquire any. It is the whole sample behind *"Based on N comparable runs Vibe has completed"* — so that sentence has counted against the morning of 2026-08-20 ever since, while the runs kept accumulating in a table nothing read back.

Measured at HEAD: **8 runs in the constant, 21 in the database** (13 succeeded, 8 failed), the newest from 2026-09-02. Thirteen completed runs the forecast had never seen.

The [2026-08-21 intelligence architecture review](../audits/2026-08-21-intelligence-architecture-review/README.md) named the shape of this in the abstract:

> **There is no learning loop.** … Around ninety observation columns per run, thirty-eight event types, validation results, outcome checks — none of it feeds any future decision except the unwired economy island.

The island has since been wired — [ADR 0072](0072-the-evidence-behind-the-ceiling.md) gave it a consumer — which left the other half of the sentence standing on its own: the loop is connected at one end and to a constant at the other.

## Decision

**The forecast reads the runs.** `forecastRun` takes observations the caller read back, adds Vibe's published measured runs, and reasons from both.

Five things follow, and each is a constraint rather than a detail.

**The dataset is a required input, not a default.** A default over `HISTORICAL_RUNS` is what let this stand for a fortnight without anyone deciding it should: nothing failed, nothing looked wrong, and the number simply stopped moving. A caller with nothing to add passes `[]` and says so.

**The seed stays, and is added to rather than replaced.** The transcribed runs are measured, published in `ECONOMY_MODEL.md`, and pinned by `run-economics.test.ts`; the rate card and the stress tests are built on them, and none of that may move because a customer ran an agent.

**Deduplication is by the second, not the millisecond.** The seed rows *are* this account's early runs, so a naive read counts them twice. Two of the seven transcribed timestamps turned out to be one millisecond off the rows they describe — `…17:16:38.566Z` against `…565Z` — because a person copied them. An agent run takes minutes and an account starts them serially, so a second is a safe key and a millisecond is not.

**The scope is the caller's own runs, under RLS.** Reading every account's would need the service-role client and a reviewed exception (rule 53), and would make one customer's activity an input to another's screen. Neither is worth a larger sample.

**No amount crosses back out.** Assembling the dataset carries nanodollars, so it happens inside `run-forecast.ts` — the one file `sprint-0054-safety.test.ts` sanctions to reach the estimator — and the page passes raw observations through. The first draft assembled it on the page; the guard caught it, and the fix was the design rather than the allowlist. `PERMITTED_ECONOMY_IMPORTS` is unchanged.

## What a missing measurement does

Nothing is filled in. A run with no recorded model spend is dropped rather than averaged in as cheap; a run whose plan step no longer resolves is dropped rather than classified at a default; a usage read that may have been truncated returns *no* observations rather than smaller ones. Each of those is the same rule: an unknown presented as a total is worse than no total (rule 44).

That last one has teeth. A truncated usage read makes runs look cheaper than they were, and a cheaper-looking history biases every future forecast downward with nothing to show for it.

## What this does not do

**It does not change any number a founder is charged.** The Credit figure stays the execution class ceiling. The estimate is consumed for its structure — sample size, confidence, named drivers — and never for its magnitude, exactly as ADR 0072 decided and for the reason it gave: the backtest is not good enough to quote.

**It does not close the learning loop.** It closes one arc of it. Validation failures, outcome checks and the run's own event stream still feed no decision, and `business-measurement` still has no adapter. What changes is that the estimator's sample now grows by itself.

**It reaches six runs it cannot use.** Six of this account's thirteen succeeded runs have no resolvable plan step — the plan was regenerated and the step key no longer matches. They are skipped, and that is a second defect this one only measured.

## Consequences

- The sample grows with every completed run, without anybody transcribing anything.
- Today it grows by one: six of the thirteen have no resolvable step, and six of the remaining seven are already in the seed.
- `economy/historical-runs.ts` keeps its job as published reference data and loses its job as the only answer.
