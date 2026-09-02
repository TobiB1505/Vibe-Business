# economy

Vibe's understanding of its own unit economics. **Read-only analysis** — this
module prices nothing, charges nobody and writes no row.

Two things enforce that rather than describe it:

- `isolation.test.ts` walks every `.ts` file under this directory, at any depth,
  and fails if one imports `credits/`, `billing/`, `coding-agent/` or
  `operations/`, holds a `SupabaseClient`, or writes to a table.
- `CREDIT_RATE_CARDS` in `credits/rating.ts` is `[]`, and each sprint's own
  `sprint-NNNN-safety.test.ts` asserts it still is.

Three primitives are readable from outside, and nothing else:

| Module | Read by | Why it is safe |
| --- | --- | --- |
| `execution-class.ts` | `execution-contract/`, `credits/`, the billing UI | Classifies a step. Contains no money at all. |
| `infrastructure-rates.ts` | `credits/margin-guard.ts` | What Vibe *pays* a provider, never what it charges. |
| `sandbox-cost.ts` | `credits/margin-guard.ts` | Dimensions to nanodollars. Arithmetic, not policy. |

`sprint-0054-safety.test.ts` enforces that list: any other import from this
module, from anywhere but the internal calibration harness and one named
boundary file, fails the build.

**The predictive estimator has one reader outside this module, and it may not
carry a number out of it** ([ADR 0072](../../../docs/decisions/0072-the-evidence-behind-the-ceiling.md)).
`coding-agent/run-forecast.ts` reads it to say what stands behind the Credit
ceiling above the Run button — how many comparable runs, and what about this
run pushes toward the top of the figure. Its `RunForecast` has four fields and
none is money, which the same suite checks by reading its source. The reason
the guard exists is unchanged: a quote reaching the execution path is a quote
that would eventually authorize something, so the estimate is consumed for its
structure and never for its magnitude. `quote-simulation.ts` and
`safety-margin.ts` stay unreadable by anybody.

## Files

### Primitives

| File | Purpose |
| --- | --- |
| `cost.ts` | `CostAmount` / `CostTotal`. A cost is measured, estimated, or absent **with a reason**. A total containing an absence cannot be rendered as a number. |
| `infrastructure-rates.ts` | Vercel list prices, effective-dated, integer nanodollars, with provenance as a field. |
| `metric-availability.ts` | When each metric started being recorded, so a `null` in an older row is never averaged as a zero. |

### Measuring one run

| File | Purpose |
| --- | --- |
| `sandbox-cost.ts` | Sandbox dimensions to money. Wall duration is not active CPU, and refuses to substitute one for the other. |
| `run-economics.ts` | Sprint 0049's per-run economics, plus the older credit-scenario shape. |
| `workflow-invocation-cost.ts` | Vibe's own Vercel Workflows invocations. |
| `harness-metrics.ts` | What the agent harness did, derived from its event stream rather than from gateway counters. |
| `cost-drivers.ts` | Splits measured spend across model / validation / infrastructure, carrying repository size as a **correlate, never a fourth share**. |

### Pricing analysis

| File | Purpose |
| --- | --- |
| `execution-class.ts` | The pre-execution pricing classifier: `small` / `standard` / `complex` from risk class, change kind, evidence and surfaces. |
| `historical-runs.ts` | The frozen dataset of the seven delivered runs. **Read, never written.** |
| `credit-rate-card.ts` | Hypothetical A/B/C rate cards. Not `CREDIT_RATE_CARDS`; not a price. |
| `failure-economics.ts` | What the failed attempts cost, and whether a rate card covers them. |
| `class-cost-analysis.ts` | Per-class cost statistics from the dataset. |
| `stress-test.ts` | Provider inflation, infrastructure inflation and failure rate. |

### `intelligence/` — predictive economics (Sprint 0054)

| File | Purpose |
| --- | --- |
| `model-version.ts` | `EconomyModelVersion` — every economic assumption, effective-dated and append-only. |
| `provider-rates.ts` | Provider-agnostic token rates. States no price; delegates to `ai/pricing.ts`. |
| `confidence.ts` | Weakest-link confidence, carrying the sample size behind it. |
| `context-pressure.ts` | How much relevant context did not fit the brief. |
| `repository-signal.ts` | Repository **complexity** as a bounded multiplier. Contains no nanodollars. |
| `repository-drift.ts` | Repository **volatility** between executions. Also contains no nanodollars. |
| `historical-similarity.ts` | Neighbour matching with a pluggable weighting policy. |
| `pre-execution-estimate.ts` | The estimator. Sees nothing a run produced. Read by `coding-agent/run-forecast.ts`, for its structure only (ADR 0072). |
| `quote-simulation.ts` | What a quote would look like. `activated: false` is a literal type. |
| `safety-margin.ts` | The internally protected cost. Never customer-facing. |
| `prediction-snapshot.ts` | The whole reasoning chain, replayable to the same estimate. |
| `actual-economics.ts` | What a completed run actually cost, split by component. |
| `reconciliation.ts` | Prediction versus reality, and a clamped adjustment proposal. |
| `learning-dataset.ts` | Leave-one-out backtest over runs #3–#9. |
| `prediction-bias.ts` | Cohorts the estimator systematically misprices. |
| `variance-explanation.ts` | Why a run cost more than expected — or that nothing here explains it. |
| `growth-simulation.ts` | The four stress axes together, repository growth included. |

Three of these have no consumer and are deliberately not given one:
`safety-margin.ts`, because charging a customer for Vibe's uncertainty is a
decision nobody has made; `growth-simulation.ts`, because it is a rate-card
planning tool whose home is `docs/business/` rather than the product; and
`variance-explanation.ts`, because it explains why an actual differed from an
estimate and there is no post-run economics surface to explain it on.

## Invariants worth knowing before changing anything here

1. **Unknown is never zero.** Every absence carries a reason. `cost ?? 0` is how
   a business talks itself into a margin it does not have.
2. **No rate is hard-coded.** Rates arrive as parameters or from `ai/pricing.ts`
   and `infrastructure-rates.ts`. A number nobody approved must not become one
   everybody quotes.
3. **Repository size is a driver, never a cost line.** Nobody invoices Vibe for
   tree entries. Its whole effect is already inside the model spend, and giving
   it a slice of the same pie counts the money twice.
4. **Complexity and volatility are separate signals.** "How big is it" and "how
   much does it move" have different answers, and run #6 → #9 was the second.
5. **A cost is never representable without its confidence.** Not a convention —
   a required field.
6. **An estimator may not see what a run produced.** Enforced by a source scan,
   because an estimator that can reach actuals eventually becomes a bill.
7. **Only a provider figure may be `measured`.** Everything rate-derived is
   `estimated`, however precisely computed.
8. **Historical data is never overwritten.** New findings go in new arrays in new
   files.
9. **Any learning correction is clamped.** A loop that can move its own cost
   expectation without bound is an outage with a feedback path.

## Related

- [`docs/business/ECONOMY_MODEL.md`](../../../docs/business/ECONOMY_MODEL.md)
- [`docs/business/CREDIT_PRICING_V1.md`](../../../docs/business/CREDIT_PRICING_V1.md)
- [ADR 0024 — Vibe Credits as an Internal Economic Layer](../../../docs/decisions/0024-vibe-credits-economic-layer.md)
- [ADR 0038 — The Economy Intelligence Layer](../../../docs/decisions/0038-economy-intelligence-layer.md)
