# The price rise that did not happen

**Recorded 2026-08-31, after the work.** A correction slice, scoped to one thing: [Sprint 0111](0111-launch-v1-rate-card.md) derived the entire `launch-v1` rate card against a Claude Sonnet 5 price increase that Anthropic has since withdrawn. Verify that against first-party sources, correct the provider timeline, re-derive every number that inherited it, and make the mistake impossible to repeat.

No billing redesign. No Billing UI redesign. No Stripe change. No migration.

## The fact, and how it was verified

The brief asserted the cancellation and required it to be confirmed against Anthropic's own current documentation before any code moved — with an explicit instruction to **stop** and report if the sources disagreed.

Three first-party pages, all retrieved 2026-08-31:

| Source | What it says |
| --- | --- |
| <https://platform.claude.com/docs/en/about-claude/pricing> | `\| Claude Sonnet 5 \| $2 / MTok \| $2.50 / MTok \| $4 / MTok \| $0.20 / MTok \| $10 / MTok \|` plus an explicit cancellation note |
| <https://platform.claude.com/docs/en/models/sonnet-5/overview> | Input $2, output $10, 5-minute cache write $2.50, 1-hour cache write $4, cache read $0.20. No scheduled change |
| <https://platform.claude.com/docs/en/models/overview> | "$2 / input MTok, $10 / output MTok" |

The pricing page states it in as many words:

> The $2/$10 per million input/output token pricing for Claude Sonnet 5, announced at launch as introductory pricing through August 31, 2026, is now the standard price. The previously scheduled increase to $3/$15 per million input/output tokens on September 1, 2026 will not occur.

No divergence, so the work proceeded. Haiku 4.5 confirmed unchanged at $1/$5 and left alone. One incidental finding, pre-existing and not changed: the repository models a single cache-write rate (2,500 nanoUSD/token — the 5-minute write), while Anthropic also publishes a 1-hour write at $4/MTok. Vibe uses no 1-hour breakpoint, so one rate is the whole story; it is now said in a comment rather than left to be inferred.

The first URL guess (`/docs/en/pricing.md`) 404'd. The canonical path came off the models-overview page rather than from memory, which is the only reason the retrieval is worth trusting.

## What the mistake actually was

Not the guard, and not the card's method. `margin-guard.ts` was built in Sprint 0111 *for* this rise and its architecture was right: frozen production quantities × provider rates resolved **at the instant asked**. That is exactly what surfaced the error — a withdrawn rise shows up as prices too high in the same mechanism that would show an arriving one as prices too low.

The mistake was one row in `ai/pricing.ts`, and everything downstream inherited it honestly. Every Sonnet-priced operation's COGS was restated ~50% high, so every derived price came out ~57% high.

The invariant this restores, stated once:

```
provider pricing source → effective-dated provider rates → frozen measured quantities
  → current COGS → credit price → margin guard
```

**A stale planned provider price must never silently become effective.**

## The correction

### The row is deleted, not held

```
-  claude-sonnet-5-introductory-2026   2026-01-01 → 2026-09-01
-  claude-sonnet-5-standard-2026-09    2026-09-01 → null          in 3_000  out 15_000
+  claude-sonnet-5-introductory-2026   2026-01-01 → null
```

Commenting it out, flagging it `cancelled`, or pushing its `effectiveFrom` into the far future were all considered and all rejected: a dead row inside an array a resolver walks is one edit or one misread window from pricing real usage, and it protects nothing because it never billed a call. What it *was* belongs in [ADR 0062](../decisions/0062-sonnet-5-price-rise-cancelled.md), which is a document rather than a table something resolves against.

The deletion was checked before it was made, not argued afterwards. The row's instant had not arrived; **zero** rows name it in either ledger (`ai_usage_events` 295 introductory / 17 haiku / 13 null; `billing_usage_events` 755 / 20 / 175 null); and `credits/projection.ts` re-derives a stored row's cost at `new Date(row.created_at)`, so every recomputation of existing history resolves inside the introductory window regardless of what comes after it.

`pricingVersion` was **not** renamed despite no longer describing an introductory price. 1,050 settled rows name that exact string. The version answers *which prices were in force*, not what the provider called them; renaming it would break the historical interpretability it exists for. The name is history, the window is the fact.

### The regression test has teeth, and that was verified

`ai/pricing.test.ts` asserts identical pricing at `2026-08-31T23:59:59.999Z` and `2026-09-01T00:00:00.000Z` — same version, same four rates, byte-identical `calculateProviderCost` across input, output, cache read and cache write — that Sonnet still prices in mid-2027, and that `MODEL_PRICING` holds **exactly one** open-ended Sonnet 5 row at neither 3,000 nor 15,000.

Then the deleted row was temporarily put back to see what happened: **six assertions fail**. Restored, seventeen pass. A test whose teeth were never checked is a comment with a longer runtime.

### The card re-derived, not reverted

Same rule, same frozen quantities, corrected rates:

| Operation | `retail-v1` | Sprint 0111 | **Final** | COGS/delivered | Margin | Basis |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Product Understanding | free | free | **free** | $0.0092 | — | measured |
| Business Audit | 35 | 55 | **35** | $0.1219 | 80.3% | measured |
| Next Moves | 20 | 30 | **20** | $0.0683 | 80.6% | measured |
| Action Plan | 15 | 30 | **20** | $0.0674 | 80.9% | measured |
| Deep Scan (additional) | — | 25 | **25** | unknown | — | policy |
| Agent — small | — | 150 | **150** | ~$0.361 (n=1) | 86.4% | modelled |
| Agent — standard | — | 200 | **200** | $0.4282 (n=16) | 87.9% | modelled |
| Agent — complex | — | 350 | **350** | ~$0.627 (**n=0**) | 89.8% | modelled |

Two of the three measured prices land back on `retail-v1` exactly, which is a coincidence worth naming as one — they were re-derived from the rule, not copied back because they looked familiar.

**Action Plan is the case that justifies re-deriving instead of reverting.** `retail-v1`'s 15 came from a single $0.044 observation; five deliveries now say $0.056, and a failed run whose cost was never recorded carries a 1.2× uplift. At 15 the margin is 74.5% — above the 70% floor, below the 20% target cost share the whole card is derived against. Reverting would have restored a price that was never right.

**Two prices were deliberately not moved, for opposite reasons.** Deep Scan has no measured cost at all, so nothing about Sonnet bears on it and changing it to make a margin report read complete would be inventing evidence. The agent tiers *do* have a mechanical price — the rule puts `standard` at 125 — and ship at 200 anyway, because the mean is not the exposure: the worst agent run ever measured costs $0.646, which at 125 returns 70.7%, sitting on the floor, against 81.7% at 200. With n=1 and n=0 behind the other two tiers, the headroom is a reserve, asserted in `margin-guard.test.ts` as an *inequality* so that quietly dropping to the derived price fails.

### The guard preserved, and given the test it was missing

Not weakened. Three additive changes:

- **A pricing-injection seam** — `resolvePricing` / `calculateProviderCost` take an optional price book defaulting to `MODEL_PRICING`, the shape `resolveRetailPolicy`, `resolveRateCard` and `resolveExecutionBudget` already use. Without it, the test below would have had to mutate a module every other test shares.
- **A teeth test** — a synthetic card at 2× Sonnet rates drops Business Audit 80.3% → 60.5% and breaches `MARGIN_FLOOR`; +50% reaches 70.4% and is asserted as a *reduction* rather than a failure, because it lands just above the floor. The real book is asserted untouched afterwards.
- **The assumptions declared once and reported** — `TARGET_COST_SHARE = 0.2` was prose in three docblocks and is now an exported constant; `targetPriceCreditUnits()` is the single implementation of the derivation rule; `economicsAssumptions()` surfaces all four, including `ASSUMED_EUR_USD = 1.08`, which was exported and referenced nowhere.

`ECONOMY_MODEL_VERSIONS[0].marginTarget = 0.75` is a third margin number — the estimator's assumption, append-only. Documented as distinct, deliberately not reconciled.

## Where the wrong rate had spread

Correcting the price book is one line. Finding everything that had quietly restated itself against it is the work.

- `credits/retail.ts` — the card, and three docblock derivations.
- `execution-contract/budget.ts` — "the most expensive agent run ever measured is $0.9237 restated at post-2026-09-01 Sonnet rates, so `standard` carries roughly 2x headroom". False twice: the run costs $0.646, and $1.75 is ~2.7×. The ceilings themselves are unchanged — they were never derived from the worst observation, only checked against it — so `checkBudgetBinding` and `maxCredits == retail price` are untouched.
- `economy/stress-test.ts` — a docblock citing the scheduled rise as a live example of why provider and infrastructure inflation are modelled separately.
- `economy/intelligence/model-version.ts` — two sentences: "`ai/pricing.ts` carries both sides of it" and "keeps the superseded Sonnet row". Both false at HEAD. The **entry** naming `claude-sonnet-5-standard-2026-09` was left exactly as it is: `ECONOMY_MODEL_VERSIONS` is append-only, it records what v1 was issued under the expectation of, and nothing resolves those strings. The docblock now says so, so the next reader does not "fix" it.
- `economy/intelligence/variance-explanation.test.ts` — used the cancelled version string as a synthetic fixture for "pricing changed between quote and bill". It passed and would keep passing; it also read as a real rate. Repointed at `test-only-successor-pricing-version`.
- `economy/intelligence/provider-rates.test.ts`, `credits/projection.test.ts`, `credits/retail.test.ts`, `ai/pricing.test.ts` — nine assertions across four files existed to prove the transition happened. Each was rewritten to assert *continuity*, or to demonstrate the same half-open-interval property on a boundary that still exists (Haiku's 2025-10-01 opening).
- `deriveGatewayCeilings` — needed no edit, but its output moved: `maxOutputTokens` for `standard` stays at 175,000 instead of dropping to ~116,667. Checked that no test pinned the September-derived figure. None did.
- The billing page — prices only. 55→35, 30→20, and "18 Business Audits" → **28** (1,000 ÷ 35); Pro's line becomes 85. Computed by the page from the catalog and the rate card, never typed, so the e2e assertions moved and the component did not. The `at` injection and the `billing-launch-v1` fixture from Sprint 0111 are preserved exactly.

## What did not move, deliberately

No settled ledger entry re-rated. No `ai_usage_events` or `billing_usage_events` row modified. No completed Credit charge changed. No Stripe product or Price touched. No customer purchase altered. No quote invalidated. `retail-v1` stays closed at the same instant with 35 / 20 / 15 forever, and the nine charges naming it still resolve to what they were charged.

`LAUNCH_V1_EFFECTIVE_FROM` stays `2026-09-01T00:00:00.000Z`. It was chosen to mirror the rise; moving it earlier would backdate a window `retail-v1` already covered, moving it later would delay for a reason that no longer exists. It is now simply the launch date.

**No migration.** Provider pricing lives entirely in TypeScript — `supabase/` and `scripts/` contain zero references to any pricing version — so nothing here touches a database contract. The brief required a stop-and-explain if one appeared necessary. None did.

**No FX service.** EUR/USD 1.08 remains a stated planning assumption. It is now *visible* — `economicsAssumptions()` returns it — which is a different thing from being observed, and the rate card says which it is.

## The mistake worth reading

Not the cancelled price. The three places that had *restated* a measured figure against a scheduled rate and then presented the result as a measurement: "$0.9237" in a budget docblock, "$0.1899 (Sept rates)" in a derivation table, and a test fixture named after a real pricing version. Each one was arithmetic done correctly on an assumption that later failed, and none of them said which part was which. The frozen quantities survived the correction untouched; every restated *dollar* figure had to be recomputed. That is the argument for the guard's design — quantities frozen, prices live — showing up as a cost rather than as a principle.

## Validation

409 files / 7,041 tests, lint, typecheck, build, `db:test`, documentation-currency, and the billing e2e including the `launch-v1` fixture. The regression test was verified by reintroducing the deleted row and watching six assertions fail.

## Status this slice can honestly claim

**Recalibrated, not validated.** The correction changed which provider rates the arithmetic runs against; it turned no unknown into a known.

- **MEASURED** — Product Understanding, Business Audit, Next Moves, Action Plan.
- **MODELLED** — Agent `small` (n=1), `standard` (n=16, dogfood, one repository), `complex` (**n=0**).
- **POLICY / UNKNOWN** — Deep Scan. No browser-provider rate exists anywhere in the repository and `provider_cost_usd` is null for every relevant row. More runs will not fix it; one founder-attested rate would.

Still unproved, unchanged from Sprint 0111: no agent run has been charged at a production price, no Deep Scan has been charged, `billing_credit_quotes` is empty, repository size is null for every historical row, and EUR/USD is assumed rather than observed.

One asymmetry worth recording, because it is the shape of the next miss: the guard fails loudly when a rate **rises** and stays green when one **falls**. A cancelled rise leaves every margin comfortably above the floor. It was caught by reading the reported margins against the target, not by a red test — which is why the rate card now prints them.
