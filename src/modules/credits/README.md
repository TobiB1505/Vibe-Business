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
| `retail.ts` | Fixed customer operation prices, versioned and effective-dated. |
| `rating.ts` | Provider-usage rating. Deliberately **not** where retail prices live. |
| `projection.ts` | Normalizing provider ledgers into economic usage events. |
| `reconciliation.ts` | Backfilling that projection, idempotently. |

## The two price layers, which are not the same thing

```
rating.ts   "what did this provider usage rate to?"   credits per token / ms / byte
retail.ts   "what does this operation cost?"          credits per delivered operation
```

`CREDIT_RATE_CARDS` in `rating.ts` is still **empty**, and that is correct: no approved production rate exists for rating provider consumption. The fixed customer prices activated in Billing Core-2 live in `retail.ts` instead, because forcing them into a rate card would mean inventing a fake SKU with a quantity of 1 and making `rateUsage` return customer prices for usage that never occurred.

Provider Cost Price Book and Customer Retail Credit Policy stay different concepts.

## The invariants worth knowing before changing anything here

- **The ledger defines the balance.** Materialized figures on the account and on each lot are caches, and both are proven against the rows that define them rather than trusted.
- **A reservation is not a charge**, and settlement may never silently exceed the maximum a customer approved.
- **Credits that expire soonest are spent first**, so purchased Credits are preserved until expiring capacity is exhausted.
- **Expiration is an append-only event.** Nothing is ever deleted; a lapsed grant stays answerable forever.
- **Nothing here is reachable from a browser.** Every billing table has select policies and no write policies; the absence is the enforcement.
