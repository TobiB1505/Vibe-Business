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

## Residuals

- **Real dogfood on a signed-in project is still outstanding.** Every check above ran against
  fixtures.
- The `/score` route returned a server error on the last deployed build. Never diagnosed, and not
  touched by this sprint.
- Two `<details>` disclosures now sit in the detail panel — the lens's own evidence and the
  problem's reasoning trail. They are scoped differently and labelled differently, but a founder
  seeing both for the first time is worth watching during the dogfood.
