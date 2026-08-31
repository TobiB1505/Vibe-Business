# Credit Rate Card — `launch-v1`

**Status:** Active. Effective `2026-09-01T00:00:00.000Z`.
**Supersedes:** `retail-v1` (active 2026-08-18 → 2026-09-01)
**Decision:** [ADR 0061](../decisions/0061-launch-v1-operation-rate-card.md)
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

**`retail-v1` was calibrated against the Pro plan's credit value.** €49 ÷ 3,000 = €0.016333/Credit; 35 Credits = €0.572 against $0.1125 measured ≈ 80%. That is the standard `launch-v1` had to hold, and the one the September rates break.

---

## 2. The two stated assumptions

Neither is a measurement, and both are load-bearing.

**EUR/USD = 1.08.** Vibe prices in euro and pays its providers in dollars. Nothing in this repository observes the rate, and `margin-guard.ts` records the derived constant with this document named as its source. A material FX move is a reason to re-run §4, not a reason to change code silently.

**One Credit is worth $0.017640.** €49 ÷ 3,000 Credits = €0.016333, at 1.08. The *cheapest* way to obtain a Credit is used deliberately: a margin that clears at the Pro rate clears on Builder (€0.019) and on every pack (€0.0198–€0.0240). Averaging would let pack buyers' margin subsidise a number that is wrong for the customers who buy the most.

---

## 3. The event that forced the timing

`ai/pricing.ts` has carried `claude-sonnet-5-standard-2026-09` for weeks: input $2 → $3, output $10 → $15, cache read and cache write both ×1.5, effective `2026-09-01T00:00:00.000Z`.

Every Sonnet-priced operation therefore costs exactly 1.5× more from that instant. Haiku is unchanged, which is why Product Understanding stays free without argument.

At the Pro credit value, holding `retail-v1`'s prices through that change would have produced:

| Operation | Price | Margin before | Margin after |
| --- | ---: | ---: | ---: |
| Business Audit | 35 | 80.3% | **~68%** |
| Next Moves | 20 | 80.6% | **~71%** |
| Action Plan | 15 | 74.5% | **~62%** |

No code change, no deploy, no visible event, every test green. `margin-guard.test.ts` asserts the counterfactual directly, so the reason for the repricing survives longer than anybody's memory of it.

---

## 4. The derivation

One rule, no per-operation special cases:

```
credits = effective provider cost per DELIVERED result
          ÷ 0.20        the contribution margin retail-v1 was calibrated to
          ÷ $0.017640   §2
          rounded up to the nearest 5
```

**"Effective per delivered" means attempts ÷ deliveries**, not the mean of the successes. A failed AI call still spends real provider money, and the measured mean cost of a *failed* audit ($0.149) is higher than that of a successful one ($0.098). Pricing against the success mean would claim a margin Vibe does not have.

| Operation | Cost/delivered (Sept rates) | ÷ 0.20 ÷ $0.01764 | Rounded | Margin |
| --- | ---: | ---: | ---: | ---: |
| Business Audit | $0.1899 | 53.8 | **55** | 81.2% |
| Next Moves | $0.1025 | 29.1 | **30** | 80.6% |
| Action Plan | $0.1012 | 28.7 | **30** | 80.9% |
| Agent, `standard` | $0.6507 | 184.4 | **200** | 82.2% |

Margins are the guard's own output at the September rates, not hand arithmetic.

Next Moves and Action Plan land on the same number because their measured effective costs are within 1% of each other. That is the arithmetic, not a rounding convenience.

**Product Understanding stays free.** $0.0098 per run, about 5% of an audit, on the Haiku card that did not move. It runs inside the onboarding flow every new project passes through and the answer to "should we run it?" is always yes. `free` is a distinct case in the type, not a price of zero — a zero would post a 0-Credit charge every time somebody's product understanding refreshed.

### The agent's other two tiers

`standard` is anchored on the only tier with real data. `small` and `complex` use the ratio structure [CREDIT_PRICING_V1.md](CREDIT_PRICING_V1.md) argued for, re-based from its $0.01/Credit *simulation* constant to the real €0.016333:

| Class | Credits | USD at §2 | Relative |
| --- | ---: | ---: | ---: |
| small | 150 | $2.65 | 1.00 |
| standard | 200 | $3.53 | 1.33 |
| complex | 350 | $6.17 | 2.33 |

In dollar terms this sits between that document's Model B (150/250/450 at $0.01 = $1.50/$2.50/$4.50) and Model C (200/300/500 = $2.00/$3.00/$5.00). The re-basing matters: read at the real credit value, Model C's 300 Credits would have been $5.29, not the $3.00 the simulation showed.

### Deep Scan: 25 Credits, and no arithmetic behind it

There is no row above for Deep Scan because there is nothing to compute. `provider_cost_usd` is null for **every** row of `deep_scan_provider_usage` and `review_browser_usage`, and no browser-provider rate exists anywhere in this repository. A completed scan measures 64.6 s of browser time across 7 pages; what that costs is unknown.

25 Credits ($0.44) is a commercial judgment, sized to sit below the audit it feeds and well above any plausible cost of 65 browser-seconds. It ships as `basis: "policy"` and `margin-guard.ts` names it as a price it cannot check. **One founder-attested Browserbase rate, in the shape `economy/infrastructure-rates.ts` already uses for Vercel, would move it to `measured`.** Until then it is the one number in this card that rests on judgment alone.

---

## 5. Reservation maxima and provider-spend ceilings

Two ceilings per class, answering two different questions.

| Class | `maxCredits` (customer) | `maxProviderSpendUsd` (Vibe) | Turns | Wall / sandbox |
| --- | ---: | ---: | ---: | --- |
| small | 150 | $1.30 | 30 | 15 / 12 min |
| standard | 200 | $1.75 | 40 | 20 / 15 min |
| complex | 350 | $3.00 | 60 | 25 / 20 min |

`maxCredits` **must** equal the retail class price. `checkBudgetBinding` refuses admission unless the reservation covers it, so a mismatch does not undercharge — it makes every run of that class refuse to start, for what looks like a billing fault. Both `budget.test.ts` and `authorization.test.ts` assert the equality class by class.

`maxProviderSpendUsd` is sized to a 50% floor margin: the point past which a single run stops being worth delivering. The most expensive agent run ever measured is $0.9237 restated at September rates, so `standard` carries roughly 2× headroom over the *worst* observation rather than over a typical one.

Blast-radius limits widen with the class because a `complex` step is complex by definition — it touches a sensitive surface or spans several named business surfaces — and such work legitimately needs more turns to inspect before it edits. A `small` step that wanted 60 turns is telling us its classification was wrong. `maxChangedFiles` deliberately does **not** widen for `small` and `standard`: the dogfood observation that one run reached exactly eight files is a reason to watch that ceiling, not to raise it.

Every `maxWallClockMs` stays below `AGENT_SANDBOX_LIFETIME_MS` (30 min), so a run's budget expires before its workspace does.

---

## 6. What `launch-v1` deliberately did not change

**Plans and packs.** Free 0 · Builder €19 → 1,000 · Pro €49 → 3,000; packs 500/€12, 1,500/€33, 5,000/€99; welcome 100 Credits, 30 days. No Stripe Price object moves and no published euro figure changes, so the production activation checklist does not reopen. The repricing lands entirely on what a Credit buys.

What a plan now buys, computed rather than typed (and shown on the billing page the same way):

| Plan | Credits | Agent improvements (standard) | or Business Audits |
| --- | ---: | ---: | ---: |
| Builder €19 | 1,000 | 5 | 18 |
| Pro €49 | 3,000 | 15 | 54 |

The welcome grant was checked rather than assumed. 100 Credits no longer covers audit + next moves + plan at the new prices (115) — but `free_audit_grants` already covers a new user's first audit per repository, so the real path is Next Moves (30) + Action Plan (30) = 60, leaving 40. The repricing does not strand a new account.

**`CREDIT_RATE_CARDS`.** The per-SKU consumption card in `rating.ts` stays empty. It answers "what did this provider usage rate to" — credits per token, per millisecond, per byte — for Vibe's internal telemetry, which `economy/` already answers in nanodollars with confidence attached. A card here would also have to price cache tokens (55–70% of agentic provider cost); one that omitted them would correctly return `sku_not_priced`, which is a state with no value in shipping.

**Validation, preview and review.** Bundled into the agent price; their measured cost (~$0.045 + ~$0.022 + browser) is inside the $0.6507. A customer bought a validated improvement, not a pipeline. Line-iteming them would expose Vibe's cost structure as the customer's billing model and make the total price of an improvement unknowable in advance.

---

## 7. What this card is not confident about

Stated once, plainly, rather than qualified in every section above.

1. **`complex` has zero cost observations.** Its 350 Credits is a ratio, formatted identically to two measured numbers. This is the single largest gap between what the table shows and what it can defend.
2. **`small` has one.** Its mean, min and max are the same number.
3. **Deep Scan has none at all**, and unlike the two above, more runs will not fix it — only a browser-provider rate will.
4. **All agent data is `non_production_economics = true`**, against one repository and a narrow set of evidence families.
5. **The 41.7% failure rate is n=12.** A real rate of 30% or 60% would not be a surprise.
6. **Repository size is null for every historical row.** [ECONOMY_MODEL.md](ECONOMY_MODEL.md) showed the same step costing 2× more against a repository that had grown three files; nothing in this card sees that.

`margin-guard.ts` covers what can be covered and `uncoveredPrices()` returns exactly the three amounts it cannot, so a fourth is a decision somebody makes rather than a gap that opens.

---

## 8. Recalibration triggers

Inherited from [CREDIT_PRICING_V1.md](CREDIT_PRICING_V1.md) §Recalibration and still the right list.

- **On the first `complex`-tier run** — standing item, regardless of count. Worth more than the next twenty `standard` runs.
- **On a founder-attested browser rate** — moves Deep Scan from `policy` to `measured`, and is the only thing that can.
- **After 25 delivered agent runs** — re-run `analyzeClassCostDifferentiation`; enough to put a real spread on `small`.
- **After 50** — re-run `computeHistoricalFailureEconomics` against production rather than dogfood behaviour.
- **After 100** — full stress test against the observed class distribution.
- **On any upstream rate change** — `ai/pricing.ts` or an infrastructure rate. This one no longer needs remembering: `margin-guard.test.ts` fails on the day it lands.
- **On the first run recording repository size** — correlate model spend against `repo_tree_entries` and `context_candidates_available`. Answers whether a flat per-class price silently cross-subsidises large repositories.
