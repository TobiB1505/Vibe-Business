# modules/billing

The payment rail — see [ARCHITECTURE.md §3 "Layers with no section above"](../../../ARCHITECTURE.md#layers-with-no-section-above), [ADR 0025](../../../docs/decisions/0025-stripe-payment-rail-and-credit-grants.md). Spending prices live in [ADR 0061](../../../docs/decisions/0061-launch-v1-operation-rate-card.md), re-derived by [ADR 0062](../../../docs/decisions/0062-sonnet-5-price-rise-cancelled.md); plans and packs are deliberately outside both.

This module is not where money is _spent_. It is where money **arrives**. Spending is [`modules/credits`](../credits/README.md), which defines what a Vibe Credit is and how it is held, settled and released. Billing turns a Stripe payment into a Credit grant and stops there.

```
Stripe payment truth → verified event → idempotent grant → Vibe Credit ledger
```

And never the other way. Vibe does not ask Stripe at runtime whether a customer can afford an audit; that question is answered by the Credit balance, and `webhook-service.ts` is the only funding path into it.

## The rule the whole module is built to make structural

**The browser names a SKU. The server decides everything else.**

A client may say "buy `pack_500`". It may not say how many Credits that is, what it costs, which currency it is in, or which Stripe Price to charge. All four are resolved in `catalog.ts` from a constant. There is deliberately **no function in this module that accepts a Credit amount, a price id, or a user id from a caller**, so posting `credits=500000` or a forged `priceId` has nothing to attach to.

That is also why Credit amounts live in code rather than in Stripe metadata. If the grant were read back from a Stripe object, anyone who could edit that object — including anyone who ever gains access to the Stripe dashboard — could mint Vibe Credits. The grant amount is Vibe's decision.

The same rule in the other direction: **Stripe says what was paid; Vibe says what that is worth.** The Credit amount is never read from an event. It is looked up from the SKU key, and the event's Price id is then checked _against_ the catalog's configured Price. An event naming an unknown or mismatched Price grants nothing.

## Prices in the catalog are display facts, not authority

The euro amounts in `catalog.ts` are what the UI shows. The amount actually charged is whatever the configured Stripe Price says, because Stripe is the payment rail and its Price object is the authority on money. The two must agree, and verifying that they do is an activation-checklist step — a mismatch is a configuration error to catch before launch, not something this code papers over by trusting one side.

## The success redirect proves nothing

A customer arriving at the return URL means their browser followed a redirect. It does not mean Stripe took their money: they may have hit back, the payment may be asynchronous and still pending, or they may have typed the URL. So **no function in this module grants a Credit on the return path.** Only a signature-verified webhook does.

## Three independent structures make a replay harmless

`webhook-service.ts` does not rely on any one of them alone:

1. `billing_stripe_events` claims the event id with a unique insert, so a second delivery never enters the handler.
2. The grant itself is idempotent on its own key, so a grant that somehow ran twice still credits once.
3. The interpretation in `stripe/events.ts` is pure — no SDK, no database, no clock — which is what makes a replayed, out-of-order, prorated or forged-Price event testable exhaustively rather than only reproducible against a live Stripe account.

## Erasure

`subscription.ts` exists because deleting a Vibe identity does not stop the card being charged — it only removes Vibe's ability to see that it is happening. The rule is stated as a prohibition so it can be checked: **never delete the local identity while Stripe can continue charging it.** Cancellation is immediate rather than at period end, Vibe does not refund the unused part of the period, and the erasure copy has to say so ([ADR 0056](../../../docs/decisions/0056-lifecycle-erasure-and-retention.md) §9).

## What lives here

| File                  | Purpose                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `catalog.ts`          | The V1 catalog: plans, Credit packs, and what each SKU is worth. The server's answer to every question the browser must not ask. |
| `checkout.ts`         | Starting a Stripe Checkout or the customer portal from a SKU key and a session. Grants nothing.                                  |
| `webhook-service.ts`  | The one funding path: a verified event becomes an idempotent Credit grant.                                                       |
| `store.ts`            | Customer links, subscription snapshots, and the event-claim table that makes replay a no-op.                                     |
| `overview.ts`         | The billing screen's read model — balance, plan, allowance, activity — and the read that triggers ledger repair.                 |
| `subscription.ts`     | Cancelling subscriptions for account erasure.                                                                                    |
| `stripe/client.ts`    | The only place a Stripe client is constructed, with the API version pinned.                                                      |
| `stripe/normalize.ts` | Provider payloads into plain, SDK-free descriptions.                                                                             |
| `stripe/events.ts`    | Those descriptions into a Vibe billing decision. Pure.                                                                           |

`stripe/client.ts` is the SDK boundary for the same reason `src/modules/ai/anthropic/` is one for inference: a provider reachable from anywhere is a provider that cannot be swapped, rate-limited or audited in one place. The pinned API version is load-bearing — Stripe moves fields between versions without breaking requests, so the fields this module reads are verified against the SDK's own types rather than from memory.
