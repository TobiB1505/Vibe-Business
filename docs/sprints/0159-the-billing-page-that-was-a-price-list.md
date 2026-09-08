# Sprint 0159 — The billing page that was a price list

**Date:** 2026-09-08
**Decision:** none, but two the founder made: the rate card leaves the product entirely, and account activity goes.

## What was asked

Billing rebuilt, account activity out, the page is far too long — research the templates first and decide together how to do it.

## What the research said

The registries return **marketing pricing sections** for "billing": three-column tariff comparisons for landing pages. That is not this screen. Searched 21st.dev and ReUI across billing, subscription, usage, credit balance and account settings; two patterns transferred and the rest were a different page with the same word on it.

- A **meter with the cycle position and the detail on demand** (21st.dev `v-collapsible-4`).
- **Usage as bars** rather than as a list (`v-meter-8`).

Same finding as Sprint 0146: for the shape of this page, no catalogue has anything. What was taken is compositional; nothing was installed.

## What the measurement said

2,566px — 2.6 screens at 1440×1000 — over six sections:

| Section | Height |
|---|---|
| Credit prices | **683px** |
| Recent usage | **674px** |
| Account activity | 336px |
| Top up Credits | 333px |
| Balance + plan | 303px |
| Plans | 239px |

The two tallest blocks are 53% of the page and **both are reference rather than decision**. And the rate card restated, in 683px, what `ActionBlock` and `CostDisclosure` already print beside every button that spends a Credit.

## What the founder decided

Presented as three structures with the measurements behind each. Chosen: the rate card leaves the page and the balance becomes a meter, with account activity gone. Asked where the rate card should go instead — its own sub-page, a disclosure, or nothing — the answer was **nothing**.

## What was built

**One hero panel instead of two cards.** The balance and the plan were a 2:1 grid, so answering *can I run this, and until when* meant reading across a gap. The plan is a line on the same card, the meter shows the share the two numbers underneath made a reader divide, and both controls sit in one row.

`AllowanceMeter` is written here rather than installed: a progress bar's whole contract is `role="progressbar"`, three values, a name and `aria-valuetext`, which is four attributes and two divs. It refuses to turn amber as it empties — a low balance is not a warning, and this page's own guards say it must not scold.

It speaks **Credits**, not the internal sub-units the ledger stores in. The ratio is identical either way, but `aria-valuenow` is read aloud where `aria-valuetext` is absent, and "1,000,000" is exactly the internal vocabulary §52 keeps off this page — said out loud, to the reader least able to check it. Caught by a test, not by review.

**Top-ups and plans pair**, both answering *how do I get more Credits* — one for now, one for every month. **Spend by product** becomes a strip at the head of the ledger it summarises rather than a card two sections away from it. The ledger's rows lost their icon frame and half their padding.

**Gone:** the rate card, its footnote, `OPERATION_NAMES`, `EXECUTION_CLASS_NAMES`, the `PriceRow` type, the account-activity panel and the `accountActivity` prop with the query behind it.

**2,566px → 1,395px.** Six sections → four.

## The defect I introduced and the test that did not catch it

`hasBalanceFacts` still counted the monthly allowance and the renewal date after UI-22 moved both up beside the meter — so on the most common screen there is, the list under the meter was **true and empty**, and an empty `dl` still occupies its margins. A visible hole between the meter and the buttons, in the card that is supposed to be the calmest thing on the page.

The original code carried a comment warning about exactly this. Moving its contents reintroduced the defect the comment existed to prevent. Found by looking at a screenshot; no assertion would have caught it, and none has been added, because the fix is a condition that now names precisely the three facts the list renders.

## What was lost, honestly

Seven browser tests, and it is worth being exact about what they were:

- **Four were about prices**, and those claims still hold where the prices live. `src/modules/credits/retail.test.ts` pins every `launch-v1` amount including the three agent tiers, and iterates `RETAIL_OPERATION_KINDS` so an operation the policy sells cannot go unpriced. What is gone is a *rendering*, and a rendering that does not exist cannot be rendered wrong.
- **Two were about the price table's own presentation** — Product Understanding as "Free" rather than "0 Credits", and the footnote appearing only where a row needs it. Those are gone with the table and are not held anywhere else. The "Free rather than 0" rule still governs `CreditAmount` wherever a free operation is disclosed.
- **One was the account-activity panel**, removed by decision.

The block headed "the price table under launch-v1 (rule 69)" keeps its fifth test, which was never about the table: the plan rows still state what a plan buys in work rather than in Credits.

**And the consequence the founder chose knowingly:** there is now no screen in the product where all operation prices appear together. Every priced button still discloses its own, which is where the decision is actually made.

## What the guards say

Four new, three mutation-tested by breaking them:

- The meter is drawn, its `aria-valuetext` says what the sentence beside it says, and `aria-valuemax` is in Credits. Removing the attribute fails it.
- No meter on a plan with no allowance to be a share of — a full bar with no denominator is a claim about a limit that does not exist. *Not mutation-tested.*
- No "Credit prices" region and no "Know the cost before you start". Adding either back fails it.
- The page stays under 2,000px. An 800px block fails it.

Two existing guards changed wording, not claim: the monthly share and the renewal date are one line now, and the spend strip's scope sentence is shorter. Both still assert both facts.

## Validation

Unit 8,853 · browser 619 · lint 0/0 · typecheck clean · no migration.
