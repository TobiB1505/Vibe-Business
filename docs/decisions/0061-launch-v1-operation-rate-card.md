# ADR 0061 — What a Credit buys, and what each number is worth trusting

**Status:** Accepted
**Date:** 2026-08-31
**Extends:** [ADR 0024](0024-vibe-credits-economic-layer.md), [ADR 0025](0025-stripe-payment-rail-and-credit-grants.md)
**Satisfies:** [CLAUDE.md](../../CLAUDE.md) rule 78
**Amended by:** [ADR 0062](0062-sonnet-5-price-rise-cancelled.md) — the rate table below is superseded; the reasoning is not

> **[2026-08-31] Correction.** Anthropic withdrew the Sonnet 5 rise to $3/$15 before it took
> effect. Every price in this ADR was derived at those rates and is therefore ~57% too high:
> Business Audit **35** (not 55), Next Moves **20** (not 30), Action Plan **20** (not 30). Deep
> Scan (25) and the agent tiers (150 / 200 / 350) are unchanged. The derivation rule, the
> `PriceBasis` design, the guard, and the argument for pricing at all are unaffected — the input
> changed, not the method. See [ADR 0062](0062-sonnet-5-price-rise-cancelled.md); the current card
> is [CREDIT_RATE_CARD_LAUNCH_V1.md](../business/CREDIT_RATE_CARD_LAUNCH_V1.md). This ADR is a
> record and is left standing as written, including the sentence below asserting the increase
> lands on 2026-09-01, which was true of Anthropic's published schedule on the day it was written.

## Context

The billing machinery has been finished and proven for two weeks: an append-only ledger, grant lots spent expiring-soonest-first, atomic reserve → allocate → settle-or-release, Stripe as a funding rail only, reconciliation activated against production. What was missing was price.

Three facts forced the decision at this particular instant.

**Two of the four price registries shipped empty by design.** `EXECUTION_BUDGET_POLICIES` was `[]`, so `resolveAgentEconomics` returned `null` for every project not on an operator-managed allowlist — no customer could start an agent at all. Deep Scan's `credits_required` refusal had no price behind it, so the freemium upsell PRODUCT.md §12.1 describes was a dead end. The flagship capability and the upgrade path were both unsellable, and had been since they were built.

**Rule 78's bar was met for the first time.** [docs/business/CREDIT_PRICING_V1.md](../business/CREDIT_PRICING_V1.md) returned *"NOT READY TO IMPLEMENT CREDIT RATE CARD V1 — the 'not ready' is about statistical confidence, not about a missing mechanism"*, over a dataset of six delivered agent runs. Production has since recorded sixteen, with nineteen agent sandbox runs and twenty-seven validation sandbox runs beside them.

**Anthropic's Sonnet 5 increase lands on 2026-09-01.** `ai/pricing.ts` has carried `claude-sonnet-5-standard-2026-09` for weeks: +50% on input, output, cache read and cache write alike. Nothing anywhere connected that scheduled fact to what it does to `retail-v1`. At the Pro plan's credit value, 35 / 20 / 15 fall from the ~80% contribution margin they were calibrated to down to roughly 68% — overnight, with no code change, no visible event, and every test still green.

That third fact is the one that decided the timing. A rate card is not a thing you activate when the evidence is perfect; it is a thing you have to have when the costs move.

## The decision

**`launch-v1` in `src/modules/credits/retail.ts` prices every customer-facing operation, and every price carries how it came to be a number.**

It takes effect at `2026-09-01T00:00:00.000Z` — the same instant `retail-v1` closes and the same instant the new Sonnet card begins. One event seen from three sides. A gap between them would be a window in which Vibe knowingly sold below its own standard, and `margin-guard.test.ts` asserts the three instants are equal.

| Operation | `retail-v1` | `launch-v1` | Basis |
| --- | --- | --- | --- |
| Product Understanding | free | free | measured |
| Business Audit | 35 | **55** | measured |
| Next Moves | 20 | **30** | measured |
| Action Plan | 15 | **30** | measured |
| Deep Scan (additional) | — | **25** | **policy** |
| Agent improvement | — | **150 / 200 / 350** by class | **modelled** |

### How the numbers were derived

One rule, applied uniformly, with no per-operation special cases:

```
credits = effective provider cost per DELIVERED result
          ÷ 0.20                     the contribution margin retail-v1 was calibrated to
          ÷ $0.017640                what one Credit is worth on the plan that values it least
          rounded up to the nearest 5
```

The divisor is the Pro plan: €49 ÷ 3,000 Credits = €0.016333, converted at EUR/USD 1.08. Pro is used because it is the *cheapest* way to obtain a Credit — a margin that clears there clears on Builder and on every pack. The FX rate is a stated planning assumption; nothing in this repository observes it, and [docs/business/CREDIT_RATE_CARD_LAUNCH_V1.md](../business/CREDIT_RATE_CARD_LAUNCH_V1.md) records it as such.

"Effective cost per delivered result" means measured spend on *attempts* divided by *deliveries*, never the mean of the successes. A failed AI call still spends real provider money, and the measured mean cost of a failed audit is *higher* than that of a successful one. Pricing against the success mean would hand Vibe a margin it does not have.

### The three kinds of claim, carried by the type

`PriceBasis` is a required field on every entry rather than a docblock, because `launch-v1` contains three genuinely different kinds of statement and a price table gives a reader no way to tell them apart.

- **`measured`** — derived from Vibe's own recorded provider cost for delivered results of that operation.
- **`modelled`** — a ratio against a tier that *was* measured. The Agent is marked this way as a whole, because `standard` carries the entire sample, `small` has exactly one cost observation, and `complex` has **zero**. No run has ever been classified into `complex`; its 350 Credits is a policy judgment wearing the same table format as two measured numbers.
- **`policy`** — a commercial judgment with no measured cost behind it at all. Deep Scan is the only one, and it is the only one it can be: `provider_cost_usd` is null for every row of `deep_scan_provider_usage` and `review_browser_usage`, and no browser-provider rate exists anywhere in this repository.

This is the same discipline `economy/infrastructure-rates.ts` applies with `RateSourceKind` and the economy layer's quote simulation applies with its literal `activated: false`, and it exists for the reason those do: a number that cannot be checked must not look like one that can.

### Agentic execution is priced per class, and the class refuses to be guessed

An agent improvement costs one of three amounts, decided by `classifyExecutionPricingClass` from facts that exist *before* the run — risk class, change kind, Vibe-minted evidence ids, named surfaces. The price is therefore knowable before a cent is spent and cannot move with how inefficiently the agent happened to work, which is exactly what [ADR 0038](0038-economy-intelligence-layer.md) §3 requires of a quote.

`retailChargeFor` **throws** when a class-priced operation is resolved without a class, and `resolveExecutionBudget` requires one with no default. Both are deliberate. Defaulting to `small` would sell every agent improvement at the cheapest price Vibe has while every screen, test and ledger entry continued to look correct — a revenue leak that presents as a working system. Defaulting to `complex` would overcharge just as silently. There is no safe default, so there is no default.

The class is fixed on the immutable `ExecutionSpec` at build time and never re-derived at start time, so a change to the evidence vocabulary cannot re-tier work somebody already authorized.

### Two ceilings per class, answering two questions

`LAUNCH_V1_BUDGET_POLICY` gives each class a budget:

| Class | `maxCredits` | `maxProviderSpendUsd` | turns | wall / sandbox |
| --- | --- | --- | --- | --- |
| small | 150 | $1.30 | 30 | 15 / 12 min |
| standard | 200 | $1.75 | 40 | 20 / 15 min |
| complex | 350 | $3.00 | 60 | 25 / 20 min |

`maxCredits` is the customer's authorization and must equal the retail class price exactly — `checkBudgetBinding` refuses admission unless the reservation covers it, so a mismatch does not undercharge, it makes every run of that class refuse to start for what looks like a billing fault. `maxProviderSpendUsd` is Vibe's stop on its own invoice, sized to a 50% floor margin. The most expensive agent run ever measured is $0.9237 restated at September rates, so `standard` carries roughly 2× headroom over the worst observation rather than over a typical one.

### The dogfood allowlist is checked before production, and that ordering is a decision

`resolveAgentEconomics` used to check production first, on the reasoning that an approved policy should start being returned the day it is added without anybody remembering to reorder the branches. That was right while `EXECUTION_BUDGET_POLICIES` was empty.

It becomes wrong the moment one exists. Production now resolves for every project, so production-first would silently convert the internal dogfood account into a paying customer — the same runs, the same allowlist, now settling real Credits — and leave `EXECUTION_DOGFOOD_BUDGET_POLICIES`, `credits/internal.ts` and `isDogfoodEligibleProject` as unreachable code still describing itself as live.

The dogfood exists to buy cost data without charging anybody, and that purpose outlives the price it made possible. So the allowlist is checked first. What being on it *means* changed: it used to say "let this project run at all", and now says "do not bill this one". An allowlisted project whose dogfood policy has lapsed falls through to production rather than being refused — being on the list must never be a way to lose access.

### An included Deep Scan is still free, and that had to be made true

The first implementation held Credits unconditionally. `authorizeOperationCredits` resolves the retail price of `deep_scan` and knows nothing about entitlements, so a project's *first* Deep Scan — included since Sprint 5 — would have reserved and settled 25 Credits.

`holdDeepScanCredits` takes the access mode `authorizeDeepScan` decided, and an included scan returns without touching the billing machinery. The mode is passed rather than re-derived: whether this scan is the included one was settled from the existence of a persisted snapshot, and a second answer computed elsewhere is exactly how the first one gets contradicted. The audit path has had this shape since Core-2 (`payWithCredits` guards its hold); Deep Scan now matches it.

### `not_priced` is a refusal, and it is not `free`

`RetailPrice` gains a variant that looks redundant and is not. `retail-v1` genuinely sold neither Deep Scan nor the Agent, and recording that as `not_priced` rather than omitting the key is what makes a charge dated inside that window answerable — *"retail-v1 had no price for it"*, not *"somebody forgot to add one"*.

Collapsing it into the existing `free` path would run the most expensive operation Vibe has for nothing, under a policy that never sold it. The old `chargeFor` returned `null` for both cases and its own comment said so; that was safe only while the operations that could be unpriced could not reach it. Under `launch-v1` they can.

### Plans and packs do not move

Free 0 · Builder €19 → 1,000 · Pro €49 → 3,000; packs 500/€12, 1,500/€33, 5,000/€99; a welcome grant of 100 with 30-day expiry. All unchanged.

This is what makes the change safe to ship. No Stripe Price object moves, no published euro figure changes, and the production activation checklist in [Sprint 0038](../sprints/0038-billing-core2-stripe-entitlements.md) does not reopen. The repricing lands entirely on what a Credit buys — which is the variable Vibe controls, and the one the provider moved.

The welcome grant was checked rather than assumed: a new user's first audit per repository is already covered by `free_audit_grants`, so 100 Credits still funds Next Moves (30) and an Action Plan (30) with 40 left over. The repricing does not strand a new account.

### `CREDIT_RATE_CARDS` stays empty

The per-SKU consumption card in `rating.ts` is untouched, and that is not an oversight. It answers a different question — *what did this provider usage rate to*, in credits per token, per millisecond, per byte — and it exists for Vibe's internal cost telemetry, not for a customer's bill. `economy/` already answers that question in nanodollars, over real rows, with confidence attached. A card here would also have to price cache tokens, which are 55–70% of agentic provider cost; one that omitted them would return `sku_not_priced` rather than charge zero, which is correct behaviour and an unhelpful state to ship into.

## Consequences

**A customer can buy an agent improvement and an additional Deep Scan.** Both were built and neither was sellable.

**The next upstream rate change is a red test.** `credits/margin-guard.ts` recomputes every price's contribution margin from `calculateProviderCost` and the founder-attested sandbox rates *at the instant it is asked*, applied to frozen production token and duration profiles, and fails below a 70% floor. Quantities frozen, prices live: freezing the cost would make it a tautology, floating the quantity would make it a report on last week's traffic. This is the artifact that would have caught the situation this ADR was written in.

**It computes and reports; it never prices.** Nothing in the guard reads back into `retail.ts`. A system that could adjust its own prices to hit a margin would eventually do that instead of telling anybody.

**Three prices ship that the guard cannot check**, and it names all three rather than passing quietly: Deep Scan, and the `small` and `complex` agent tiers. A fourth appearing is a decision somebody makes, not a gap that opens.

**The economy module's import boundary widened, narrowly.** It was "nobody outside `economy/`, plus the calibration harness"; it is now that plus three named primitives — `execution-class.ts`, `infrastructure-rates.ts`, `sandbox-cost.ts` — none of which decides an amount. The predictive estimator stays unreachable, because a quote reaching the execution path is a quote that would eventually authorize something.

**What this does not claim.** The evidence behind the Agent price is sixteen delivered runs, all `non_production_economics = true`, against one repository and a narrow set of evidence families, with zero `complex`-tier observations and a 41.7% failure rate measured over twelve attempts. Repository size — which [ECONOMY_MODEL.md](../business/ECONOMY_MODEL.md) showed doubles cost for an identical step — is null for every historical row. Activating a price on that basis is defensible because rule 78's bar is a *measured* cost and one now exists for the tier that will carry most traffic, and because the guard makes the exposure visible instead of silent. It would not be defensible to present the three tiers as equally well-founded, and neither this ADR, the type system, nor the billing UI does.
