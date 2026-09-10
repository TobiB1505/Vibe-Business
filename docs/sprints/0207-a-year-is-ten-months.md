# Sprint 0207 — A year is ten months

**Date:** 2026-09-10
**Decision:** plans can be paid for by the year — ten months charged, twelve granted — end to end, not only on the pricing block.

## What was asked

*"Und es gibt Jährlich mit Rabatt, 2 Monate off."*

## It did not exist

`catalog.ts` said so in its own docblock: *"Exactly three: Free, Builder, Pro. No Enterprise, no Team, **no annual**, no seats, no usage overage — V1 stays small on purpose."* Three plans, one Stripe Price each.

So this could not be a landing-page change. A page showing €190 a year against a product that cannot sell a year is the one thing this whole rebuild has been removing — a control that does nothing, a number nobody can act on. The catalogue, Checkout, the webhook, the billing screen and the marketing block all had to gain it together, and reversing a recorded decision needs a record: [ADR 0107](../decisions/0107-a-year-is-ten-months.md).

## An interval is a price on a plan

`PLAN_KEYS` stays three. A customer paying by the year is on **Builder** — same allowance ratio, same one ledger — and only the billing period differs. Stripe models it the same way: one Product, two Prices. So `PlanDefinition` gains `annual`, `planPricing(key, interval)` is the one resolver, and nothing that reads a plan key had to change.

The discount is **one number**, `ANNUAL_PAID_MONTHS = 10`. The annual price is the monthly one times it; the annual allowance is the monthly one times twelve. Neither is typed beside the other, because two euro amounts that must stay in a ratio are two facts that can come to disagree — and "2 months free" on the switch is a subtraction on that same constant rather than a claim written next to it.

## The charged Price decides the grant, never the metadata

This is the part that mattered most. An annual grant is twelve times a monthly one, so a metadata field that could choose between them would be a field that could **mint eleven months of Credits** — and Stripe dashboard access is not supposed to be that.

`interpretInvoice` reads which of the plan's two configured Prices the invoice actually charged and takes the allowance from that. A test pins it with an invoice whose metadata says `interval: annual` and whose money says a month: it grants a month. `parseBillingInterval` reads anything that is not exactly `"annual"` as monthly, because a malformed field must never commit somebody to a year.

The grant path itself is unchanged, and it already said the right thing: one paid invoice, one Credit lot, expiring at that invoice's period end. A year grants a year, in one lot, with a year to spend it. The alternative — a twelfth released each month — needs a clock, and this repository has admitted exactly one ([ADR 0069](../decisions/0069-retention-sweep-trigger.md)); a pricing change does not get to introduce a second on the way past.

## Three things the repository caught that I had not

**A hand-written radio group.** `choice-card.test.ts` failed the build: the switch was six lines of `<input type="radio">` when `SegmentedControl` already exists and answers this exactly, down to the arrow-key movement the platform gives a real radio group. That test exists because six hand-written radios is how this product once ended up with two conventions for picking one thing — and rule 85's first step, *search Vibe's own inventory*, is the step I skipped.

**An unclassified audit key.** Adding `interval` to the Checkout audit event failed `scrub-vocabulary.test.ts`: every metadata key must be classified before it can be written (ADR 0056 §8).

**A plan promising the wrong thing.** The first render of the switch showed *"A fresh grant each paid month"* under €190. It is false of a year — Stripe invoices once and Vibe grants once — and it was visible only in the picture. The notes belong to the interval now, not to the card.

## And a rule I broke on the way past

`pnpm format` takes a path and I gave it a **directory**. Prettier then rewrote
nine files this change never touched — `overview.ts`, `webhook-service.ts`,
`normalize.ts`, four test files — plus 109 lines of `ARCHITECTURE.md` for a
one-row table addition, and mixed that churn into six files it did edit. Rule 84
exists for exactly this: *no change reformats code it is not already editing*,
because the repository is not written to one width and a repo-wide pass would
rewrite 719 of 1,214 source files.

It was committed and pushed before I looked at the file list. The correction
restores every file to its pre-format state and re-applies only the edits, which
takes the commit from 312 deleted lines to 26 — and those 26 are lines the
change genuinely replaces.

## And two measurement mistakes of my own

**A viewport coordinate is not a layout fact.** The reserved-geometry guard compared `boundingBox().y` either side of the switch and reported a 772px move on a layout that had not changed by a pixel — because Playwright scrolls an element into view before clicking it. It measures document coordinates now, and asserts the scroll position separately, which is the other half of the same promise.

**`git checkout` on an uncommitted file discards work rather than undoing a mutation.** Named in 0206 and worth repeating here, because it happened once and cost a rewrite.

## What is still open, and deliberately

**Two Stripe Prices have to exist.** `STRIPE_PRICE_BUILDER_ANNUAL` and `STRIPE_PRICE_PRO_ANNUAL` are optional configuration exactly as the monthly ones are: a deployment without them sells months and refuses a year with `sku_not_configured`. Creating them, and checking that the euro amount on each matches the catalogue, is an activation step and not something code can do.

**Cancellation is unchanged, and it is heavier on a year.** ADR 0056 §9 makes it immediate with no refund of the unused period. That was written for a month; on €190 it is a materially different promise, and it is recorded as open rather than answered by silence.

Unit 9,486 with 10 new · browser 802 with 4 new · tsc clean · eslint 0 · build clean
