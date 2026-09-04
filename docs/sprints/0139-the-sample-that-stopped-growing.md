# 0139 — The sample that stopped growing

Date: 2026-09-03
Branch: `claude/agent-preview-diff-logic-sxj5uc`
Decision: [ADR 0083](../decisions/0083-the-estimator-reads-the-runs.md), extending [0072](../decisions/0072-the-evidence-behind-the-ceiling.md)

## What this was for

The founder remembered an architecture audit saying the agent writes a great deal of data into nothing and therefore does not learn, and asked whether that was still true. It was, and checking it turned out to be more specific than the audit had been.

The [2026-08-21 intelligence architecture review](../audits/2026-08-21-intelligence-architecture-review/README.md) said:

> **There is no learning loop.** … Around ninety observation columns per run, thirty-eight event types, validation results, outcome checks — none of it feeds any future decision except the unwired economy island.
>
> **History is stored completely and never read.**

Two of its claims have since been closed — outcome verification does see agentic changes ([ADR 0071](../decisions/0071-agentic-outcome-verification.md)), and contradictions do reach the model ([ADR 0044](../decisions/0044-evidence-pack-v4.md)) — and the "unwired island" was wired by [ADR 0072](../decisions/0072-the-evidence-behind-the-ceiling.md), which put the estimator behind the Run button.

**What reading the code found is that it was wired to a constant.** `economy/historical-runs.ts` says so itself: *"Read directly from Supabase on 2026-08-20 by this sprint"* — read once, by a person, typed into the repository, no database access. It is the whole sample behind *"Based on N comparable runs Vibe has completed"*, so that sentence had counted against one morning ever since.

| | |
|---|---|
| Runs in the constant | **8** |
| Runs in the database | **21** — 13 succeeded, 8 failed, newest 2026-09-02 |

## Shipped

`forecastRun` takes the completed runs the caller read back, adds the published seed, and reasons from both. The dataset is a **required** input: a default over the constant is what let this stand for a fortnight without anyone deciding it should — nothing failed, nothing looked wrong, and the number simply stopped moving.

Five reads, none of them per run, inside the window the Agent screen already opens. Bounded by `.in()` over one id list rather than walked, because this renders on every visit.

## Four things the work found that were not the work

**Two transcribed timestamps are a millisecond off the rows they describe.** `…17:16:38.566Z` against `…565Z`, `…18:45:03.611Z` against `…610Z` — a person copied them. Deduplicating on the exact instant would have silently double-counted those two and reported a larger sample than exists, under a button that spends money. Found by running the query against production, not by reasoning. The key is the second; an agent run takes minutes and an account starts them serially.

**Six of thirteen succeeded runs have no resolvable plan step.** The plan was regenerated and the step key no longer matches anything, so `changeKind` and `evidenceIds` are simply gone. They are skipped — similarity is computed from those fields, and inventing any of them would put a made-up neighbour in the sample. That is a second defect this one only measured.

**The first draft put nanodollars on a page.** `sprint-0054-safety.test.ts` failed immediately: assembling the dataset carries cost figures, and the page was assembling it. The fix was the design rather than the allowlist — assembly moved inside `run-forecast.ts`, the one file that suite sanctions to reach the estimator, and the page passes raw observations through. `PERMITTED_ECONOMY_IMPORTS` is unchanged.

**`read-bounds.test.ts` caught two unbounded reads**, and the honest fix was a limit rather than a review entry: `.in()` bounds how many ids are asked about and says nothing about rows per id. Reaching a limit now returns *no* observations rather than smaller ones, because a truncated usage read makes runs look cheaper than they were and would bias every future forecast downward with nothing to show for it.

## Verified by breaking it

| planted | caught by |
| --- | --- |
| deduplication removed | "does not count a seeded run twice" |
| a millisecond-exact key | "still matches a seeded run whose timestamp was transcribed a millisecond off" |
| the seed replaced instead of extended | three dataset cases |
| a missing model spend averaged in as zero | "drops a run whose model spend was never recorded" |
| usage fetched for the first run only | "does not grow its read count with the number of runs" |
| the validation sandbox left out of the read | two store cases |
| a missing plan step filled with a default | "leaves out a run whose plan step no longer resolves" |

One of those was not a plant. **Two identical observations were counted twice** — the deduplication compared against the seed and not against the observations themselves — and the forecast's own "counts one run once" test found it on its first run.

## What this does not do

**It does not close the learning loop; it closes one arc of it.** Validation failures, outcome checks and the run's own event stream still feed no decision, `business-measurement` still has no adapter, and no diff reader exists across the four snapshot tables. The audit's sentence is now narrower, not gone.

**It changes no number a founder is charged.** The Credit figure stays the execution class ceiling. The estimate is consumed for its structure and never for its magnitude, exactly as ADR 0072 decided.

**Today the sample grows by one.** Six of the thirteen succeeded runs have no resolvable step, and six of the remaining seven are already in the seed. The point is not this week's number — it is that next week's arrives without anybody transcribing it.

## Verified

Domain 7,745 across 448 files · typecheck · lint 0/0. No migration, no version bump, no new authority, no widened allowlist.
