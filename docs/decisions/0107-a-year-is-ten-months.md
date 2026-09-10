# 0107 - A year is ten months charged and twelve granted

Status: Accepted
Date: 2026-09-10

Supersedes the "no annual" clause of the V1 catalog decision recorded in [ADR 0025](0025-stripe-payment-rail-and-credit-grants.md) and stated in `catalog.ts` as *"Exactly three: Free, Builder, Pro. No Enterprise, no Team, no annual, no seats, no usage overage."* Everything else in that sentence stands.

## Context

The founder: *"Und es gibt Jährlich mit Rabatt, 2 Monate off."*

It did not exist. `PLAN_KEYS` had three plans, each with exactly one Stripe Price, and the phrase "no annual" was written into the catalogue's own docblock as a deliberate scope limit rather than an oversight. So this is a reversal of a recorded decision, which is why it has a record of its own.

## Decision

### An interval is a price on a plan, not a fourth and fifth plan

`PLAN_KEYS` stays `free | builder | pro`. A customer paying by the year is on **Builder** — same allowance ratio, same one Credit ledger, same everything a plan means — and the only difference is the billing period. Stripe models it the same way: one Product, two Prices.

So `PlanDefinition` gains `annual: PlanPricing | null`, and `planPricing(key, interval)` is the one resolver. Nothing that reads a plan key had to change.

### The discount is one number

```
ANNUAL_PAID_MONTHS = 10
```

The annual price is the monthly one multiplied by it, and the annual allowance is the monthly one multiplied by twelve. Neither is typed beside the other, because two euro amounts that must stay in a ratio are two facts that can come to disagree — and the one a customer notices is the one that is wrong.

That also makes "2 months free" a subtraction on the same constant rather than a claim written next to it.

### A paid year grants a year, in one lot

The grant path is unchanged and it already said this: **one paid invoice, one Credit lot, expiring at that invoice's period end.** Stripe issues one invoice a year for an annual subscription, so an annual period grants twelve months of Credits at once, with a year to spend them.

The alternative — releasing a twelfth each month — needs a clock. This repository has exactly one admitted use of one ([ADR 0069](0069-retention-sweep-trigger.md), the retention sweep) and the rule around it is explicit: a second use is a second decision. A pricing change does not get to introduce a scheduler on the way past.

### The charged Price decides the grant, never the metadata

`interpretInvoice` reads which of the plan's two configured Prices the invoice actually charged, and takes the allowance from that. It does **not** read an interval from subscription metadata.

This is the module's existing rule — *Stripe says what was paid; Vibe says what that is worth* — applied to a new dimension, and here it is load-bearing: an annual grant is twelve times a monthly one, so a metadata field that could choose between them would be a field that could mint eleven months of Credits. Stripe dashboard access is not supposed to be that.

An untrusted `interval` field is narrowed by `parseBillingInterval`, and everything that is not exactly `"annual"` reads as monthly — a malformed value must never commit somebody to a year.

## Consequences

**Two Stripe Prices must exist before a year can be sold.** `STRIPE_PRICE_BUILDER_ANNUAL` and `STRIPE_PRICE_PRO_ANNUAL` are optional configuration, exactly as the monthly ones are: a deployment that has not created them refuses annual Checkout with `sku_not_configured` and sells months as before. The euro amount on the Stripe Price and the euro amount in the catalogue must agree, and verifying that is an activation-checklist step rather than something this code papers over — the same rule the monthly prices already carry.

**Cancellation is unchanged, and that matters more on a year.** [ADR 0056](0056-lifecycle-erasure-and-retention.md) §9 makes cancellation immediate with no refund of the unused part of the period. That was written for a month. On a €190 annual subscription it is a materially heavier promise, and this ADR deliberately does not change it: what a customer is owed when they cancel ten months into a year is a commercial and consumer-law question, not an implementation detail, and it is recorded here as open rather than answered by silence.

**Plan switching is still not offered.** The Customer Portal is not a plan-switching surface (BILLING CORE-2 §34, §35) and the webhook refuses to grant on a `subscription_update` invoice. Monthly-to-annual is therefore a cancellation and a new subscription today, and the proration economics that would make it one action are not approved.
