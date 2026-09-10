# Sprint 0205 — The number before the press

**Date:** 2026-09-09
**Decision:** module eight of the landing page is the rate card in force, resolved rather than typed, and the two money questions a price list does not answer.

## The eighth shape

Two tiles, a staircase, a narrowing, a passage, a thread, a ladder, a boundary —
and now a **ledger**. It is the one shape on this page meant to be scanned down
a column rather than read, which is what a price list is for and what no other
block here is.

## Why none of the numbers are in the file

`CostDisclosure` resolves each one through `resolveRetailPrice` — the same
function the reservation calls when a founder actually presses the control. So
there is no second copy of a price on the marketing page to drift out of step
with the one charged, and the page cannot advertise a number the product has
stopped charging. Six rows come out of `launch-v1`: Deep Scan 25, the audit 35,
the Moves 20, a plan 20, an agent run at its standard class 200 — and the
Product Scan free.

That last row shows **Included** rather than a zero, and the block inherits that
decision rather than re-taking it: a free operation names itself, because
printing "0 Credits" beside a control invites the question of when it might stop
being zero (BILLING CORE-2 §56).

## The half a price list leaves out

Two money questions have answers a founder would not assume, and both are in the
product already. A run that reserved Credits and then failed **returned them** —
`CostLine` says so in its own words, and it is rendered here in exactly that
state. And an ambiguous outcome resolves to a failure rather than to a second
charge (rule 50). Nothing spends on a schedule either: Vibe never starts a paid
refresh on somebody's behalf, and blocked work says what needs refreshing and
waits (rule 60).

## Two things measured rather than assumed

**A price list at full width is not a row.** At 1440 the section is 1,360px and
`justify-between` put "25 Credits" a thousand pixels from "Deep Scan". Held to a
measure, the two ends of a row belong to each other again.

**`/0 Credits/` matches inside "200 Credits".** The guard inherited from the
trust bento asserted that no zero price is rendered, and it was correct there
because that tile carried 25 and nothing else. Here it failed on a page with
nothing wrong with it. `\b0 Credits` is the assertion that was always meant.

## Where it came from

`LandingTrust`'s *Before you press* tile, which showed two prices; this shows
the whole card. Four tiles left in that bento, and two of them now repeat blocks
in the walk.

Two guards, three mutations: the free row given a price, the released cost line
deleted, and the double-charge sentence softened. All caught.

Unit 9,475 · browser 796 with 2 new · tsc clean · eslint 0 · build clean
