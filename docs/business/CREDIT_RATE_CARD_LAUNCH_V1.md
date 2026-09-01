# Credit Rate Card — `launch-v1`

**Status:** Active. Effective `2026-09-01T00:00:00.000Z`.
**Supersedes:** `retail-v1` (active 2026-08-18 → 2026-09-01)
**Decisions:** [ADR 0061](../decisions/0061-launch-v1-operation-rate-card.md) — the card. [ADR 0062](../decisions/0062-sonnet-5-price-rise-cancelled.md) — the correction that set its final numbers.
**Code:** `src/modules/credits/retail.ts` · `src/modules/execution-contract/budget.ts` · `src/modules/credits/margin-guard.ts`

This document records the derivation. It is not the authority — the code is, and `margin-guard.test.ts` keeps it honest — but every number below can be traced from here to a row in production.

---

## 1. What the production data said

Queried live from the Vibe-Business Supabase project on 2026-08-31, grouped per **delivered result** (`ai_usage_events.job_id`, which is the domain artifact: one audit, one opportunity set, one profile, one plan, one agent run).

| Operation | Model | Jobs | Mean USD | p50 | p90 | Max |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `product_understanding` | Haiku 4.5 | 17 | 0.0092 | 0.0097 | 0.0104 | 0.0111 |
| `business_readiness_audit` | Sonnet 5 | 27 | 0.1125 | 0.0839 | 0.1953 | 0.2347 |
| `opportunity_generation` | Sonnet 5 | 13 | 0.0683 | 0.0602 | 0.0915 | 0.1052 |
| `action_planning` | Sonnet 5 | 5 | 0.0562 | 0.0519 | 0.0716 | 0.0741 |
| `agentic_execution` | Sonnet 5 | 16 | 0.2672 | 0.2208 | 0.4723 | 0.6158 |

Sandbox, from `sandbox_usage_events` at Vibe's real 4 vCPU / 8 GB shape against the founder-attested `VERCEL_SANDBOX_RATES`:

| Purpose | n | Wall | Active CPU | Derived cost |
| --- | ---: | ---: | ---: | ---: |
| `agent_execution` | 19 | 248 s | 127 s | ~$0.030 |
| `change_validation` (passed) | 27 | 314 s | 212 s | ~$0.045 |
| `change_validation` (failed) | 8 | 49 s | 25 s | ~$0.006 |
| `change_preview` | 5 | 456 s | 6 s | ~$0.022 |

Three findings shaped the card.

**No usage has ever been rated.** All 950 `billing_usage_events` rows read `rating_status = 'rate_card_not_configured'` with a null `rate_card_version`. Every browser and sandbox row is `cost_unknown` or `not_billable`. That is exactly what `rating.ts` documents, and `launch-v1` does not change it — see §6.

**Two books were already running side by side.** `retail-v1` settled nine charges (audit 35, next moves 20, action plan 15). `core4-dogfood-budget-v1` settled twelve agent runs at the 100-Credit internal *ceiling*, which `credits/internal.ts` is explicit is "not a price, not a forecast of one".

**`retail-v1` was calibrated against the Pro plan's credit value.** €49 ÷ 3,000 = €0.016333/Credit; 35 Credits = €0.572 against $0.1125 measured ≈ 80%. That is the standard `launch-v1` had to hold.

---

## 2. The two stated assumptions

Neither is a measurement, and both are load-bearing.

**EUR/USD = 1.08.** Vibe prices in euro and pays its providers in dollars. Nothing in this repository observes the rate; `ASSUMED_EUR_USD` in `margin-guard.ts` is a stated planning constant with this document named as its source, and `economicsAssumptions()` returns it so it is visible in what the guard reports rather than buried in a comment. There is no FX service and this slice did not add one. A material FX move is a reason to re-run §4, not a reason to change code silently.

**One Credit is worth $0.017640.** €49 ÷ 3,000 Credits = €0.016333, at 1.08. The *cheapest* way to obtain a Credit is used deliberately: a margin that clears at the Pro rate clears on Builder (€0.019) and on every pack (€0.0198–€0.0240). Averaging would let pack buyers' margin subsidise a number that is wrong for the customers who buy the most.

The **target cost share is 0.20** and the **guard floor is 0.70**. Both are exported constants (`TARGET_COST_SHARE`, `MARGIN_FLOOR`) rather than prose, and they are two different things: the target is what a new price is derived to hit, the floor is what an existing price may never fall below. A third number, `ECONOMY_MODEL_VERSIONS[0].marginTarget = 0.75`, belongs to the *estimator's* assumptions and is append-only; it is deliberately not reconciled with either of these.

---

## 3. The provider price this card is derived against

**Claude Sonnet 5 costs $2 / MTok input and $10 / MTok output, and will keep costing that.**

`ai/pricing.ts` carried a second row for weeks — `claude-sonnet-5-standard-2026-09`, $3/$15 from `2026-09-01T00:00:00.000Z` — because Anthropic had announced $2/$10 as introductory pricing through 31 August 2026 with a 50% rise the next day. **That rise was withdrawn.** Verified 2026-08-31 against Anthropic's own pricing page, which states it in those terms:

> The $2/$10 per million input/output token pricing for Claude Sonnet 5, announced at launch as introductory pricing through August 31, 2026, is now the standard price. The previously scheduled increase to $3/$15 per million input/output tokens on September 1, 2026 will not occur.
> — <https://platform.claude.com/docs/en/about-claude/pricing>, retrieved 2026-08-31

Corroborated the same day by <https://platform.claude.com/docs/en/models/sonnet-5/overview> and <https://platform.claude.com/docs/en/models/overview>, both listing $2/$10 with no scheduled change. Haiku 4.5 is unchanged at $1/$5 and was not touched.

The September row has been deleted rather than left dormant. It never priced a call, so no stored cost depends on it; a cancelled future price that still sits in the array is one edit away from pricing real usage. What it *was* is recorded in [ADR 0062](../decisions/0062-sonnet-5-price-rise-cancelled.md), and a permanent regression test in `ai/pricing.test.ts` fails if it comes back.

**This is why the numbers in §4 are not the ones ADR 0061 first published.** That card was derived at the September rates, which made every Sonnet-priced operation look ~50% more expensive than it is. Audit 55 → **35**, Next Moves 30 → **20**, Action Plan 30 → **20**. Two of the three land back on `retail-v1` exactly.

`margin-guard.ts` is what caught it, and it was built for the opposite case. It recomputes every price's margin from the provider rates **in force at the instant it is asked**, applied to frozen production quantities — so a withdrawn rise shows up as prices that are too high just as reliably as an arriving one shows up as prices that are too low.

---

## 4. The derivation

One rule, no per-operation special cases:

```
credits = effective provider cost per DELIVERED result
          ÷ 0.20        TARGET_COST_SHARE — the contribution margin retail-v1 was calibrated to
          ÷ $0.017640   §2
          rounded up to the nearest 5
```

It is `targetPriceCreditUnits()` in `margin-guard.ts`, not arithmetic done by hand in a document, and `margin-guard.test.ts` asserts that the three measured prices are the ones the rule actually produces.

**"Effective per delivered" means attempts ÷ deliveries**, not the mean of the successes. A failed AI call still spends real provider money, and the measured mean cost of a *failed* audit ($0.149) is higher than that of a successful one ($0.098). Pricing against the success mean would claim a margin Vibe does not have.

| Operation | Cost/delivered | ÷ 0.20 ÷ $0.01764 | Rounded | Margin |
| --- | ---: | ---: | ---: | ---: |
| Business Audit | $0.1219 | 34.5 | **35** | 80.3% |
| Next Moves | $0.0683 | 19.4 | **20** | 80.6% |
| Action Plan | $0.0674 | 19.1 | **20** | 80.9% |
| Agent, `standard` | $0.4282 | 121.4 | *125* | see below |

Margins are the guard's own output, not hand arithmetic.

Next Moves and Action Plan land on the same number because their measured effective costs are within 2% of each other. That is the arithmetic, not a rounding convenience.

**Action Plan is the one measured price that does not return to its `retail-v1` value.** That 15 came from a single observation of $0.044; five deliveries now say $0.056, and a failed run whose cost was never recorded carries a 1.2× uplift on top. At 15 Credits the margin is 74.5% — above the floor, below the target the whole card is derived against. 20 is the smallest multiple of five that meets it.

**Product Understanding stays free.** $0.0092 per run, about 8% of an audit, on the Haiku card that never moved. It runs inside the onboarding flow every new project passes through and the answer to "should we run it?" is always yes. `free` is a distinct case in the type, not a price of zero — a zero would post a 0-Credit charge every time somebody's product understanding refreshed.

### The agent tiers: 150 / 200 / 350, and why they are above the rule

The rule prices `standard` at 125 Credits on a mean of $0.4282 — an 80.6% margin. The tiers ship at **200**, and that gap is deliberate.

**The mean is not the exposure.** The most expensive agent run ever measured costs $0.646. At 125 Credits that run returns 70.7% — sitting on the guard floor. At 200 it still clears 81.7%.

Agent cost has by far the widest spread of anything in this card, and the evidence under it is the thinnest: sixteen dogfood runs against one repository, `small` carrying a single observation and `complex` **none at all**. The headroom is a reserve against that, shipped as `basis: "modelled"` and asserted in `margin-guard.test.ts` as an *inequality* — so quietly dropping the tiers to their derived price fails a test rather than passing silently.

| Class | Credits | USD at §2 | Relative | Modelled cost | Margin |
| --- | ---: | ---: | ---: | ---: | ---: |
| small | 150 | $2.65 | 1.00 | ~$0.361 (n=1) | 86.4% |
| standard | 200 | $3.53 | 1.33 | $0.4282 (n=16) | 87.9% |
| complex | 350 | $6.17 | 2.33 | ~$0.627 (**n=0**) | 89.8% |

The ratio structure comes from [CREDIT_PRICING_V1.md](CREDIT_PRICING_V1.md), re-based from its $0.01/Credit *simulation* constant to the real €0.016333. That re-basing matters: read at the real credit value, that document's Model C 300 Credits would have been $5.29, not the $3.00 the simulation showed.

The corrected Sonnet pricing did not change these three numbers. It changed what the rule would have produced under them, and the argument for staying above the rule — the spread, and n=1 / n=0 — is the same argument at either provider rate.

### Deep Scan: 25 Credits, and no arithmetic behind it

There is no row above for Deep Scan because there is nothing to compute. `provider_cost_usd` is null for **every** row of `deep_scan_provider_usage` and `review_browser_usage`, and no browser-provider rate exists anywhere in this repository. A completed scan measures 64.6 s of browser time across 7 pages; what that costs is unknown.

25 Credits ($0.44) is a commercial judgment, sized to sit below the audit it feeds and well above any plausible cost of 65 browser-seconds. It ships as `basis: "policy"` and `margin-guard.ts` names it as a price it cannot check. **It was not moved by this correction**, because nothing about Sonnet pricing bears on browser time — changing it to make a margin report look complete would be inventing evidence. **One founder-attested Browserbase rate, in the shape `economy/infrastructure-rates.ts` already uses for Vercel, would move it to `measured`.** Until then it is the one number in this card that rests on judgment alone.

---

## 5. Reservation maxima and provider-spend ceilings

Two ceilings per class, answering two different questions.

| Class | `maxCredits` (customer) | `maxProviderSpendUsd` (Vibe) | Turns | Wall / sandbox |
| --- | ---: | ---: | ---: | --- |
| small | 150 | $1.30 | 30 | 15 / 12 min |
| standard | 200 | $1.75 | 40 | 20 / 15 min |
| complex | 350 | $3.00 | 60 | 25 / 20 min |

These are two different currencies on purpose. `maxCredits` is what the customer authorized, in retail Credits; `maxProviderSpendUsd` is Vibe's stop on its own invoice, in dollars. Neither is derived from the other and they are never conflated.

`maxCredits` **must** equal the retail class price. `checkBudgetBinding` refuses admission unless the reservation covers it, so a mismatch does not undercharge — it makes every run of that class refuse to start, for what looks like a billing fault. Both `budget.test.ts` and `authorization.test.ts` assert the equality class by class.

`maxProviderSpendUsd` is sized to a 50% floor margin: the point past which a single run stops being worth delivering. The most expensive agent run ever measured costs $0.646, so `standard`'s $1.75 carries roughly 2.7× headroom over the *worst* observation rather than over a typical one. That headroom widened when the Sonnet rise was withdrawn — the same run used to be quoted at $0.9237, restated at the September rates — and the ceilings were deliberately left where they are: they were never derived from the worst observation, only checked against it, and a stop more conservative than its check is not a fault.

A derived value did move without any edit: `deriveGatewayCeilings` computes `maxOutputTokens` as `maxProviderSpendUsd ÷ the model's output rate`, so `standard` now admits 175,000 output tokens instead of the ~116,667 the September rate would have allowed. Nothing pins that number in code or in a test; it is a function of the price book by design.

Blast-radius limits widen with the class because a `complex` step is complex by definition — it touches a sensitive surface or spans several named business surfaces — and such work legitimately needs more turns to inspect before it edits. A `small` step that wanted 60 turns is telling us its classification was wrong. `maxChangedFiles` deliberately does **not** widen for `small` and `standard`: the dogfood observation that one run reached exactly eight files is a reason to watch that ceiling, not to raise it.

Every `maxWallClockMs` stays below `AGENT_SANDBOX_LIFETIME_MS` (30 min), so a run's budget expires before its workspace does.

---

## 6. What `launch-v1` deliberately did not change

**Plans and packs.** Free 0 · Builder €19 → 1,000 · Pro €49 → 3,000; packs 500/€12, 1,500/€33, 5,000/€99; welcome 100 Credits, 30 days. No Stripe Price object moves and no published euro figure changes, so the production activation checklist does not reopen. The repricing lands entirely on what a Credit buys.

What a plan now buys, computed rather than typed (and shown on the billing page the same way):

| Plan | Credits | Agent improvements (standard) | or Business Audits |
| --- | ---: | ---: | ---: |
| Builder €19 | 1,000 | 5 | 28 |
| Pro €49 | 3,000 | 15 | 85 |

The welcome grant was checked rather than assumed. At the final prices, 100 Credits covers audit + next moves + action plan (75) outright — and `free_audit_grants` already covers a new user's first audit per repository, so the common path costs 40 and leaves 60. The card does not strand a new account.

**Settled history is untouched.** `retail-v1` stays closed at the same instant and keeps 35 / 20 / 15 forever; the nine charges that name it are not re-rated. `pricingVersion: "claude-sonnet-5-introductory-2026"` was **not** renamed despite no longer being introductory, because 295 `ai_usage_events` and 755 `billing_usage_events` rows name that exact string and `credits/projection.ts` re-derives a stored row's cost by resolving it at `row.created_at`. The version identifies which prices were in force, not what Anthropic called them; renaming it would break the historical interpretability it exists for.

**`CREDIT_RATE_CARDS`.** The per-SKU consumption card in `rating.ts` stays empty. It answers "what did this provider usage rate to" — credits per token, per millisecond, per byte — for Vibe's internal telemetry, which `economy/` already answers in nanodollars with confidence attached. A card here would also have to price cache tokens (55–70% of agentic provider cost); one that omitted them would correctly return `sku_not_priced`, which is a state with no value in shipping.

**Validation, preview and review.** Bundled into the agent price; their measured cost (~$0.045 + ~$0.022 + browser) is inside the $0.4282. A customer bought a validated improvement, not a pipeline. Line-iteming them would expose Vibe's cost structure as the customer's billing model and make the total price of an improvement unknowable in advance.

---

## 7. What this card is not confident about

Stated once, plainly, rather than qualified in every section above. Three of the eight prices are **not** measured, and the guard reports exactly those three as uncovered.

1. **`complex` has zero cost observations.** Its 350 Credits is a ratio, formatted identically to two measured numbers. This is the single largest gap between what the table shows and what it can defend.
2. **`small` has one.** Its mean, min and max are the same number.
3. **Deep Scan has none at all**, and unlike the two above, more runs will not fix it — only a browser-provider rate will.
4. **All agent data is `non_production_economics = true`**, against one repository and a narrow set of evidence families.
5. **The 41.7% failure rate is n=12.** A real rate of 30% or 60% would not be a surprise.
6. **Repository size is null for every historical row.** [ECONOMY_MODEL.md](ECONOMY_MODEL.md) showed the same step costing 2× more against a repository that had grown three files; nothing in this card sees that.
7. **EUR/USD is assumed, not observed** (§2).
8. **No agent run has ever been charged at a production price**, and `billing_credit_quotes` is still empty.

`margin-guard.ts` covers what can be covered and `uncoveredPrices()` returns exactly the three amounts it cannot, so a fourth is a decision somebody makes rather than a gap that opens.

---

## 8. Recalibration triggers

Inherited from [CREDIT_PRICING_V1.md](CREDIT_PRICING_V1.md) §Recalibration and still the right list.

- **On the first `complex`-tier run** — standing item, regardless of count. Worth more than the next twenty `standard` runs.
- **On a founder-attested browser rate** — moves Deep Scan from `policy` to `measured`, and is the only thing that can.
- **After 25 delivered agent runs** — re-run `analyzeClassCostDifferentiation`; enough to put a real spread on `small`.
- **After 50** — re-run `computeHistoricalFailureEconomics` against production rather than dogfood behaviour.
- **After 100** — full stress test against the observed class distribution.
- **On any upstream rate change** — `ai/pricing.ts` or an infrastructure rate. This one no longer needs remembering: `margin-guard.test.ts` recomputes from the rates in force and fails below the floor on the day one lands. It does not fire on a rate that *falls*, which is what happened here; that direction is caught by re-reading the guard's reported margins against the target, which is why they are printed in §4 rather than asserted only as "above the floor".
- **On the first run recording repository size** — correlate model spend against `repo_tree_entries` and `context_candidates_available`. Answers whether a flat per-class price silently cross-subsidises large repositories.
