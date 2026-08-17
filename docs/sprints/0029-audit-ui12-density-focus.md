# AUDIT UI-1.2 — Density, Focus & Reading Flow

**Status:** implemented; validated in the browser at 1440 / 1280 / 1024 / 375. Real-project dogfood pending.

## Problem

UI-1.1 put the right things on the screen and then said several of them more than once.

The screenshot the founder sent back showed it plainly. Three of the four largest text blocks on
the viewport were the same blocker: once as a full explanation in the right column, once again in a
"Where I'd start" card a screen below, and a third time inside the reasoning trail. The hero
conclusion ran at 40px and pushed the map below the fold on a 1280 laptop. The right column mixed
strength paragraphs with blocker paragraphs at a measure too narrow for either. And underneath it
all sat a collapsed "Technical breakdown" containing the five legacy dimensions the nine lenses had
replaced — a second, competing verdict on a page whose entire value is making one.

This was not a "make it prettier" sprint. It is an information-architecture fix with one rule:

> right column = **scan** · detail below the map = **understand**

## Changes

- **Right column is priorities only.** `CurrentPriorities` renders rank, lenses, materiality,
  headline, and the explanation clamped to two lines. Nothing else competes for that measure.
- **The full argument moved below the map.** `SelectedProblem` carries the unclamped explanation,
  why it matters, and "How Vibe reached this" — at a width those paragraphs were written for.
- **"Where I'd start" is gone as a card.** Its claim is now a `Start here` marker on priority #1,
  which is where the claim already was.
- **Strengths moved below the panel** as a compact three-column row, two lines each.
- **The hero dropped to 28–34px** (from 40px) across breakpoints. Still first, no longer a billboard.
- **The legacy five-dimension Technical breakdown is no longer rendered to a customer at all.**
  `audit-conclusion.tsx` and `business-audit-summary.tsx` were deleted with it, both already dead.
- **The map became legible**, which turned out to be the largest change in the sprint (below).

## The map defect this sprint actually found

The brief asked for the ring labels to move left. Moving them exposed something worse: **the lens
cards overlapped each other**, and had since UI-1.1.

Nine lenses sit at fixed angles 40° apart — fixed because a lens keeping its position across audits
is what makes the map learnable. Two cards on one ring are `2r·sin20°` apart along the chord, but
two rectangles only overlap when they are close on *both* axes, so the binding pair is the one whose
separation splits evenly between x and y. At the shipped radii that pair's clearance was negative,
and Offer/Audience overlapped on every single audit.

Ring radii and card widths were therefore not chosen by eye. They were solved against the worst
arrangement the data can produce — **all nine lenses on one ring** — rather than against the
arrangement in one fixture, since which lens lands on which ring changes with every audit.

`now 0.66 · soon 0.80 · later 0.98`, cards at 5.5–5.75rem.

None of this was visible to a unit test. `buildBusinessMap` was correct the whole time; the geometry
lives in CSS. So the assertion is a browser one: **no two lens cards' bounding boxes intersect, and
no ring name sits underneath a card** — at 1440 and 1280.

## Architecture intentionally unchanged

- The Business Map view model, its fixed angles, its ring assignment and its connections.
- Health independent from materiality; mint means Vibe's attention, never "healthy".
- Connections stay undirected and labelled "Judged together with"; no causal arrows were added.
- The audit contract, synthesis, rubric, prompt, evidence ids and provenance labels.
- Lifecycle states: `preparing`, `analyzing`, `needs_user`, `completed` keep their semantics.
- The five dimensions are still measured, still stored and still cited by the lenses. What changed
  is that a customer is no longer shown two verdicts and asked to reconcile them.

## Validation

- `tsc --noEmit`, `eslint --max-warnings=0`, `next build` — green.
- **3314 unit tests** green.
- **151 Playwright tests** green, including three new ones for map legibility.
- Screenshots reviewed at 1440, 1280, 1024 and 375.

Nine E2E assertions had to be rewritten rather than deleted, and the reason is worth recording: a
lens name now legitimately appears in two places — the map node and the priority spanning that lens
— so unscoped `getByRole("button", { name: /revenue/i })` became ambiguous *by design*. Every lens
assertion is now scoped to the map panel.

## UI-1.3 — what the first live dogfood found

Screenshot of the real `/score` on the deployed build, four things wrong. Three of them were
introduced by this sprint's own density pass.

**The lens cards were too narrow.** Cut to 5.5–5.75rem to buy overlap clearance, which made
"Revenue & Economics" wrap to three lines and left the health bar cramped against the edge.
Fixed by trading width for height rather than accepting less of both: cards are 7rem wide and
shorter, and the radii were re-solved for the new aspect (`now 0.68 · soon 0.78 · later 0.94`).
Wider-and-shorter clears the same worst case as narrower-and-taller, because the binding pair is
the one whose separation splits evenly between x and y.

**The Next Moves handoff had shrunk to a text link** wedged between priority #1 and priority #2,
belonging to neither. The one place the audit hands work over was the quietest thing in the
column. It is a primary button after the list now, which is also where it belongs in the
argument: *these are the priorities, here is what Vibe would do about them.*

**Two "1"s and two "2"s on the map.** A blocker spans several lenses and the rank was stamped on
each, so the map looked like it could not count. The rank belongs to the *problem*; `blockerPrimary`
says which lens carries it, and the others are marked by mint and by the line that ties them
together. Writing the test for it caught a second defect in the first fix: leading with
`lenses[0]` unconditionally meant a blocker whose first lens was already claimed by a
higher-ranked one had its number drawn nowhere at all.

**Mint had stopped meaning one thing.** It marked the Now ring, the selection and the rank at
once, so a healthy "Adequate / Now" lens wore the same colour as the problem the audit wanted
read first. Reserved for the top-three blockers; when a lens matters is already carried by its
radius, the ring's name and the word in the card.

Plus two contrast fixes raised by the same review: the ring names and the card's health/materiality
row were the lowest-contrast text on the page, and that row is the *word* half of a channel that
must never be colour alone.

## UI-1.4 — the rings had stopped meaning anything

Second live look, one sentence from the founder: the three rings sit so close together that the
distance says nothing.

Correct, and the cause was not a design choice. `now 0.68 · soon 0.78 · later 0.94` were the
*smallest* radii at which nine cards on fixed per-lens angles stop overlapping — two neighbours
40° apart are `2r·sin20°` apart, so a small inner ring guarantees a collision. The geometry was
dictating the meaning, and the meaning is the whole map: **closer to the centre = sooner**.

**The trade.** Lenses no longer keep a fixed absolute angle. Each ring spreads *its own* nodes
evenly over the full circle, so a ring holding three lenses gets 120° of clearance instead of 40°
and can sit far inside without its cards touching. The typical audit now lays out at
`0.40 · 0.66 · 0.92`.

What is kept is the property a returning reader actually uses: lenses run clockwise from the top
in canonical order *within their ring*, and a lens that improves moves visibly inward. The fixed
bearing was defended on exactly that re-audit argument — and it was costing the thing it claimed
to protect.

**How a layout is chosen** (`src/modules/business-audit/map-layout.ts`): outward, one ring at a
time. Start at the ring's preferred radius raised to the minimum its own node count needs; of the
rotations that clear both the score at the centre and every card already placed, take the one with
the most room to spare; otherwise push outward; if the outermost ring runs out of room, compress
the preferred radii and start over — pulling the inner rings in rather than letting the outer one
collide.

Two things that only showed up on screen. Taking the *first* rotation that fits left every ring
starting at twelve o'clock, so all three put a node straight up and the map read as a vertical
list with circles behind it — hence "the most room to spare". And the readiness score is not a
card, so nothing in the collision maths protected it: it is an explicit obstacle now.

**The test is the guarantee, not the algebra.** Which lens lands on which ring changes with every
audit, so `map-layout.test.ts` checks **all 55 distributions** of nine lenses across three rings —
no overlapping cards, no card over the score, rings strictly ordered, layout deterministic. The
browser suite checks the same two claims against real bounding boxes at 1440 and 1280, because the
card sizing lives in CSS and the layout maths does not know about it.

## Residuals

- **The right column is still shorter than the map.** The handoff button closed some of it, but a
  square map beside two priorities leaves dead space at wide viewports. Shrinking the map is not
  available: the radii are already the minimum that keeps nine cards from overlapping. Closing it
  properly means giving the leftover width to the detail panel, which is a layout change rather
  than a density one.
- The ring names still sit at the largest gap in the arrangement rather than on a chosen axis.
  With the rings spread apart they now read as a near-horizontal axis, but that is a consequence
  of this audit's data, not a guarantee.
- The map's constellation can sit off-centre within its square, because each ring's rotation is
  chosen for clearance rather than for balance.
- Two `<details>` disclosures now sit in the detail panel — the lens's own evidence and the
  problem's reasoning trail. They are scoped differently and labelled differently, but a founder
  seeing both for the first time is worth watching during the dogfood.
