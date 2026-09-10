# Sprint 0198 — The map, unrolled into a staircase

**Date:** 2026-09-09
**Decision:** the nine business areas come down the landing page one to a tread, alternating sides, threaded orb to orb.

## What was asked

*"Die Business Map so darstellen … ein Orb, rechts daneben was damit gemeint ist, dann versetzt nach unten beim Scroll der nächste Orb … und es wechselt immer rechts links die Seiten, wie so eine Wendeltreppe. Das sieht halt nicht wie eine Liste aus."*

## Why the radial map came off the page

It is the right shape **in the product**, where the nine areas are looked at
together and the relationships between them are the point. On a landing page it
is one picture a visitor has to decode before it says anything, and its nine
labels are 12px because nine things have to fit a circle.

Unrolled down a scroll, each area gets a screen of its own: the orb at one side,
what the area asks beside it, the next one below and on the other side. Nothing
is decoded; it is read.

`LandingBusinessBrain` is deleted rather than left as an unimported file — its
own contract test says a contract pointed at an unrendered component guards
nothing, so `PROOF` moved to the staircase. The `#brain` section further down
went with it: it was the second half of a story this block now tells once.

## Three things separate a staircase from a list whose margin flips

**The alternation**, which is the obvious one and not enough on its own.

**The offset.** Each tread's text sits lower than its orb, so the eye steps
*down* into it rather than straight across.

**The thread.** A curve is drawn between consecutive orbs as each is reached, so
the path is visible rather than implied — and this is where `stroke-dashoffset`
finally earns its place. The spine in `LandingStep` is straight and a transform
beats a stroke there; here the path bends, so the length has to be measured and
walked, which is what the technique is for.

## The curve took three goes, and the reason is worth keeping

A 100×100 viewBox in a 1440×112 box is squashed **nine times harder vertically
than horizontally**. The S it should draw arrived as three disconnected
scratches — twice, once with the control points at mid-height and once with them
pulled to the ends, which is what fixed the *shape* argument and not the
distortion.

The fix is to stop stretching one axis nine times more than the other: the
viewBox is `0 0 1000 112` against a box 112 tall, so the only distortion is a
mild 1.4× horizontal one, which a curve survives.

Then the thread missed its orbs. Measured at 1440: orb centre 406, curve end
422 — because the orbs were aligned to their columns' inner edges while the
curve leaves at 25% and 75% of the row. Centring each orb in its half put them
within sixteen pixels, which reads as a thread leaving the orb's edge.

## The orbs are the product's orbs

`BusinessLensIcon` and `planetStyle` come from `business-map.tsx` and
`.business-brain-planet` is the same material the map draws. `planetStyle` was
exported and narrowed to `Pick<BusinessBrainNode, "health">` — all it ever read —
because the alternative was casting a one-field object through `unknown` to
satisfy a parameter the body never touches, or copying four RGB triples into a
marketing file where `149 146 138` would quietly stop meaning *unscored*.

## Every orb says "Not assessed"

Nine dashes on a landing page is a strange thing to show and the correct one.
It is the claim the block exists to make: an area Vibe cannot see stays
unscored, never scored zero, never averaged in. A guard counts nine and fails if
any orb carries a digit.

## A guard that was matching code instead of copy

`invents no scores, testimonials or customer numbers` failed on the new block
because of `viewport={{ margin: "0px 0px -10% 0px" }}` — a scroll threshold, read
by a rule about invented statistics. The test already stripped `style={{…}}` for
exactly this reason ("a gradient stop at 50% is a colour, not a claim"); the
principle was simply wider than the one attribute it was written for. It strips
any object-valued JSX attribute now.

The same test pinned a sentence that lived in the deleted component. What it is
pinning now is the *claim* — "Never scored zero, never averaged in" — rather
than the wording that happened to carry it.

## Three guards, each broken to prove it

Nine treads named by the audit's own labels · nothing scored, nine "Not
assessed" and no digits · sides alternating `LRLRLRLRL` measured from page
positions, with eight threads for nine orbs.

Mutations: every orb forced to one side, a thread added off the last orb, and an
orb given a score. All caught. Two earlier attempts at the first two mutations
failed the **build** instead of the test — an unused `index`, an unused `last` —
so they proved nothing until they were rewritten to compile.

Unit 9,475 · browser 774 with 3 new · tsc clean · eslint 0 · build clean
