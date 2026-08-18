# 0025 - Stripe as Payment Rail, and Credit Grants as Provenance

Status: Accepted
Date: 2026-08-18
Builds on [0008](0008-secrets-management.md), [0013](0013-durable-operation-execution.md), [0024](0024-vibe-credits-economic-layer.md)

## Context

[ADR 0024](0024-vibe-credits-economic-layer.md) built the Credit ledger and stated that a future payment provider would be "a funding source, not a source of truth". Billing Core-1 implemented that ledger — exact integers, append-only history, quote → reserve → settle → release, an atomic reservation primitive proven under real concurrency — and deliberately left it in shadow mode. Nothing granted Credits and nothing spent them.

[docs/business/CREDIT_ECONOMICS.md](../business/CREDIT_ECONOMICS.md) then decided the commercial policy: a Credit is worth roughly €0.02 of retail value, Class A operations get fixed prices, and internal failures are absorbed rather than billed.

Three things had to be resolved to make Credits real, and each has a wrong answer that is easier than the right one.

**Where does a balance come from?** The easy answer is "ask Stripe". It is wrong for the same reason ADR 0024 gave: the answer must survive Stripe being unreachable, and a subscription's *status* is not evidence that a period was paid.

**Which Credits are these?** Core-1's balance is a single number, and a single number cannot say which 100 Credits expire on the 30th, or whether a 70-Credit charge ate the ones the customer paid for or the ones Vibe gave away. Expiration and a fair spend order are both unimplementable without provenance.

**Who decides how many Credits a payment is worth?** The easy answer is "whatever the payment says". That makes anyone who can edit a Stripe object — or forge a payload — able to mint Vibe Credits.

## Decision

### 1. Stripe is a payment rail and a subscription rail. It is never the runtime Credit authority

Money flows one way:

```
Stripe payment truth → signature-verified event → idempotent grant → Vibe Credit ledger
```

Vibe never asks Stripe at runtime whether a customer can afford an audit. That question is answered by the Credit balance in Postgres, which is the only thing an operation consults. Stripe being down degrades *purchasing*, never *spending*.

A returning browser is not a payment. The Checkout success redirect grants nothing and the screen says the payment is being confirmed, because at that moment that is genuinely all Vibe knows.

### 2. A grant follows a paid invoice, never a subscription status

`subscription.status === 'active'` stays true for a month. Granting on it would pay out on every incidental update. The monthly grant is bound to the **invoice** — the real external identity of a paid billing period — and only for the billing reasons that represent one (`subscription_create`, `subscription_cycle`).

`subscription_update` invoices are refused outright. That is what stops a mid-cycle plan change from minting proportional Credits nobody approved, and it is enforced in code rather than by how the Stripe Customer Portal happens to be configured.

### 3. Vibe's catalog decides how many Credits a payment is worth

The browser names a SKU. The server resolves the Stripe Price, the currency, the amount and the Credit total from a constant in the repository. The Credit amount is never carried in Stripe metadata and never read back from a payment object, so whoever can edit Stripe still cannot mint Vibe Credits.

An event's Price id is checked *against* the catalog's configured Price for the claimed SKU. An unconfigured SKU fails closed: "we never set that up" must never read as "any Price is acceptable".

### 4. Credits belong to immutable lots, and the ledger still defines the balance

A lot records where Credits came from and when they die. It is **not** a second wallet: every lot is created by exactly one ledger entry, so the ledger remains the reconstructable truth and Core-1's atomic reservation gate is untouched. `unique(ledger_entry_id)` carries the ledger's exactly-once guarantee through to provenance.

Allocation rows record which lot funded which hold and how much of it a settlement consumed, so a charge is attributable after the fact rather than recomputed from a policy that may since have changed.

### 5. Credits that expire soonest are spent first

Stated as an ordering over expiry deadlines, not as a list of source categories. A category order ("welcome, then subscription, then purchased") happens to be right today only because those categories currently have that expiry ordering; it would be wrong the moment a promotional grant outlived a subscription period. Ordering by the deadline is right for combinations that do not exist yet, and it is what preserves purchased Credits — the ones a customer paid real money for — until expiring capacity is exhausted.

### 6. Expiration is a posted, append-only event

Not a deletion, and not a read-time filter alone. A negative `expiry` ledger entry moves the posted balance, which keeps Core-1's reservation predicate honest without changing that primitive at all. The lapsed lot stays in history with its original amount intact, so "100 Welcome Credits, expired Aug 30" is answerable forever.

Spendability is evaluated from `expires_at` directly rather than from a swept status, so no customer can spend expired Credits regardless of when a sweep runs. The sweep exists only to stop the posted balance overstating what someone has, which is why it runs when an account is touched rather than on a schedule.

A lot with a live hold is deliberately skipped: Credits that were valid when a customer approved an operation must not vanish mid-run and fail work they already authorized.

### 7. Predictable operations have fixed customer prices, in their own versioned layer

Business Audit 35, Opportunity Generation 20, Action Plan 15, Product Understanding free. These are decoupled from the exact provider usage of any individual run — a customer told "Claude used 20,413 tokens, therefore 17.29 Credits" has been handed Vibe's cost structure as their problem.

This is a **separate layer** from Core-1's `CREDIT_RATE_CARDS`, not an extension of it. That card rates provider SKUs — credits per token, per millisecond, per byte — and forcing a fixed operation price into it would mean inventing a fake SKU with a quantity of 1, which would make `rateUsage` start returning customer prices for usage that never occurred. Provider Cost Price Book and Customer Retail Credit Policy stay different concepts, as Core-1's own schema comment requires.

Every charge stores the policy version that produced it, so a future repricing never re-rates history.

### 8. A customer balance can never go negative, and a failure is never billed

An operation reserves its price before any provider call. Insufficient Credits means the operation does not start — not that it starts and discovers an empty wallet after paying Anthropic.

The approved V1 failure policy applies: a Vibe failure, a provider failure and a run that produced nothing usable are all zero charged. `abandoned_with_usage` records that Vibe still paid the provider, because internal cost and customer price are separate facts and a release must not pretend otherwise.

### 9. The Stripe webhook is the second legitimate caller of the service-role client

Stripe authenticates by signing a request body, not by presenting a session, so there is no `auth.uid()` for RLS to act on — the same situation durable execution is in ([ADR 0013](0013-durable-operation-execution.md)). It carries the same obligation: it never accepts a user id from its caller, and ownership resolves through `billing_stripe_customers`, a mapping Vibe wrote itself when it created the customer.

Signature verification has no environment check, no bypass parameter and no debug flag. A signature check that configuration can disable is an open endpoint that mints Credits.

### 10. Test mode first. Live mode requires a deliberate second act

The Stripe mode is derived from the secret key rather than configured separately, so "what the operator thinks is configured" and "what the key actually does" cannot diverge. A live key is refused at startup unless `STRIPE_ALLOW_LIVE_MODE` is set to exactly `"true"`, so pasting a live key into an environment variable is not enough to start charging real customers.

## Consequences

**Easier.** Agentic Execution can consume `quote → reserve → run → settle → release` without Billing changing: the primitives it needs already exist, already allocate across lots, and already refuse to exceed an approved maximum. A price change is a new effective-dated policy rather than a migration. An accountant can ask "why does this account have these Credits?" and get an answer per lot.

**Harder.** There are now two materialized figures to keep honest — the account balance and each lot's allocated total — and both are reconciled against the immutable rows that define them rather than trusted. Allocation adds a second admission gate beneath Core-1's, so a reservation can be refused by the lot allocator after the account gate admitted it; that is deliberate, because the allocator is the one that knows what is actually spendable.

**Foreclosed.** Billing customers for provider tokens. Reading a Credit amount back from a payment provider. Granting on a browser redirect. Deleting an expired grant. Any single number as the whole truth about a balance.

**Deliberately still open.** No price exists for an additional Deep Scan or for Agentic Execution, because both depend on sandbox and browser cost inputs that have never been measured — see CREDIT_ECONOMICS.md §Decisions requiring Sandbox/browser cost. Credit reversal for a Stripe refund or chargeback is documented as a residual, not implemented: the Credits may already have been spent, and clawing back into a negative balance requires a commercial policy that does not exist.

## Deviation recorded

CREDIT_ECONOMICS.md §Expiration recommends that subscription Credits **roll over with a cap** of 2× the monthly grant. This sprint implements **expiry at the end of the paid period** instead, on explicit founder instruction, and capped rollover is recorded as a deferred follow-up rather than silently dropped. The two are genuinely different economics — a quiet Builder month keeps 1,000 Credits under the document's policy and none under this one — so the divergence is stated here rather than left for a reader to discover from the code.
