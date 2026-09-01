# ADR 0062 — A cancelled provider price is deleted, not held

**Status:** Accepted
**Date:** 2026-08-31
**Amends:** [ADR 0061](0061-launch-v1-operation-rate-card.md) — the rate card it set, not the reasoning that set it
**Satisfies:** [CLAUDE.md](../../CLAUDE.md) rule 46, rule 78

## Context

`src/modules/ai/pricing.ts` has carried two Claude Sonnet 5 rows for weeks:

```
claude-sonnet-5-introductory-2026   2026-01-01 → 2026-09-01   in 2_000  out 10_000
claude-sonnet-5-standard-2026-09    2026-09-01 → null         in 3_000  out 15_000
```

Anthropic had announced $2/$10 per MTok as introductory pricing through 31 August 2026, with a rise to $3/$15 the next day. The effective-dated price book held both sides of it, which is exactly what that design is for: a future row prices nothing until its instant arrives.

[ADR 0061](0061-launch-v1-operation-rate-card.md) was written the day before that instant, and the rise is the fact that decided its timing. Every `launch-v1` price was derived against the September rates — Business Audit 55, Next Moves 30, Action Plan 30 — because holding `retail-v1`'s 35 / 20 / 15 through a +50% step would have dropped a ~80% contribution margin to ~68% overnight with no code change and every test green.

**The rise was withdrawn.** Verified 2026-08-31 against Anthropic's own pricing page, which states it in those terms:

> The $2/$10 per million input/output token pricing for Claude Sonnet 5, announced at launch as introductory pricing through August 31, 2026, is now the standard price. The previously scheduled increase to $3/$15 per million input/output tokens on September 1, 2026 will not occur.
> — <https://platform.claude.com/docs/en/about-claude/pricing>, retrieved 2026-08-31

Corroborated the same day by <https://platform.claude.com/docs/en/models/sonnet-5/overview> ($2 in, $10 out, $2.50 5-minute cache write, $4 1-hour cache write, $0.20 cache read) and <https://platform.claude.com/docs/en/models/overview>. First-party sources only; no third-party pricing aggregator was consulted or relied on. Haiku 4.5 is unchanged at $1/$5.

So the price book was wrong in the one direction nobody had planned for. Not a rise that arrives unannounced — a rise that was announced, was reflected everywhere downstream, and then did not happen. Every `launch-v1` price was ~57% too high against a cost that never rose.

## The decision

### The cancelled row is deleted, and the surviving row's window is opened

One row remains, `2026-01-01 → null`, at $2 / $10 / $0.20 / $2.50.

A cancelled future price could have been kept — commented out, flagged `cancelled: true`, or left with an `effectiveFrom` pushed into the far future. All three were rejected. A dead row inside an array a resolver walks is one edit, one merge, or one misread window away from pricing real usage, and it protects nothing: it never billed a call, so no stored cost depends on it. **A price that must never take effect is best represented by not existing** — the same reasoning [CLAUDE.md](../../CLAUDE.md) rule 76 applies to capabilities. What the row *was* belongs in this record, which is a document, not a table something resolves against.

The deletion is safe to make rather than merely defensible. The row's `effectiveFrom` had not arrived; **zero** rows in either `ai_usage_events` (295 introductory / 17 haiku / 13 null) or `billing_usage_events` (755 / 20 / 175 null) name it; and `credits/projection.ts` re-derives a stored row's cost by resolving at `new Date(row.created_at)`, so every recomputation of existing history lands inside the introductory window regardless of what follows it.

### `pricingVersion` keeps saying "introductory" for a price that is now permanent

`claude-sonnet-5-introductory-2026` is **not** renamed. 1,050 settled usage rows name that exact string, and the version exists to answer "which prices were in force when this was billed" — not "what did the provider call them at the time". Renaming it to reflect the new permanence would break precisely the historical interpretability the field was added for. The name is history; the window is the fact.

### A permanent regression test, not a comment

`ai/pricing.test.ts` asserts that Sonnet 5 prices identically at `2026-08-31T23:59:59.999Z` and `2026-09-01T00:00:00.000Z` — same version, same four rates, byte-identical `calculateProviderCost` output across all four dimensions including cache read and cache write — that it still prices in mid-2027, and that `MODEL_PRICING` carries **exactly one** open-ended Sonnet 5 row at neither `3_000` nor `15_000`.

That last assertion is the point. Reintroducing the deleted row was tried before the test was accepted: six assertions fail. A comment saying "do not add this back" fails nothing.

### The card is re-derived, not restored

`launch-v1` is recomputed by the same rule at the corrected rates — cost per delivered result ÷ 0.20 ÷ $0.017640, rounded up to the nearest 5 — rather than reverted to `retail-v1`'s numbers because those numbers look familiar.

| Operation | `retail-v1` | ADR 0061 | **Final `launch-v1`** | COGS / delivered | Margin | Basis |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Product Understanding | free | free | **free** | $0.0092 | — | measured |
| Business Audit | 35 | 55 | **35** | $0.1219 | 80.3% | measured |
| Next Moves | 20 | 30 | **20** | $0.0683 | 80.6% | measured |
| Action Plan | 15 | 30 | **20** | $0.0674 | 80.9% | measured |
| Deep Scan (additional) | — | 25 | **25** | unknown | — | policy |
| Agent — small | — | 150 | **150** | ~$0.361 (n=1) | 86.4% | modelled |
| Agent — standard | — | 200 | **200** | $0.4282 (n=16) | 87.9% | modelled |
| Agent — complex | — | 350 | **350** | ~$0.627 (**n=0**) | 89.8% | modelled |

Two of the three measured prices land back on `retail-v1` exactly. **Action Plan does not**, and that is the case the re-derivation exists to catch: `retail-v1`'s 15 came from a single observation of $0.044, five deliveries now say $0.056, and a failed run whose cost was never recorded carries a 1.2× uplift. At 15 the margin is 74.5% — above the floor, below the target the whole card is derived against. Reverting would have restored a price that was never right.

**Deep Scan stays at 25 and the agent tiers stay at 150 / 200 / 350.** Neither was moved, for opposite reasons. Deep Scan has no measured cost at all — no browser-provider rate exists in this repository — so nothing about Sonnet pricing bears on it, and adjusting it to make a margin report read better would be inventing evidence. The agent tiers *do* have a mechanical price: the rule puts `standard` at 125. They ship at 200 because the mean is not the exposure — the most expensive agent run ever measured costs $0.646, which at 125 Credits returns 70.7%, sitting on the guard floor, against 81.7% at 200. With n=1 for `small` and n=0 for `complex`, that headroom is a deliberate reserve, shipped as `basis: "modelled"` and asserted in `margin-guard.test.ts` as an inequality so that quietly dropping the tiers to their derived price fails.

`LAUNCH_V1_EFFECTIVE_FROM` stays at `2026-09-01T00:00:00.000Z`. The instant was chosen to mirror the rise, and the rise is gone — but moving it earlier would backdate a window `retail-v1` already covered with nine settled charges, and moving it later would delay for a reason that no longer exists. It is now simply the launch date.

### The margin guard is preserved and given teeth

`credits/margin-guard.ts` was built for the rise and is not weakened by its cancellation. Its architecture was the thing that worked: frozen production quantities × provider rates resolved **at the instant asked**, never frozen historical dollars and never a duplicated rate constant. That is what made a withdrawn rise visible as prices that were too high, in the same mechanism that would have made an arriving one visible as prices that were too low.

Three changes, all additive:

- **A pricing-injection seam.** `resolvePricing` and `calculateProviderCost` take an optional price book defaulting to `MODEL_PRICING`, the same shape `resolveRetailPolicy`, `resolveRateCard` and `resolveExecutionBudget` already use. It exists so the guard's own test can price a hypothetical future card without mutating a module every other test shares.
- **A teeth test.** A synthetic card at 2× current Sonnet rates drops Business Audit from 80.3% to 60.5% and breaches `MARGIN_FLOOR`; a +50% card reaches 70.4% and is asserted as a *reduction* rather than a failure, because it lands just above the floor. The real price book is asserted untouched afterwards.
- **The assumptions are declared once and reported.** `TARGET_COST_SHARE = 0.2` joins `CREDIT_VALUE_NANO_USD` and `MARGIN_FLOOR` as an exported constant instead of prose in three docblocks, `targetPriceCreditUnits()` is the single implementation of the derivation rule, and `economicsAssumptions()` surfaces all four — including `ASSUMED_EUR_USD = 1.08`, which was exported and referenced nowhere.

`ECONOMY_MODEL_VERSIONS[0].marginTarget = 0.75` is a **third** margin number. It is the predictive estimator's assumption, it is append-only, and it is deliberately not reconciled with either of the above.

## Consequences

**A stale planned provider price cannot silently become effective.** Not because a person will remember, but because the array contains no such row and a test fails if one is added.

**The guard is now known to cut both ways.** It was written against a rise and first earned its keep against a cancellation. Its recalibration trigger is asymmetric, though, and the rate card says so: a rate that *rises* fails the floor assertion outright, while a rate that *falls* leaves every margin comfortably green and is caught only by reading the reported margins against the target. That asymmetry is recorded rather than engineered away — a guard that failed when margin was too high would fire on every conservative price in the card, the agent tiers included.

**No historical billing moves.** No settled ledger entry is re-rated, no `ai_usage_events` or `billing_usage_events` row is modified, no completed Credit charge changes, no Stripe product or Price is touched, and no quote is invalidated. `usage.ts` records cost at write time, `projection.ts` recomputes at `row.created_at`, and `reconciliation.ts` compares and *reports* mismatches rather than overwriting them. A test in `projection.test.ts` asserts a stored row prices identically on both sides of the cancelled instant.

**No migration.** Provider pricing lives entirely in TypeScript; `supabase/` and `scripts/` contain zero references to any pricing version. Nothing in this correction touches a database contract.

**A derived ceiling moved without an edit.** `deriveGatewayCeilings` computes `maxOutputTokens` as `maxProviderSpendUsd ÷ the model's output rate`, so `standard` now admits 175,000 output tokens rather than the ~116,667 the September rate implied. Nothing pins that figure in code or in a test — it is a function of the price book by design — and `maxProviderSpendUsd` itself is unchanged, so `checkBudgetBinding` and the `maxCredits == retail price` equality are untouched.

**What this does not claim.** The card is **recalibrated, not validated**. Three of its eight prices still rest on something other than measurement: Deep Scan has no browser-provider rate to check against and will not acquire one from more runs, `small` has a single observation, and `complex` has none. All agent data remains `non_production_economics = true` against one repository, no agent run has been charged at a production price, and EUR/USD is a stated assumption rather than an observed rate. The correction changed which provider rates the arithmetic runs against; it did not turn any unknown into a known.
