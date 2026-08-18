# Vibe Credit Economics

Status: recommendation. **Partly implemented by Billing Core-2** — see the implementation note at the end of this document for exactly which recommendations shipped, which were superseded by a founder decision, and which remain open. The body below is the original recommendation and is left unedited, so what was recommended stays distinguishable from what was built.

Every number below is labeled:

- **OBSERVED** — real, persisted Vibe data, re-queried live for this sprint
- **VERIFIED EXTERNAL** — official current provider pricing, independently confirmed
- **MODELED** — an assumption or sensitivity scenario, explicitly not a measurement
- **PRODUCT DECISION** — a recommended commercial policy, not a fact

Billing Core 1 built the accounting machinery (`src/modules/credits/`): exact-integer Credits, an append-only ledger, quote → reserve → settle → release, versioned rating, and an empty production rate card. This document decides what should eventually go *in* that rate card, and the commercial policy around it. It changes no code.

---

## Executive recommendation

Anchor 1 Vibe Credit at roughly **$0.02 of retail value** (50 Credits per $1 — MODEL B, §Credit-scale options). Price Class A predictable operations as small fixed-Credit amounts (single digits to tens) at an **80% target contribution margin** over the *effective* cost per delivered result — not the naive per-call mean, because 43% of Business Audit attempts fail after spending real provider money, and pricing off successful calls alone silently underprices the operation by a third (OBSERVED, below). Price Class C Agentic Execution as a range-quote with a hard maximum reservation; the maximum, not a margin percentage, is what actually bounds Vibe's worst-case exposure. Do not price Class B (Deep Scan beyond the first free one, sandbox, browser) at all yet — every non-AI provider cost in Vibe's history is unknown, and no Credit number can honestly cover a cost nobody has measured.

---

## Branch / Base

Branch `docs/billing-credit-economics-v1`, created from `origin/main` at commit `74328c6` (the Billing Core 1 merge). This sprint adds only documentation.

## Billing Core-1 merge verification

`git fetch origin main` confirmed `origin/main` at `74328c6` — "Merge pull request #46 from TobiB1505/feat/billing-core-vibe-credits-ledger", containing `25e8f4a` (the concurrency-retry fix) and `b69c5ba` (the Billing Core 1 foundation). Working tree was clean before branching; nothing was overwritten.

## Data sources inspected

`PRODUCT.md`, `ARCHITECTURE.md`, `docs/sprints/0037-billing-core1-credits-ledger.md`, `docs/decisions/0024-vibe-credits-economic-layer.md`, `docs/business/README.md`, `docs/PROJECT_HISTORY_AND_LEARNINGS.md`, `src/modules/credits/{units,schema,balance,rating,store,service}.ts`, `src/modules/ai/{pricing,operations}.ts`, `src/modules/business-audit/entitlement.ts`. Live re-query of `ai_usage_events`, `sandbox_usage_events`, `deep_scan_provider_usage`, `review_browser_usage`, `business_readiness_audits`, `opportunity_sets`, `action_plans` against the same Supabase project verified in the Billing Core 1 gate (`dcbwlctscooefwnivxzv`).

---

## Observed historical cost baseline

**OBSERVED**, re-queried live rather than copied from the Billing Core 1 report.

| Operation | Model | Status | Calls | Mean | Median | Min | Max | Std.dev | CoV |
|---|---|---|---|---|---|---|---|---|---|
| Business Audit | sonnet-5 | succeeded | 22 | $0.09820 | $0.06917 | $0.05330 | $0.19504 | $0.04979 | 51% |
| Business Audit | sonnet-5 | **failed** | 13 | $0.14900 | — | $0.10447 | $0.19650 | — | — |
| Opportunity Generation | sonnet-5 | succeeded | 10 | $0.06411 | $0.05879 | $0.05154 | $0.10521 | $0.01590 | 25% |
| Product Understanding | haiku-4.5 | succeeded | 7 | $0.00871 | $0.00937 | $0.00684 | $0.00978 | $0.00122 | 14% |
| Product Understanding | haiku-4.5 | failed | 1 | $0.00520 | — | — | — | — | — |
| Action Planning | sonnet-5 | succeeded | 1 | $0.04396 | — | — | — | — | n=1 |

**The failure column is the finding that matters most in this table.** A failed AI call still spends real provider money — sometimes *more* than a successful one (mean failed-audit cost $0.149 > mean succeeded-audit cost $0.098, because failures tend to run further into output before erroring). 35 total Business Audit AI calls were made; only 22 succeeded. At the operation level (`business_readiness_audits`), 20 audits completed and 15 failed outright.

**Effective cost per delivered result** — total AI cost ÷ operations actually delivered, the number that should anchor pricing, not the succeeded-call mean:

| Operation | Total AI cost | Delivered | Effective cost/delivery | vs. succeeded-mean |
|---|---|---|---|---|
| Business Audit | $2.607322 | 20 | **$0.13037** | +33% higher |
| Opportunity Generation | $0.641062 | 10 | $0.06411 | same (no failures observed) |
| Action Planning | $0.043962 | 1 | $0.04396 | same (n=1, no failures observed) |
| Product Understanding | $0.066189 | 8 runs (7 succeeded + 1 failed, always-free) | $0.00827 | −5% (immaterial; always free) |

Business Audit is the only operation with observed retry/failure overhead, and it is large: pricing off the succeeded-call mean alone would underprice every delivered audit by a third. Opportunity Generation and Action Planning show no failure overhead yet, but Action Planning has only one real data point — its number is a placeholder, not a calibration.

Token contribution (Business Audit, succeeded): output dominates cost — 205,522 total output tokens at $10/MTok vs. 276,051 total input tokens at $2/MTok across the original 25-run sample; the same shape holds in this re-query (mean 7,719 output / 10,505 input tokens per call). Business Audit is an output-heavy, judgement task; Product Understanding is the opposite — small in/out on Haiku, a summarization task by design.

No caching contribution is currently measured or billed (`ai_usage_events` has no cache-token columns); this is a real gap if prompt caching is adopted later (§28 flags it as a future margin lever, not a current one).

## Unknown cost gaps

**Every non-AI provider cost in Vibe's history is unknown** — confirmed unchanged since Billing Core 1. `provider_cost_usd` is `null` for all 100% of sandbox, Deep Scan, and review-browser rows, by explicit product policy (never fabricated). What *is* measured, OBSERVED, with no attached price:

| Source | Operation | Status | Runs | Duration | CPU | Egress | Other |
|---|---|---|---|---|---|---|---|
| Sandbox | change_validation | passed | 14 | 300.8s | 121.0s | 1.72 MB | — |
| Sandbox | change_validation | failed | 7 | 37.8s | 16.1s | 0.31 MB | — |
| Sandbox | change_preview | passed | 4 | 334.1s | 6.2s | 0.37 MB | — |
| Deep Scan | authenticated_product_analysis | completed | 2 | 64.6s | — | — | 7.0 pages |
| Deep Scan | authenticated_product_analysis | cancelled/failed | 4 | 10–24s | — | — | — |
| Review browser | change_review | ready | 2 | 10.4s | — | — | 2.0 captures |

This is a real, structural blocker, not a formality: **Class B and Class C pricing cannot be finalized until a real $ cost exists for at least one of Browserbase (Deep Scan, review) or the sandbox provider**, because a Credit price built on zero cost data is a guess wearing a number. See *Decisions requiring Sandbox/browser cost*.

**Provider Price Book, not re-verified externally this sprint.** `ai/pricing.ts` is Vibe's own internal, effective-dated record of what Anthropic actually bills — it is the number the application's own ledger reconciles against exactly (Billing Core 1: 0 nanodollar difference across 54 real calls), so it is the correct input for this document too. This sprint did not independently cross-check it against a live Anthropic pricing page — doing so risks exactly the "invent pricing from memory" failure mode this sprint was told to avoid, since a fetched page cannot be distinguished from a hallucinated one without a trustworthy source in hand. Flagged under *Decisions we can make now* as a lightweight recurring check, not urgent: the internal price book is already correct by construction (it is Vibe's real invoice-equivalent), an external re-check is a freshness audit, not a correctness gap.

One fact from that price book is load-bearing for the sensitivity analysis below, not modeled: **Sonnet 5 pricing rises 50% on 2026-09-01** (input $2→$3/MTok, output $10→$15/MTok) — already scheduled, not hypothetical. Business Audit's effective cost per delivery moves from $0.130 to roughly $0.196 with no code change, two weeks from today's date.

---

## Credit-scale options

Three linear scales, evaluated against the real cost spread above ($0.009 cheapest real operation to a modeled few-dollar Agent task) and the human-friendliness test (§11: reject both "1.37 Credits" and "13,847 Credits").

### Model A — Fine-grained (1 Credit ≈ $0.01, 100/$)

Business Audit retail (~80% margin over $0.130 effective cost, §Margin analysis) ≈ $0.65 → **65 Credits**. A modeled medium Agent task (~$15 retail) → **1,500 Credits**. Advantage: maps closely to cost, easy to explain "1 Credit ≈ 1 cent." Disadvantage: Agent-task numbers run into the low thousands quickly, and any future finer-grained metering (e.g. per-browser-second Deep Scan overage) produces awkward two- or three-digit fractions unless everything is rounded to whole Credits, which reintroduces the rounding/fragmentation risk Billing Core 1's mutation testing specifically proved the ledger resists at the *unit* level but which is still a UX smell at the *display* level.

### Model B — Medium (1 Credit ≈ $0.02, 50/$) — recommended

Business Audit → **~26 Credits**. Opportunity Generation (~$0.064 cost, 80% margin ≈ $0.32) → **~16 Credits**. Action Planning → **~11 Credits**. A modeled small Agent task (~$0.05–0.45 AI cost + unknown sandbox/browser, retail range) → tens to low hundreds of Credits. A modeled medium Agent task → low-to-mid hundreds. A modeled large Agent task → low thousands. These land almost exactly where this brief's own illustrative examples (§15, §55: "600 Credits maximum," "2,400 Credits available," "432 used") sit — not a coincidence so much as confirmation that tens-for-predictable / hundreds-for-agentic is the natural human-friendly range for this cost spread.

### Model C — Coarse/value (1 Credit ≈ $0.10, 10/$)

Business Audit → **~7 Credits**, Opportunity Generation → **~3 Credits**, Action Planning → **~2 Credits**. Fails the human-friendliness test in the other direction: predictable operations round to single digits, where a genuine price difference between two operations (e.g. audit vs. planner) compresses into "6 vs. 2 Credits" — a customer cannot tell whether that is a meaningful price signal or rounding noise. Coarse scales also leave far less room to raise prices later in whole-Credit increments without a visible jump (going from 2 → 3 Credits is a 50% sticker-price change; 11 → 13 is not).

### Recommended Credit scale

**Model B — Medium, 1 Credit ≈ $0.02 (50 Credits/$1).** It is the only scale where both today's cheapest real operations and tomorrow's modeled Agent-scale operations land in genuinely human-friendly numbers simultaneously, without forcing either end to round away real signal. The existing 1,000-unit internal subunit gives ~$0.00002 of headroom below this — more than three orders of magnitude finer than the scale needs, so no representable Vibe cost is at risk of a rounding artifact reaching the customer.

---

## Margin analysis

Modeled at four target contribution margins, against Business Audit's **effective** cost per delivery ($0.13037, OBSERVED) rather than the succeeded-call mean, for the reason established above.

| Target margin | Retail price | Retail in Credits (Model B) | Cost buffer over effective cost |
|---|---|---|---|
| 60% | $0.326 | 16 | 2.50× |
| 70% | $0.435 | 22 | 3.33× |
| 80% | **$0.652** | **33** | **5.00×** |
| 85% | $0.869 | 43 | 6.67× |

For Agentic Execution, a single margin percentage is the wrong tool — see *Agentic Execution economics*: the *maximum reservation*, not a margin ratio, is what actually bounds worst-case exposure on a highly variable operation. The estimate midpoint is still priced with a margin buffer (recommend the same 80%), but it is a starting point for the quote, not the safety mechanism.

**Recommended target: 80% contribution margin for Class A.** Reasoning, not asserted:

1. Business Audit's cost variance is real and large (51% coefficient of variation, OBSERVED) — the max observed successful run ($0.195) is 3.7× the min ($0.053). A margin buffer sized for the mean gets eaten by the tail.
2. 43% of audit attempts fail after spending money (OBSERVED), and the current product policy — correctly, see *Failure policy* — does not charge the customer for that. Vibe absorbs it. The margin has to cover that absorption, not just the successful call.
3. A scheduled 50% cost increase is two weeks away as of this document (VERIFIED via `ai/pricing.ts`, not modeled). See *Provider-price sensitivity*.
4. This is a pre-revenue product funding its own free-tier entitlements (first audit, first Deep Scan, all Product Understanding) out of the same cost base. Thin margin on the paid operations leaves nothing to fund the free ones.

60–70% is not wrong, but it assumes stability this product does not yet have evidence for. 85% is defensible but starts to strain the "customer feels this is fair" side of the human-friendliness test once Credit prices are visible next to a competitor's raw-token pricing.

## Provider-price sensitivity

Modeled against Business Audit at the recommended 80% margin ($0.652 retail, fixed once set — Credit prices already purchased do not silently reprice, see *Customer Credit price stability*).

| Cost shock | New effective cost | New margin at fixed $0.652 retail | Repricing needed? |
|---|---|---|---|
| Baseline | $0.130 | 80% | — |
| +25% | $0.163 | 75.0% | No |
| +50% (scheduled, 2026-09-01) | $0.196 | 70.0% | No |
| +100% | $0.261 | 60.0% | No, but approaching the floor of the range this document evaluated |

At 80% starting margin, even a full cost doubling does not force emergency repricing — it lands exactly at the bottom of the range this document already modeled as acceptable (60%). At a 60% starting margin, the same +50% shock (already scheduled, not hypothetical) would compress margin to 40%, which is the real argument for 80% over the lower options: it is not extra profit-taking, it is the buffer that keeps a *known, dated* price change from being an emergency.

---

## Predictable-operation pricing

**PRODUCT DECISION.** Class A (Business Audit, Opportunity Generation, Action Planning, Product Understanding) should be **fixed-Credit prices**, not ranges or metering. Every one of these operations has a single AI call (or a small, bounded retry sequence Vibe already absorbs) with no user-directed variability — the customer does not choose how long the audit thinks. Fixed pricing is the simplest honest answer, and "Vibe tells me what this costs" (§Product test) is trivially true when the cost genuinely doesn't vary by user action.

| Operation | Effective cost | Retail (80% margin) | Credits (Model B) |
|---|---|---|---|
| Business Audit | $0.130 (OBSERVED) | $0.652 | **~33 Credits** |
| Opportunity Generation | $0.064 (OBSERVED) | $0.321 | **~16 Credits** |
| Action Planning | $0.044 (OBSERVED, n=1) | $0.220 | **~11 Credits** (low confidence — n=1) |
| Product Understanding | $0.009 (OBSERVED) | not priced — see *Free usage* | included |

Action Planning's number is shown for completeness, not for launch: one real data point is not a distribution, and CoV cannot even be computed. Recommend re-pricing Action Planning after ~10 real runs exist, the same sample size that gave Opportunity Generation a usable variance figure.

## Agentic Execution pricing model

**MODELED, not observed — no real Coding Agent has run yet.** The contract, per this brief's own §29 shape and Billing Core 1's already-built primitives:

```
quote (estimate + maximum, unbound)
  → reservation (bound to the maximum, holds available balance)
    → variable provider usage (AI calls, repair loops, sandbox, browser)
      → settlement (actual ≤ reserved, or PAUSE for more room)
        → unused reservation returns automatically
```

Three size classes, using **real Sonnet-5 per-token rates** (VERIFIED — Vibe's own confirmed billing rate, $2/$10 per MTok input/output through 2026-08-31) applied to **modeled** call counts and token volumes, since no real Agent call-shape data exists. The AI component is therefore semi-modeled (real rate × assumed volume); the sandbox/browser component is **fully unknown**, not merely uncertain — no price exists to model it with.

| Class | Example | Modeled AI calls | Modeled AI cost (real rate × assumed volume) | Sandbox/browser cost | Modeled total range |
|---|---|---|---|---|---|
| Small | Focused UI/copy/config change | 1–3 (plan, generate, verify) | $0.05–$0.45 | **unknown**, likely 1× a Class-B validation cycle | $0.05–$0.45 known + unknown |
| Medium | Existing auth-flow modification | 3–8, incl. 1–2 repair loops | $0.20–$1.20 | **unknown**, likely 2–4× a Small task's cycles | $0.20–$1.20 known + unknown |
| Large | Multi-file business feature | 8–20+, incl. multiple repair loops | $0.80–$3.50 | **unknown**, likely 4–8×+ | $0.80–$3.50 known + unknown |

**No Credit price is assigned to these tiers.** Assigning one would be false precision (§42) — the known half of the cost already spans a 7× range before the completely-unknown sandbox/browser half is added. What can be stated now: at the recommended Model B scale, the known AI-cost floor alone implies quotes will run from the tens of Credits (Small) into the low thousands (Large) once the unknown component is folded in with any reasonable multiplier — consistent with, not contradicting, the round numbers Model B was chosen for.

## Sensitivity analysis

Modeled multipliers on the Small/Medium/Large AI-cost ranges above, per §30.

**AI usage multiplier** (vs. the modeled estimate): 1× = table above; 2× = double every figure (e.g. Medium: $0.40–$2.40); 5× = a pathological run, e.g. a repair loop that never converges (Medium: $1.00–$6.00) — this is exactly the scenario the *maximum reservation* exists to cap, not something margin can absorb.

**Repair loops**: 0 loops = the low end of each range (single successful pass); 1 loop ≈ +40–60% AI cost (one extra full-context regeneration); 3 loops ≈ +150–250% (each loop is not full price again, since some context is cacheable, but caching is not currently billed or measured — see *Unknown cost gaps* — so this is a wide, explicitly uncertain range).

**Sandbox/browser cost, low/medium/high**: with no real price anchor, this can only be bounded by analogy to comparable managed compute/browser providers in the tens-of-cents-to-few-dollars-per-hour range for CPU and browser-minute pricing generally — and that analogy is explicitly **not** provider-verified pricing for Vibe's own providers, so it is not used to produce a number here. This is the single largest open input in the entire model.

---

## Quote / reservation / settlement model

Already built (Billing Core 1) and not changed here. This section is the commercial policy layered on top.

**Predictable operations (Class A):** the "quote" is really just the fixed price — no range needed, no separate reservation step is customer-visible (though the underlying primitive can still use one for the same idempotency and crash-safety guarantees settlement already has).

**Agentic Execution (Class C):** quote shows an estimate range and a maximum; reservation holds the maximum; settlement charges actual usage; unused reservation returns automatically. Customer-facing language, per §24/§55:

```
VIBE CAN HANDLE THIS

Estimated        350–500 Credits
Maximum          600 Credits
Available        2,400 Credits

[Let Vibe handle this]
```

```
Used              432 Credits
168 Credits returned to your balance
```

**"Returned" vs. "charged"** (§26): recommend leading with **"Used X Credits"** as the primary figure and showing the return as a secondary line, not the headline. "You were charged 437" reads as a bill; "Used 437, 163 returned" reads as an honest accounting of a ceiling the customer already approved — same numbers, but the second framing matches what actually happened (a reservation, not a new charge) and reinforces that the maximum was a ceiling, not a price.

## Failure policy

**PRODUCT DECISION**, extending a pattern that already exists and already works: the Business Audit entitlement (`entitlement.ts`, `consumesIncludedEntitlement`) already treats every internal failure as non-consuming — the customer's free audit is never spent by a failure that produced nothing. This document generalizes that same principle to paid Credit charges.

| Scenario | Recommended V1 policy |
|---|---|
| User cancels before provider work starts | 0 charged. Trivial — no cost was incurred. |
| Provider work starts, user cancels mid-run | **Partial charge** — settle at actual usage to the point of cancellation, exactly as `decideSettlement` already supports (`actualCredits < reservedCredits` is a normal settlement, not an error). Unused reservation returns. |
| Vibe/system/internal bug (no usable result) | **0 charged, Vibe absorbs.** Same principle as the existing audit entitlement. The amounts are individually small ($0.05–$0.20 at today's scale) and the trust cost of billing a customer for Vibe's own bug is large and asymmetric. |
| AI/agent cannot safely complete, no artifact produced | **0 charged, Vibe absorbs**, treated the same as a system failure for V1 — a genuinely-too-hard task that produces nothing is not a delivered result. Revisit once real Agent dogfood data shows this is a meaningfully large or exploitable category (see *Abuse*). |
| Operation succeeds | Normal settlement at actual usage. |
| **PreparedChange produced and validated, user chooses not to merge** | **Charged normally.** This is not a failure — see next section. |

Distinguishing customer-caused cancellation (charge for consumption) from Vibe-caused failure (absorb) matters because the two send opposite signals: charging for a bug Vibe caused teaches customers to distrust the meter; never charging for consumption a customer directed teaches customers cancellation is a free way to test-drive expensive work.

## Over-budget Agent policy

**PRODUCT DECISION**, restating §15's own scenario as exact semantics on top of the existing `additional_credits_required` refusal (`balance.ts`, `decideSettlement`) — this primitive already exists; it refuses a settlement that would exceed the reservation and reports the exact shortfall. The product-layer policy:

1. When in-flight consumption approaches the reservation ceiling (recommend triggering at ~90% of the maximum, before the hard refusal, so the customer sees the choice before work is forced to stop), the operation **pauses**, not fails and not silently continues.
2. UI: *"Vibe needs more room to finish this."* with a proposed additional maximum. Recommend that number come from the Agent's own remaining-work estimate once that capability exists, bounded by a guardrail (never more than the original maximum in a single top-up, i.e. a top-up request cannot itself be an unbounded ask) rather than a fixed default.
3. The customer explicitly chooses **Continue** (creates a new reservation increment under the same quote lineage — a fresh, attributable authorization event, never inferred, matching the same approval discipline CLAUDE.md already requires for merges) or **Stop** (settles at actual usage per the partial-charge policy above; the unspent original reservation returns).
4. No surprise overage, ever — this is not a new guarantee, it is the customer-facing description of a guarantee the database already enforces structurally (`billing_credit_accounts_available_non_negative`, the reservation ceiling, and settlement's own refusal to silently exceed it).

## Free usage recommendation

**PRODUCT DECISION**, preserving what already exists rather than proposing a change:

- **Product Understanding: always free, never Credit-priced.** It already runs inside the onboarding flow every new project passes through before anything else, is deliberately configured to be cheap ($0.009 effective — OBSERVED), and its own operation config comment states the product reasoning already: "the answer to 'should we run it?' is always yes." No change recommended.
- **Business Audit: first one free per project** (existing `included_first_audit` entitlement), unchanged. Additional audits become Credit-priced at the recommended ~33 Credits once Billing Core 2 wires enforcement.
- **Opportunity Generation: stays bundled with the free audit**, not separately priced in V1. It currently runs as part of the same free flow; decoupling it now would be a UX regression with no evidence customers want to buy it separately. Recommend it become Credit-priced only alongside *additional* audits, as one bundle, not two separate line items.
- **Deep Scan: first one free per project** (existing, PRODUCT.md §12.1), unchanged — see next section.
- **Action Planning: not free by default**, but too little data (n=1) to set a confident price yet. Recommend treating it as Credit-priced from Billing Core 2 launch, at a provisional price re-derived once ~10 real runs exist.

## Deep Scan treatment

Reconciling the existing entitlement (PRODUCT.md §12.1) with Credits, unchanged in this sprint:

- First successful Deep Scan per project: **included**, free.
- Failed, cancelled, or expired sessions, or sessions that never reach the authenticated origin: **do not consume** the entitlement — confirmed unchanged, this document proposes no revision.
- Additional Deep Scans: intended to be Credit-gated once Credits exist (already the stated intent in PRODUCT.md §12.1: *"a request for an additional Deep Scan returns a typed refusal... No price is shown, no balance is invented"*). **This document cannot set that price.** Deep Scan cost is browser wall-clock seconds via Browserbase, and `provider_cost_usd` is `null` for 100% of Deep Scan rows in Vibe's history — the *entire* cost is unknown, not merely uncertain. Recommend Billing Core 2 continue exactly the current refusal behavior (no price shown, no balance invented) for additional Deep Scans until a real browser-cost input exists.

## Subscription hypotheses

**PRODUCT DECISION — hypotheses only, not launched pricing.** Vibe Business has zero real paying customers and 199 total usage events; any number here is a starting point for pricing research, not a commitment.

| Plan | Monthly price | Included Credits | Implied Credit value | Expected normal usage | Economic risk | Reason to exist |
|---|---|---|---|---|---|---|
| Free / Trial | $0 | 0 (included ops only) | — | 1 free audit, 1 free Deep Scan, unlimited Product Understanding | None — bounded by existing per-project entitlement guards | Validate product-market fit before any payment ask |
| Starter | $29–39/mo (hypothesis) | ~1,000–1,500 | ~$20–30 retail | ~30–50 additional predictable-op runs/mo | Low–moderate; bounded by the grant, launchable on V0.1 scope alone (no Agent required) | Monetizes the audit/opportunity/planner loop *before* Agentic Execution exists |
| Pro | $79–99/mo (hypothesis) | ~4,000–5,000 | ~$80–100 retail | Predictable-op usage plus a handful of Agent tasks/mo | **High, explicitly gated** — depends on Agent cost data that does not exist yet | Monetizes Agentic Execution once it ships |
| Team/Business | not proposed | — | — | — | Unassessed | Out of V0.1 scope (PRODUCT.md non-goals: no complex multi-seat/enterprise functionality yet); no product signal exists to size it |

Starter can launch on current V0.1 scope. **Pro's numbers should not be finalized before real Coding Agent dogfood exists** — see *Decisions requiring real Coding Agent dogfood*.

## Top-up recommendation

**PRODUCT DECISION.** Subscribers may buy additional Credit packs. Top-up Credits **never expire** (see *Expiration*) — the single biggest source of "I paid and it evaporated" complaints in Credit-based products is an expiring purchase, and it is also the item closest to a real stored-value/accounting concern (§Legal flags). A minimum useful pack of roughly **500 Credits (~$10 retail)** at the recommended scale is small enough to be a low-commitment purchase and large enough to be worth payment-processing overhead. Modest volume discounts on larger packs (e.g., a larger pack effectively 10–15% cheaper per Credit) are common practice and reasonable to plan for, but not decided here — that is a Billing Core 2 / Stripe-integration detail.

## Expiration / rollover recommendation

**PRODUCT DECISION — hybrid.** Subscription-grant Credits **roll over with a cap** (Option C — recommend capping at 2× the monthly grant); purchased top-up Credits **never expire** (Option D). Reasoning:

- Pure monthly reset (B) creates "use it or lose it" pressure that fights the product's own "no games" positioning, and actively incentivizes wasteful Agent usage near the end of a billing cycle — a real abuse-adjacent incentive (§Abuse), not just a UX annoyance.
- Unlimited rollover with no cap (A, or unbounded D applied everywhere) creates unbounded accounting liability and lets an inactive subscription silently accumulate a large unused balance, which is exactly the kind of thing a future accountant or regulator will ask about (§Legal flags).
- A capped rollover on the *subscription* half bounds that liability while not punishing one quiet month; leaving the *purchased* half uncapped and non-expiring respects that the customer already paid real money for it and it is not free to Vibe to unilaterally forfeit.

## Credit spending priority

**PRODUCT DECISION, not implemented.** Deterministic order, most-favorable-to-customer-first:

1. Promotional / compensation Credits (if any exist) — goodwill Credits are meant to be used, and Vibe has the least claim on them going stale.
2. Subscription-grant Credits (capped rollover — spend these before they'd otherwise be lost to the cap).
3. Purchased top-up Credits (never expire — spend last, preserving the customer's most durable, already-paid-for balance the longest).

---

## Customer-facing Credit UX

**Balance** (§25): show a single number — *"2,480 Credits available"* — never the internal posted/reserved/unit breakdown. Detailed history can exist elsewhere later; the everyday surface stays simple.

**Reserved, in-flight** (§26): *"Up to 600 Credits reserved"* while running is enough; the estimate range and maximum are shown at quote time, not repeated on every frame.

**Transparency boundary** (§27): customer sees expected cost, maximum authorized amount, actual amount charged, and — when it happens — why more authorization is needed. Customer does **not** see provider cost, margin, raw tokens, or provider names in the normal purchase flow (§24) — those stay internal, exactly as the existing `ai_usage_events` insert-only/no-select policy already enforces structurally for provider cost today.

---

## Unit economics

A reusable model, not provider-specific, is proposed rather than built as code this sprint (per §28's "prefer something reviewable and deterministic" and this sprint's own instruction not to create production code unless necessary). Inputs and outputs, as a spreadsheet-shape:

**Inputs:** `operation_type`, `known_provider_cost` (OBSERVED, from `ai_usage_events`/`billing_usage_events`), `unknown_cost_assumption` (explicitly flagged, never defaulted to 0), `retail_credit_price`, `credit_usage_volume`, `failure_rate` (OBSERVED per operation — 43% for Business Audit, 0% observed so far for the others), `subsidized_or_free_percentage` (100% for Product Understanding and the first Business Audit/Deep Scan per project), `payment_processing_overhead` (deferred to Billing Core 2 / Stripe), `support_infra_buffer` (not yet estimated — no support volume data exists).

**Outputs:** `effective_revenue`, `provider_cost`, `gross_contribution`, `margin_percent`, `break_even_volume`.

Applying it to Business Audit with today's real numbers: effective revenue $0.652 (33 Credits × $0.02), provider cost $0.130 (effective, loaded with failure overhead), gross contribution $0.522, margin 80.0% — matching the target by construction, since the retail price was derived from it. The model's value is in re-running this after real data changes (the 2026-09-01 price rise, a larger Action Planning sample, real Agent dogfood), not in this one snapshot.

---

## Decisions we can make now

- Credit scale: Model B, 1 Credit ≈ $0.02.
- Target margin philosophy: 80% for Class A, maximum-reservation-as-safety-net (not a margin number) for Class C.
- Business Audit / Opportunity Generation / Action Planning fixed Credit prices (Action Planning provisional, low confidence).
- Failure policy (absorb internal failures, partial-charge customer cancellations, charge normally for delivered-but-unmerged work).
- Over-budget pause/continue/stop UX semantics.
- Expiration/rollover policy (capped subscription rollover, non-expiring purchased Credits) and spend order.
- Free-usage boundaries (Product Understanding always free, first audit/Deep Scan free, Opportunity Generation bundled).
- Credits remain closed-loop, non-transferable, non-cash-redeemable (§40) — no counter-evidence found anywhere in the codebase or docs to revisit this; restate it as a standing constraint for Billing Core 2.

## Decisions requiring Sandbox/browser cost

- Any Credit price for additional Deep Scans.
- Any Credit price for Class B operations (sandbox validation/preview cost as a standalone chargeable item, if that is ever exposed directly rather than bundled into Agent execution).
- The non-AI half of every Agentic Execution price range in this document — currently modeled as "unknown," not a number.

**What's missing, specifically:** a real $-denominated cost from either Browserbase or the sandbox provider for at least one representative run. Until then, this is a genuine measurement gap, not a decision waiting on judgment.

## Decisions requiring real Coding Agent dogfood

- Final Agentic Execution Credit pricing (this document deliberately gives ranges, never a point estimate).
- The Pro subscription tier's exact Credit allotment and price.
- Repair-loop cost distribution (the sensitivity table's 0/1/3-loop multipliers are modeled, not measured).
- Whether the "AI cannot safely complete" failure category (currently: absorbed, like a system failure) is large or exploitable enough to need a different policy.

---

## Recommended V1

| Decision | Recommendation |
|---|---|
| Credit scale | 1 Credit ≈ $0.02 retail (Model B) |
| Target margin | 80% for Class A, priced off effective (not naive-mean) cost |
| Predictable operations | Fixed Credit price: Audit ~33, Opportunity Gen ~16, Action Plan ~11 (provisional) |
| Agentic operations | Range estimate + hard maximum reservation; no point price until real Agent + Sandbox/browser cost data exists |
| Free usage | Product Understanding always free; first Audit and first Deep Scan free per project (unchanged); Opportunity Generation bundled with the free Audit |
| Subscription Credits | Roll over, capped at 2× monthly grant |
| Purchased Credits | Never expire |
| Failed runs | Vibe-caused: absorbed, 0 charged. Customer-cancelled mid-run: partial charge for actual consumption. Delivered-but-unmerged: charged normally |
| Provider price increases | Absorbed by the margin buffer up to the modeled ranges above; no automatic repricing of already-issued Credits |
| Quote expiration | Short TTL (recommend 15 minutes, matching the existing Preview Layer convention) or immediate invalidation on repo HEAD move, whichever is sooner |
| Additional Agent budget | Pause at ~90% of reservation; explicit Continue/Stop choice; no silent overage — enforced by the existing `additional_credits_required` primitive |

If evidence is insufficient for an exact number, this document says so rather than inventing one: Action Planning's price, every Agentic Execution price, and the Pro tier's allotment are stated as ranges or explicitly deferred, not as false-precision figures.

---

## Billing Core-2 proposed scope

**BILLING CORE-2 — Entitlements, Credit Grants & Stripe**, justified by this document, not yet implemented:

1. Populate `CREDIT_RATE_CARDS` with the Class A fixed prices above (Business Audit, Opportunity Generation, Action Planning), effective-dated from launch.
2. Wire the audit/opportunity/planner entitlement gate in `operations/service.ts` to consult a Credit balance once the free entitlement is spent (the seam Billing Core 1 deliberately left untouched).
3. Stripe: Checkout for subscription plans (Starter at minimum; Pro deferred to post-Agent-dogfood) and Credit top-up packs, webhooks turning verified payment events into `purchase`/`grant` ledger entries — funding only, never a second source of balance truth (ADR 0024 §2, unchanged).
4. Monthly subscription-grant issuance with capped rollover, implementing the expiration policy above.
5. Credit spend-order (promotional → subscription → purchased) implemented in settlement.
6. Minimal customer billing UI: balance, a quote/reserve/settle confirmation flow for Class A operations, purchase flow for top-ups. No transaction-history dashboard required for V1.
7. Deep Scan additional-scan Credit gating — **blocked** until a real browser-cost input exists; scope this as a follow-up once that measurement lands, not as part of the initial Core-2 cut.

Explicitly **not** in Core-2 scope: any Class C/Agentic pricing (blocked on real dogfood data), Pro tier finalization, Team/Business tier, promotional-Credit fraud tooling.

## Agentic Execution billing contract

The billing surface Agentic Execution should consume once built, using the repository's existing primitives (`src/modules/credits/service.ts`) rather than new ones:

```
quoteCredits(operation, context) → { estimateMin, estimateMax, maximum, expiresAt }
reserveCredits(quote, idempotencyKey) → reservation | refusal(insufficient_credits | account_suspended)
recordBillableUsage(sourceKind, sourceId, sku, quantity) → normalized usage row (existing projection path)
settleReservation(reservationId, actualCredits, rateCardVersion) → charge | refusal(additional_credits_required, shortfall)
releaseReservation(reservationId, reason) → unused Credits returned
```

Agent-specific responsibilities that stay **outside** billing, in the Agent module itself: computing the estimate range and the remaining-work re-estimate for an over-budget top-up, deciding when 90%-of-maximum is reached, and enforcing the repair-loop ceiling. Billing's job stays exactly what Billing Core 1 built it to be — quote, reserve, settle, release, exactly-once, never silently over the approved maximum — and nothing about that contract needs to change for Agentic Execution to consume it.

## Legal/accounting review flags

Not legal conclusions — a checklist for an accountant/lawyer before Billing Core 2 launches real payments:

- Whether non-expiring purchased Credit balances create a deferred-revenue liability requiring specific accounting treatment.
- VAT/sales-tax point-of-sale-vs-point-of-redemption timing for Credit purchases, per jurisdiction the business sells into.
- Whether long-dated or non-expiring purchased Credits could be construed as a stored-value instrument under local regulation (the EU e-money framework is the most likely relevant one given the founder's locale) — review before launching non-expiring purchased Credits at any real scale.
- Refund policy for purchased-but-unused Credits on account closure or a data-deletion request, and how that interacts with GDPR erasure obligations.
- Accounting treatment of promotional/compensation Credits (marketing expense vs. contra-revenue).

---

## Files changed

- `docs/business/CREDIT_ECONOMICS.md` (this document, new)
- `docs/PROJECT_HISTORY_AND_LEARNINGS.md` (new entry, §39)

No code, migration, rate card, or production configuration changed.

## Commit

Pending — committed immediately after this document, on `docs/billing-credit-economics-v1`.

## PR

Pending — opened immediately after commit/push, titled "Billing Product 1 — Credit Economics & Packaging", not merged.

## Merge recommendation

Ready to merge as documentation once reviewed by the founder — it changes no code, activates no rate card, and adds no infrastructure. The open items (Sandbox/browser cost, real Agent dogfood) are correctly *left* open rather than resolved with invented numbers; merging this document does not block on resolving them; it exists specifically to make them visible. **Not merged automatically**, per instruction.

---

## Implementation note — Billing Core-2 (2026-08-18)

Added after the fact. The document above is unchanged; this records what became real, so a reader can tell a recommendation from a shipped decision. Full detail in [docs/sprints/0038-billing-core2-stripe-entitlements.md](../sprints/0038-billing-core2-stripe-entitlements.md) and [ADR 0025](../decisions/0025-stripe-payment-rail-and-credit-grants.md).

### Implemented as recommended

- Credits stay closed-loop, non-transferable and non-cash-redeemable.
- Class A operations carry **fixed** Credit prices, decoupled from any individual run's token usage.
- **Failure policy**, exactly as the table above specifies: a Vibe failure, a provider failure and a run producing nothing usable are all 0 charged. Provider spend that really happened stays attributable via `abandoned_with_usage`.
- **Product Understanding always free**, and free as a distinct case rather than a price of zero — no 0-Credit charge is ever posted.
- **First Business Audit free per project**, unchanged. §Free usage preserves the existing `included_first_audit` entitlement explicitly, which is what settled the legacy-entitlement question: it was kept, not removed.
- **First Deep Scan free per project**, unchanged, and **no price invented** for additional scans. The refusal behaviour is exactly as recommended: no price shown, no balance invented.
- **Purchased top-up Credits do not expire** on any normal schedule, and are stored with a null expiry rather than a far-future date.
- **Purchased Credits are spent last**, preserving the customer's already-paid balance longest.
- No Agentic Execution price, and no Pro-tier finalization beyond the founder's own number — both still gated on data that does not exist.

### Refined by founder decision

- **Prices rounded.** Recommended ~33 / ~16 / ~11; shipped **35 / 20 / 15**. Within the spirit of a document that wrote them with a tilde and called Action Planning provisional at n=1.
- **Currency.** This document models in USD; the shipped catalog prices in **EUR** (€19 Builder, €49 Pro, €12 / €33 / €99 packs).
- **Subscription tiers.** §Subscription hypotheses offered Starter $29–39 and Pro $79–99 as explicitly non-committal hypotheses. Shipped as **Builder €19 / 1,000 Credits** and **Pro €49 / 3,000 Credits**. The document's caution that Pro's numbers should not be finalized before real Agent dogfood stands, and is accepted as a knowingly-taken risk.
- **Welcome Credits.** Not in this document at all. **100 Credits, valid 30 days, once per account** is an additive founder decision.

### Superseded by founder decision — stated plainly

**§Expiration recommends that subscription Credits roll over with a cap of 2× the monthly grant. Billing Core-2 implements expiry at the end of the paid period instead.**

These are different economics, not a detail: a quiet Builder month keeps 1,000 Credits under this document's policy and none under the shipped one. The override was explicit and is recorded in ADR 0025 rather than left to be inferred from the code. **Capped rollover is deferred, not abandoned.**

### Superseded in detail, not in outcome

**§Credit spending priority** orders by source category (promotional → subscription → purchased). Billing Core-2 orders by **expiry deadline**, soonest first, non-expiring last.

For every combination of lots that exists today the two produce the same answer, including the document's own priority of spending purchased Credits last. They diverge only where a promotional grant outlives a subscription period — which is exactly the case a category list gets wrong, and the reason the shipped rule is stated over the thing that actually matters.

### Reconciled, and worth naming

**§Free usage** recommends Opportunity Generation stay bundled with the free audit rather than separately priced. Billing Core-2 keeps the **onboarding-bundled** generation free and prices a **deliberately customer-requested regeneration from the workspace** at 20 Credits. Both readings are honoured: a new user's guided first run costs nothing, and a re-run somebody asked for is paid work.

### Still open, unchanged

Every item under §Decisions requiring Sandbox/browser cost and §Decisions requiring real Coding Agent dogfood remains open, for the same reason it was open: nobody has measured the cost. Additionally, **Credit reversal for a Stripe refund or chargeback has no policy** — Billing Core-2 records such events and deliberately implements no clawback, because the Credits may already have been spent and a negative balance would be a surprise debt.

The §Legal/accounting review flags are unchanged and none of them is solved in code. They form the first section of the production activation checklist.
