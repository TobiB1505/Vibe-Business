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

## And then the paragraph under it went too

*"Der Text darunter auch weg — sowas gehört in die Terms, nicht in eine
Landingpage."*

Right, and it names the category rather than the sentence. A reserved-then-failed
run returning its hold, an ambiguous outcome resolving to a failure rather than a
second charge, nothing spending on a schedule, bought Credits outliving the month
— all true, all enforced in code, and all **terms of a charge**. A landing page
answers what this costs and what it gives; a page that answers the edge cases of
a charge before anybody has one is reading its own small print aloud.

`/terms` already lists *"Pricing, billing and refund terms once the product is
paid for"* among the things it does not yet say. That is where they go, and
writing them is not a thing to do on the way past a marketing block.

Nothing was removed from the **product**: the agent screen still shows a
returned hold in the product's own words, because that is where somebody has one.

## What stayed, and why

**The plan grants.** "1,000 Credits each paid month" is what €19 buys, and hiding it would misrepresent the product rather than simplify it.

**The plan grants, and one line translating them.** Nothing else. The block is
now a heading, a switch, three cards and a sentence.

## One guard inverted, one deleted

The guard that asserted the rate card resolved is now the guard that asserts it
is **absent**: no `35 Credits`, no `25 Credits`, no `200 Credits`, no `Included`
beside a free operation. Broken by adding *"an audit is 35 Credits"* to the
surviving sentence, which is exactly the way this would come back.

The one that asserted the charge rules is deleted rather than weakened, because
its subject is gone from the page.

## And the same formatting mistake, one commit after correcting it

`pnpm format src/modules/billing` — a **directory** again, immediately after a
commit whose whole subject was that this reformats files the change is not
editing. Caught by reading `git diff --stat` before committing rather than
after, and undone the same way: restore, re-apply the one intended edit, which
here was four mis-numbered ADR references (`0098`, which is a real and unrelated
decision, for `0107`).

Unit 9,486 · browser 802 · tsc clean · eslint 0 · build clean
