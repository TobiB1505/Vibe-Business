# Sprint 0202 — The ladder that stops

**Date:** 2026-09-09
**Decision:** module six of the landing page is the outcome, drawn as three rungs of decreasing certainty — and the third is drawn empty.

## What was asked

*"Die Zustände müssen nicht dabei sein, danach nächster Abschnitt."*

The four-state key came off the Nova block first. A legend explains a notation
to somebody already reading one, and a visitor who has never seen Nova has no
notation in front of them; it also ended that block on a reference table rather
than on the sentence it exists for. What the legend's guard was really holding —
nothing on a marketing page may claim to be running — now holds for the whole
section instead of for four marks in a row.

## The sixth shape

Two tiles, a staircase, a narrowing, a passage, a thread, and now a **ladder**,
because the subject is three claims that get more important and less certain as
you climb. The product's own outcome card already holds exactly that as data
rather than as prose:

```
Merged              delivery — the default branch moved
Production outcome  verified / partial / not observed
Business impact     not measured
```

Every surface in the product that shows a green tick after a merge repeats the
third row, for one reason: the moment a founder sees that tick is exactly the
moment they will assume more happened than did. A marketing page is the surface
most tempted to let them.

So the third rung is **drawn** empty — dashed contour, no fill, a label where a
result would be. A dashed contour is already this product's mark for a loop that
has not closed, in a Nova bubble and here alike. Filling it with a plausible
number would be advertising a claim the product refuses to make.

## The words are the product's

`outcomeProfileScopeNote` writes the second rung's paragraph and
`outcomeCheckLabel` writes its check lines. "/pricing answers" is what the
product says, because *works*, *is live* and *updated* are three things that
check cannot tell anybody — and a landing page must not be where a softer word
gets tried out. `MEASUREMENT_LADDER_LABELS.waiting_for_source` supplies "Not
measured — no source" for the same reason.

All three routes are `public_route_serves_page`, because a real outcome card
comes from one profile: mixing an SEO check into a set of route checks would be
a card the product cannot produce.

## Two guards that were reading prose about the thing

**The omission guard passed with the omission in place.** It asked whether the
words "not observed" appeared anywhere in the block — and the paragraph under
the list says them, so deleting the unobserved row left it green. Three of its
four assertions were about copy. It counts list rows now, and asserts exactly
one of the three is unobserved.

That is the same failure as 0197's rail guard and 0201's legend locator, in a
third costume: a test that names something adjacent to its subject rather than
its subject.

**And a replacement went in silently.** The edit that was meant to swap the
three example routes used a plain string replace with no assertion, missed
because a formatter had rewrapped the block, and changed nothing — while a
second edit *did* land and left two list children with the same React key. It
was visible in the dev server's log and in the rendered page, and it was found
by looking at the picture rather than by trusting the edit.

## Where it came from

`LandingFlow`'s *Measure* tab, moved rather than copied — the fourth step to
leave the tab bar after *Understand*, *Prioritize* and *Execute*. Two tabs left.

Three guards, three mutations — the word *deployed* softened, the unobserved
row deleted, and the third rung given a fill. All caught, the second only after
the guard was rewritten to measure the list instead of the paragraph beside it.

Unit 9,475 · browser 788 with 3 new · tsc clean · eslint 0 · build clean
