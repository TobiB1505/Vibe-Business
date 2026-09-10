# Sprint 0208 — The second currency comes off

**Date:** 2026-09-10
**Decision:** the per-action Credit prices are not on the landing page. What a grant is worth is said once, in work.

## What was asked

*"Die Credit-Preise raus."*

## Why it is the right call, having built the other thing twice

0205 built this block as the rate card. 0206 put the euros in front of it and kept the Credit prices underneath, on the argument that "1,000 Credits each paid month" is meaningless without them.

That argument was half right. The number does need translating — but a **price list** is the wrong translation for somebody who has not signed up. It asks them to learn a second currency, convert it in their head, and only then reach the question they arrived with, which is what a month costs. Six rows of Credits after a euro is the page changing the subject.

## One line does the whole job

```
Every 1,000 Credits is 5 agent runs at the standard class,
or 28 Business Brain audits, or any mix of the two.
```

Which is a division on the rate card, performed at render time — the same derivation that produced the removed list, saying what the reader actually wanted from it. It cannot come to disagree with what the product charges, because it is computed from the same function the reservation calls, and it now carries that binding alone.

## What stayed, and why

**The plan grants.** "1,000 Credits each paid month" is what €19 buys, and hiding it would misrepresent the product rather than simplify it.

**The hold that was returned.** `CostLine` in its `released` state — *the hold for this run was returned, nothing was charged* — because that is the sentence a founder does not expect and the one a price list never contained. The `settled` line went with the prices: it printed *200 Credits*, and it was the only figure left that was a price rather than an allowance.

**The Credit packs.** They are priced in euros.

## Two guards, one inverted

The guard that asserted the rate card resolved is now the guard that asserts it is **absent**: no `35 Credits`, no `25 Credits`, no `200 Credits`, no `Included` beside a free operation. Broken by adding *"an audit is 35 Credits"* to the surviving sentence, which is exactly the way this would come back.

And the cost-line guard drops from two lines to one. Broken by rendering the `pending` state instead of `released`, which is the way the honest half would quietly be lost.

Unit 9,486 · browser 802 · tsc clean · eslint 0 · build clean
