# modules/credits

The customer-facing economic layer — see [ARCHITECTURE.md §3.11](../../../ARCHITECTURE.md#311-usagecredit-layer), [ADR 0024](../../../docs/decisions/0024-vibe-credits-economic-layer.md) and [ADR 0025](../../../docs/decisions/0025-stripe-payment-rail-and-credit-grants.md).

A Vibe Credit is defined by Vibe, not by a provider. Provider usage is measured in the units providers actually bill (tokens, milliseconds, bytes); Credits are what a customer holds and spends, and the two move independently on purpose.

## What lives here

| File | Purpose |
|---|---|
| `units.ts` | The exact-integer Credit unit. No floats, ever. |
| `schema.ts` | The domain model, and the four concepts it exists to keep apart. |
| `balance.ts` | Pure balance, reservation, settlement, release and refund rules. |
| `store.ts` | Persistence, and the atomic reservation primitive. |
| `service.ts` | The domain API. Ownership is derived, never accepted. |
| `lots.ts` | Pure spend order, allocation, partial settlement and expiry. |
| `lot-store.ts` | Lot and allocation persistence, with per-lot compare-and-swap. |
| `grants.ts` | Issuing Credits, and the expiry sweep. Server-only. |
| `operation-billing.ts` | Reserve → run → settle → release for a priced operation. |
| `retail.ts` | Customer operation prices, versioned and effective-dated. Fixed per operation, except agentic execution, which is priced per execution class. |
| `rating.ts` | Provider-usage rating. Deliberately **not** where retail prices live. |
| `margin-guard.ts` | Recomputes every live price's contribution margin from the provider rates in force. Reports; never prices. |
| `projection.ts` | Normalizing provider ledgers into economic usage events. |
| `meter.ts` | Running that projection **as usage is written**, so the ledger is current by construction (ADR 0073). |
| `reconciliation.ts` | Finding what the meter missed, idempotently. It used to be the only writer, and its only caller was a probe. |

## The two price layers, which are not the same thing

```
rating.ts   "what did this provider usage rate to?"   credits per token / ms / byte
retail.ts   "what does this operation cost?"          credits per delivered operation
```

`CREDIT_RATE_CARDS` in `rating.ts` is still **empty**, and that is correct: no approved production rate exists for rating provider consumption. Customer prices live in `retail.ts` instead, because forcing them into a rate card would mean inventing a fake SKU with a quantity of 1 and making `rateUsage` return customer prices for usage that never occurred.

Provider Cost Price Book and Customer Retail Credit Policy stay different concepts.

## What a customer pays, and how each number came to be one

`launch-v1` is the policy in force ([ADR 0061](../../../docs/decisions/0061-launch-v1-operation-rate-card.md), re-derived by [ADR 0062](../../../docs/decisions/0062-sonnet-5-price-rise-cancelled.md) after Anthropic withdrew the Sonnet 5 rise it was priced against); `retail-v1` is closed and kept forever, because the charges that name it must stay explainable.

| Operation | Credits | Basis |
| --- | --- | --- |
| Product Understanding | free | measured |
| Business Audit | 35 | measured |
| Next Moves | 20 | measured |
| Action Plan | 20 | measured |
| Deep Scan (additional) | 25 | **policy** — no browser-provider rate exists to check it against |
| Agent improvement | 150 / 200 / 350 by execution class | **modelled** — `standard` carries the sample; `small` has one observation, `complex` has none |

`PriceBasis` is a required field rather than a comment, because the card contains three genuinely different kinds of claim and a price table gives a reader no way to tell them apart. `margin-guard.ts` recomputes what it can from the provider rates in force and names what it cannot.

A `RetailPrice` has four shapes, and the two that look redundant are not:

- `free` runs and charges nothing. A price of zero would post a 0-Credit charge on every product-understanding run.
- `not_priced` **refuses**. `retail-v1` carries it for Deep Scan and the Agent, which is what was true while it was in force; collapsing it into `free` would run the most expensive operation Vibe has for nothing.

## The invariants worth knowing before changing anything here

- **The ledger defines the balance.** Materialized figures on the account and on each lot are caches, and both are proven against the rows that define them rather than trusted.
- **A reservation is not a charge**, and settlement may never silently exceed the maximum a customer approved.
- **A charge lands on what the price describes.** An agent improvement is priced as a *validated* improvement, so its hold survives the run and the validation verdict settles or releases it — never the moment a reviewable change exists ([ADR 0073](../../../docs/decisions/0073-the-charge-lands-on-what-was-sold.md)). Validation, preview and review stay unpriced on purpose: their cost is inside that price.
- **Credits that expire soonest are spent first**, so purchased Credits are preserved until expiring capacity is exhausted.
- **Expiration is an append-only event.** Nothing is ever deleted; a lapsed grant stays answerable forever.
- **Nothing here is reachable from a browser.** Every billing table has select policies and no write policies; the absence is the enforcement.
