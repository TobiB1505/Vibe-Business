# launch-v1 — the rate card, and the deadline nobody had noticed

**Recorded 2026-08-31, after the work.** Read the whole credit/billing system, reconcile it against real production usage, reconstruct the current rate card, and build `launch-v1` from it: plan grants, operation rates, reservation maxima, credit packs, and then the billing UI.

The reconstruction is the part worth reading, because it found something the brief did not ask about and that changed what the work had to be.

## What the reconstruction found

The machinery was finished. Ledger, lots, reserve → allocate → settle-or-release, Stripe as a funding rail, reconciliation activated in production. Two weeks of sprints had gone into making it correct.

The prices were half-decided. `retail-v1` priced three operations. `CREDIT_RATE_CARDS` was `[]`. `EXECUTION_BUDGET_POLICIES` was `[]`. Deep Scan's `credits_required` refusal had nothing behind it. Every one of those was documented as deliberate, and all four were.

Then the production query for `ai/pricing.ts`'s effective card came back with two rows for Sonnet 5:

```
claude-sonnet-5-introductory-2026   2026-01-01 → 2026-09-01   in 2_000  out 10_000
claude-sonnet-5-standard-2026-09    2026-09-01 → null         in 3_000  out 15_000
```

**Today is 2026-08-31.** Every margin figure in every business document in this repository was computed at the top rate, and would stop being true at midnight. At the Pro plan's credit value, `retail-v1`'s 35 / 20 / 15 fall from the ~80% contribution margin they were calibrated to down to roughly 68%, with no code change, no deploy, no visible event, and the whole suite still green.

Nothing connected the scheduled fact to its consequence. Not a test, not a type, not an assertion. `CREDIT_PRICING_V1.md` had even *named* the trigger — *"`ai/pricing.ts`'s scheduled Sonnet increase (2026-09-01, +50%) … should trigger an immediate re-run of §9's stress table"* — as a thing a person would remember to do.

That reframed the sprint. A rate card is not something you activate when the evidence is perfect; it is something you need in place when the costs move, and the durable deliverable is not the card at all — it is the thing that fails next time.

## Reconciling the card against production

Queried live, grouped per **delivered result** (`ai_usage_events.job_id` is the domain artifact, not the request):

| Operation | Jobs | Mean USD | p90 | Max |
| --- | ---: | ---: | ---: | ---: |
| `product_understanding` (Haiku) | 17 | 0.0092 | 0.0104 | 0.0111 |
| `business_readiness_audit` | 27 | 0.1125 | 0.1953 | 0.2347 |
| `opportunity_generation` | 13 | 0.0683 | 0.0915 | 0.1052 |
| `action_planning` | 5 | 0.0562 | 0.0716 | 0.0741 |
| `agentic_execution` | 16 | 0.2672 | 0.4723 | 0.6158 |

Three things fell out of it.

**Nothing has ever been rated.** All 950 `billing_usage_events` rows: `rating_status = 'rate_card_not_configured'`, `rate_card_version` null. Every browser and sandbox row `cost_unknown` or `not_billable`.

**`retail-v1`'s calibration was recoverable, and it checked out.** 35 Credits against $0.1125 at €0.016333/Credit is 80.3% — the guard reproduces it exactly, from `ai/pricing.ts`'s *old* card, which is how the reconstruction was verified rather than asserted.

**The simulation's credit value was wrong by 1.8×.** `economy/credit-rate-card.ts` simulates at `RETAIL_NANO_USD_PER_CREDIT = 10_000_000` — $0.01. The catalog sells Credits at €0.0163–€0.0240. So Model C's "300 Credits = $3.00" is $5.29 read at the price customers actually pay, and every scenario in `CREDIT_PRICING_V1.md` had to be re-based before it could be used. The document is not wrong; its constant is explicitly a simulation value. But a number carried forward without re-basing would have priced the agent at nearly twice the intent.

## What shipped

`launch-v1`, effective at the same instant the Sonnet card changes — one event seen from three sides, asserted as an equality between three `effectiveFrom` strings.

| Operation | `retail-v1` | `launch-v1` | Basis |
| --- | --- | --- | --- |
| Product Understanding | free | free | measured |
| Business Audit | 35 | 55 | measured |
| Next Moves | 20 | 30 | measured |
| Action Plan | 15 | 30 | measured |
| Deep Scan (additional) | — | 25 | **policy** |
| Agent improvement | — | 150 / 200 / 350 | **modelled** |

Derived by one rule with no per-operation special cases: effective cost per *delivered* result ÷ 0.20 ÷ $0.017640, rounded up to five. Delivered basis, not the success mean — a failed audit's measured mean cost ($0.149) is *higher* than a successful one's ($0.098), and pricing against successes would claim a margin that is not there.

**Plans and packs did not move.** Free 0 / Builder €19 → 1,000 / Pro €49 → 3,000; packs unchanged. That was a decision, not an omission: no Stripe Price object moves, no published euro figure changes, and the production activation checklist does not reopen. The repricing lands entirely on what a Credit buys, which is the variable Vibe controls and the one the provider moved.

## Three things the types now carry that comments used to

**`PriceBasis`.** The card holds three genuinely different kinds of claim, and a price table gives a reader no way to tell them apart. Three prices are `measured`. The Agent is `modelled` — `standard` carries the whole sample, `small` has one cost observation, `complex` has **zero**. Deep Scan is `policy`: `provider_cost_usd` is null for every row of `deep_scan_provider_usage`, no browser rate exists anywhere in the repository, and 25 Credits is a judgment. Same discipline as `RateSourceKind` and `activated: false`, applied one layer up.

**`not_priced`, distinct from `free`.** The old `chargeFor` collapsed both to `null` and its own docblock said so — safe only while the operations that could be unpriced could not reach it. Under `launch-v1` they can, and the two require opposite behaviour: `free` runs and charges nothing, `not_priced` refuses. `retail-v1` now carries `not_priced` for Deep Scan and the Agent, which is what was true while it was in force, so a charge dated inside that window is answerable as *"retail-v1 had no price for it"* rather than *"somebody forgot"*.

**A class that will not be guessed.** `retailChargeFor` throws when a class-priced operation is resolved without one, and `resolveExecutionBudget` requires it with no default. Defaulting to `small` would sell every agent improvement at the cheapest price Vibe has while every screen, test and ledger entry looked correct — a revenue leak that presents as a working system. Defaulting to `complex` overcharges just as silently. There is no safe default, so there is no default.

## The margin guard

`credits/margin-guard.ts` recomputes each price's contribution margin from `calculateProviderCost` and the founder-attested sandbox rates **at the instant it is asked**, applied to frozen production token and duration profiles, and fails below a 70% floor.

The split is the design. Frozen cost would make it a tautology that passes forever; a live quantity would make it a report on last week's traffic. Freezing what was *measured* and floating what is *charged* turns it into a question about rates — which is the question nobody was asking this morning.

It computes and reports. Nothing reads back into `retail.ts`: a system that could adjust its own prices to hit a margin would eventually do that instead of telling anybody.

Its counterfactual test is the sprint's record of why the repricing happened, in a form that outlives memory:

```
heldPriceMargin = (35 Credits' revenue − September cost) / revenue
expect(heldPriceMargin).toBeLessThan(0.72)
```

And `uncoveredPrices()` returns exactly the three amounts it cannot check, asserted as a literal list, so a fourth is a decision somebody makes rather than a gap that opens.

## Two defects the work surfaced that were not in the brief

**`operation-billing.test.ts` asserted the calendar.** Most of its cases never passed a `now`, so they resolved whatever retail policy happened to be in force when CI ran. Every `creditsToUnits(35)` in it was as much an assertion about the date as about the code, and all thirty would have started failing tomorrow morning for nothing anybody had changed. Pinned to an instant inside `retail-v1` — the file's subject is the machinery, not today's price — with `toFake: ["Date"]` only, because faking `setTimeout` freezes the contention backoff and the CAS tests that are the point of the file would hang instead of running.

**`isDogfoodEligibleProject` was reading the wrong thing.** It answered *"is this project on the internal allowlist"* by checking `resolveAgentEconomics(...)?.nonProduction === true` — correct while the production branch never fired, and silently false for every project the moment one did. It asks the allowlist directly now. Nothing failed; it would simply have stopped offering the dogfood surface, and the reason would have been three modules away.

## The mistake worth reading

The first attempt at the economy module's import guard weakened the guard.

`sprint-0054-safety.test.ts` asserts that nothing outside `economy/` imports it, and `launch-v1` genuinely needs the pricing classifier — a second copy would let the price a customer was shown and the class Vibe reasons about drift apart, which is the exact failure that suite exists to prevent. So the allowlist had to widen. It also failed on something else: a **docblock** in `retail.ts` that referenced `economy/intelligence/quote-simulation.ts` by path, because the test greps the raw file including comments.

The tempting fix was to make the test comment-blind, like the sibling checks in the same file already are. That would have been wrong in a way that is hard to see: the check it would have relaxed is the one guarding the estimator, and relaxing a safety test so a comment can mention a module is a bad trade at any exchange rate. The comment was reworded instead, and the allowlist widened to three **named modules** rather than three named files — `execution-class.ts`, `infrastructure-rates.ts`, `sandbox-cost.ts`, none of which decides an amount — so a file on the list still cannot reach the estimator.

## Verification

`pnpm test` 408 files / 7017 tests, `pnpm lint` 0 errors, `pnpm typecheck` clean, `pnpm build` green. **No migration**: every column this needed already existed — `rate_card_version` on ledger, reservations and usage events; `quote_id`, `estimated_credits`, `maximum_credits`, `assumptions` on quotes; `operation_run_id` nullable on reservations, which is what lets a Deep Scan hold Credits without inventing a durable operation type for it. `git status supabase/` is empty and rules 29–34 never engage.

## Not proved

- **No live agent run against the production price.** The reserve → settle path is exercised by the concurrency suite against real PostgreSQL and by unit tests at every seam, but nothing has yet spent money at 200 Credits.
- **No Deep Scan has been charged.** The hold, settle and release calls are asserted at the module boundary; `billing.ts` itself needs a real service-role client and has not run.
- **`billing_credit_quotes` still has zero rows in production.** The first agent start writes the first one.
- **The FX assumption is unverified.** EUR/USD 1.08 is stated in code and in the derivation document, and nothing in this repository observes it.
- **Three prices ship with margins nobody can compute** — Deep Scan, and the `small` and `complex` agent tiers. The guard names them; naming a gap is not closing it.
