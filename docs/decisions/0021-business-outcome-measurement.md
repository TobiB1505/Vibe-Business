# ADR 0021 — Business outcome measurement

**Status:** Accepted
**Date:** 2026-08-15
**Sprint:** [12B — Business Outcome Measurement Foundation](../sprints/0012b-business-outcome-measurement.md)

## Context

Sprint 12A closed the second of three questions:

```
DELIVERY          did the approved change reach the repository?   Sprint 11C
PRODUCT OUTCOME   did the intended behaviour appear publicly?     Sprint 12A
BUSINESS OUTCOME  did the metric it was meant to move, move?      ← open
```

The first two are answerable by observation: a branch points at a commit, a file is reachable, a sitemap lists a page. Both are things Vibe can look at directly, in seconds, with no dependency on anybody else.

The third is not. It needs somebody else's data about their own business, a defined baseline, a defined window, enough traffic for the comparison to mean anything, and — for the question people actually want answered — a controlled experiment this product does not run.

That gap is where an honest measurement product and a fortune teller diverge, and the divergence is entirely in what each is willing to say when the evidence is thin. It is thin almost always: **Vibe Business has no analytics connector at all.** The codebase was searched before this module was written, and the only mention of analytics anywhere is the Business Audit correctly recording that no such data is available to it.

## Decision

### 1. Business outcome requires metric evidence

Never inferred from a merge, a passing build, a reachable `robots.txt`, a nicer-looking page, or a model's opinion that the change was a good idea.

### 2. No evidence is not negative impact

The absence of measurement is not a measurement. Four states exist that are **not results** and none may render as one:

```
unavailable / not_planned   nothing merged, or nobody has planned yet
source_required             no analytics connected  ← every project, today
scheduled                   the post-change window has not elapsed
measuring                   collecting
```

`insufficient_data` is a fifth honest non-result: there *was* data and there was not enough of it, and the UI says what was needed alongside what was seen.

`metric_source_required` is the one that matters most, because it is the state of every project in the product. Rendering it as "No impact" would blame a change for a gap in Vibe's own setup.

### 3. Observed change is not caused change

If conversion moves 4.1% → 4.5% after a merge, the honest sentence is *"conversion increased during the post-change measurement window"*. The sentence *"this change caused a 9.8% increase"* requires a control group, and there isn't one.

Everything in the domain is named `observed…` for that reason. `causality.ts` holds a phrase list — including the softer causal forms like "drove", "led to" and "thanks to" — and the tests assert the UI copy and domain vocabulary against it, so a mutation replacing one verb fails the build.

The checker is **negation-aware**: the disclaimer that keeps the product honest necessarily contains the word "caused", and a naive substring match would flag the very sentence it exists to enforce.

### 4. Explicit, immutable baseline and post windows

Whole calendar days, an explicit IANA timezone on every window, the **merge day excluded from both sides**, a capability-specific settling gap, and a half-open interval so non-overlap is checkable by comparison rather than by an off-by-one argument.

```
… baselineDays complete days …  │ merge day │ … settlingDays …  │ … measurementDays …
◀────────── baseline ─────────▶ │ excluded  │     excluded      │ ◀── measurement ──▶
```

Windows are computed once, written to the row, and read back. A baseline re-derived at comparison time would change a historical result as the calendar advances — the single most misleading thing this schema could do. The database enforces non-overlap and ordering; the windows are part of the measurement's identity.

The timezone fallback is UTC, documented and deliberate. A Vercel function's locale is a deployment detail and must never decide what a customer's week was.

### 5. Minimum data requirements, per metric and per window

Held on the metric rather than in the classifier, because "enough" is a property of the metric: 800 impressions is a thin week and 800 paid conversions is an enormous one.

Checked on **both** windows independently. A strong baseline against an almost-empty post-window is exactly as meaningless as the reverse, and a combined total would let one side carry the other. Data quality is assessed the same way — per window, taken at its worst.

Below the bar is `insufficient_data`, with no movement reported at all. A 40% "improvement" from eleven visitors is not a small result; it is not a result.

### 6. Metric direction, and a versioned policy

Not every metric should go up. `higher_is_better` and `lower_is_better` are implemented; `target_range` is declared and deliberately **refused** by the classifier with a typed reason, so a future metric declaring it cannot be silently treated as higher-is-better.

`measurement-policy-v1` versions the rules — baseline construction, post-window construction, minimum samples, timezone handling, aggregation, comparison, and the neutral band. It is part of the measurement's identity, so historical rows are never silently recalculated under new rules.

A neutral band exists because a metric that drifts a fraction of a percent week to week would otherwise report a result every single time.

### 7. Vendor-neutral metric source abstraction

`BusinessMetricSource` asks for *a metric, over a window* and receives **daily values**. The engine cannot learn a vendor's vocabulary, and it cannot be handed a pre-aggregated total — the aggregation is the policy's decision, and two adapters would eventually decide it differently. Daily granularity is also the only thing that makes `dataQuality` answerable: you cannot tell that three days are missing from a single total.

Failures are typed, not thrown: `unauthorized`, `unavailable`, `rate_limited`, `metric_unsupported`. Those are four different sentences and four different next steps, and an exception flattens them into one.

**No connector is built in this sprint.** The registry returns nothing for every project, and the product says `metric_source_required` rather than inventing one to make a dogfood look green.

### 8. Measurement contracts belong to execution capabilities

The same argument as Sprint 12A's outcome contract, one question further along: the code that knows what it changed is the only code entitled to say what business metric that change was supposed to move.

A plan is a pure function of `(capability, structured business context)`. **No free-form model output**, and the opportunity's prose is deliberately not read — model wording is not a machine API. A capability with no honest metric produces a plan whose status is `unsupported`, which is a complete answer.

### 9. Negative outcomes stay visible, and rewrite nothing

`degraded` is rendered exactly as fully as `improved` — same branch, same values, signed percentage, its own tone. A product that only reported its wins would be worth less than no measurement at all.

And a bad business result does not unmake an approval, a merge or a verified production outcome. Those were true when recorded and stay true; all four coexist. The measurement module never references the delivery tables at all, which is asserted structurally.

### 10. No automatic rollback, and no AI

A degraded result triggers nothing: no revert, no re-merge, no redeploy, no re-validation, no audit, no opportunity generation. The consequential response belongs to a human and to a later sprint.

No model is called anywhere in this domain. Measurement truth is arithmetic over somebody else's data, and inference would add nothing but a way to be confidently wrong.

### 11. Scheduling is data, not a running process

The waiting is expressed as `next_observation_at` on the row: a measurement is *due* when that instant has passed, and a durable operation performs exactly one attempt of an already-due measurement.

**This is the deliberate opposite of Sprint 12A's design**, and the reason is the timescale. That observation slept between attempts because its whole window was fifteen minutes. This one compares windows measured in weeks, and a workflow sleeping for six weeks would hold a durable slot, across deploys, for a period during which the answer cannot change.

**The honest limitation:** no scheduled runner exists in this architecture, so nothing currently notices that a measurement has become due. The preview lifecycle set the precedent — expiry converges lazily on read, with no cron, no scheduler and no sweeper, because none exists. Adding one is new infrastructure ahead of the decision that authorises it (CLAUDE.md rules 3 and 24).

`next_observation_at` and its partial index are designed so that a future runner is a **consumer** of this schema rather than a redesign of it.

### 12. Authoritative results are not client-writable

Neither table has an update policy or a delete policy. A user may request a plan and a measurement; the baseline, the observed value, the relative change, the classification, the sample sizes and the timestamps can only be written by the service-role client durable execution holds.

The database also refuses a stated result that has no numbers behind it: `improved`, `degraded` and `neutral` require a baseline, an observed value, both sample sizes, a data quality and non-empty provenance.

### 13. Provenance without credentials

Enough to answer *"where did this number come from?"* two months later — source kind, adapter, metric, window, days returned, retrieved-at — and deliberately nothing more. No OAuth token, no refresh token, no API key, no vendor account identifier, no raw payload, and never the daily series itself. An analytics response routinely carries per-user data that has no business in this schema.

## Consequences

**Good**

- The product can state a business result without overstating it, and can decline to state one without implying a failure.
- The distinction between "we have no data", "not enough data", "no meaningful change" and "it got worse" is a data structure rather than a convention.
- A connector, when it exists, registers behind one interface and changes no other layer.

**Costs and limits**

- **No connector, so no real measurement is possible today.** Everything downstream of the source boundary is exercised only by test doubles.
- **No scheduled runner**, so nothing currently notices a due measurement. Named as the missing piece rather than papered over.
- **One capability has a measurement profile.** Everything else is `unsupported`.
- **No re-measurement.** A terminal result is immutable; a deliberate re-measure is a future capability.
- **A `neutral` result cannot distinguish "nothing happened" from "two effects cancelled out."** No product with one metric and no control can.
- **Attribution is entirely absent.** Even a large observed movement says nothing about which of several merges in a window produced it.

## Alternatives considered

**Ask a model to interpret the numbers.** Rejected. The interpretation is the part most likely to overstate, and a model has no access to the control group that would justify it. §29 defers the recommendation layer deliberately: build truthful metrics first.

**Build a Search Console connector now.** Rejected, and explicitly forbidden by §49. It is a new OAuth surface, a new credential store and a new ADR, and building it inside this sprint would have meant shipping the measurement domain untested against its own honesty requirement — the source-required state *is* the deliverable this sprint can verify.

**Sleep in the workflow until the window closes.** Rejected — see §11 above.

**Auto-create the plan when a merge completes.** Rejected. A plan is a durable record with an audit event, and creating one as a side effect of a merge or a page render would make a read a write. One explicit click, once.

**Compare "the week before" against "since the merge".** Rejected. It is the partial-period bias in its purest form: it reports a catastrophic collapse in every metric, every time, as an artefact of the clock.

## References

- [ADR 0013 — Durable operation execution](0013-durable-operation-execution.md)
- [ADR 0019 — Safe approved change merge](0019-safe-approved-change-merge.md)
- [ADR 0020 — Production outcome verification](0020-production-outcome-verification.md)
