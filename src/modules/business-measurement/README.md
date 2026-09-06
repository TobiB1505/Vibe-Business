# modules/business-measurement

Did the metric the change was meant to move, move? — see [ARCHITECTURE.md §3 "Layers with no section above"](../../../ARCHITECTURE.md#layers-with-no-section-above) and [ADR 0021](../../../docs/decisions/0021-business-outcome-measurement.md).

```
DELIVERY          did the approved change reach the repository?   modules/merge
PRODUCT OUTCOME   did the intended behaviour appear publicly?     modules/outcome-verification
BUSINESS OUTCOME  did the metric it was meant to move, move?      ← here
```

The first two are answerable by observation: a branch points at a commit, a file is reachable. This one is not. It needs somebody else's data, a defined baseline, a defined window, enough traffic for the comparison to mean anything, and — for the question people actually want answered — a controlled experiment this product does not run.

**So the whole module is built around what it is not allowed to say.**

## Business impact is never inferred

Not from a merge, not from a passing build, not from a reachable `robots.txt`, not from a nicer-looking page, and not from a model's opinion that the change was a good idea. Business outcome requires metric evidence.

No evidence is `insufficient_data` — never `neutral`, and never `improved`. **The absence of measurement is not a measurement** (rule 44).

## Observed change is not caused change

If conversion moves 4.1% → 4.5% after a merge, the honest sentence is _"conversion increased during the post-change measurement window"_. The sentence _"this change caused a 9.8% increase"_ requires a control group, and there isn't one.

Everything in this domain is named `observed…` for that reason, and `causality.ts` exists to keep it that way: it holds the causal and observational phrase sets, finds causal claims in generated copy, and decides when the observed-change disclaimer is required. That is a check in code, not a note in a style guide.

## Windows are calendar days in a timezone, not elapsed milliseconds

`windows.ts` plans a baseline window and a post-change window as whole days in a declared timezone, and `windowHasClosed` decides when a comparison may be made at all. A window that has not closed is not a small result — it is no result. Measuring across two elapsed windows with a sleep between them is also why this is a durable operation rather than a request.

## Somebody else's data, behind an interface

`source.ts` defines `BusinessMetricSource` and a registry that resolves one per metric. `NoConnectedMetricSources` is a real, expected state rather than an error: a project with no analytics connected cannot be measured, and saying so is the correct answer.

## What lives here

| File                | Purpose                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `schema.ts`         | The domain: metric keys, categories, directions, plan and measurement statuses, the versioned policy. |
| `metrics.ts`        | What each metric means, and which kinds of source can supply it.                                      |
| `source.ts`         | The metric-source boundary and its registry.                                                          |
| `windows.ts`        | Calendar-day window planning in a declared timezone, and when a window has closed.                    |
| `classify.ts`       | Summarizing a series, assessing data quality, and classifying a measurement.                          |
| `causality.ts`      | Keeping observed language observed. Phrase sets, claim detection, and the disclaimer rule.            |
| `identity.ts`       | The identity a measurement is bound to.                                                               |
| `service.ts`        | Ensuring a measurement plan, starting a measurement, and the impact cards.                            |
| `store.ts`          | Persistence for `measurement_plans` and `business_outcome_measurements`.                              |
| `project-impact.ts` | Rolling measurements up to a project-level view.                                                      |
| `view.ts`           | Deriving the business impact card, window by window.                                                  |
| `messages.ts`       | Headlines, ladder labels, and the sentence per failure.                                               |
| `test-support.ts`   | Fixtures, a fake source and registry, and a seeded merged change.                                     |

The durable step graph is in [`src/modules/operations/business-measurement/`](../operations/business-measurement/workflow.ts).
