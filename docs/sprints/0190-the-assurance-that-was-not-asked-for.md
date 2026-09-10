# Sprint 0190 — The assurance nobody was asking for

**Date:** 2026-09-08
**Decision:** remove "How repositories are used" from the repositories page.

## What was asked

Sprint 0189 audited the repositories page and named this block as the one finding it *reported but did not act on* — a disagreement rather than a defect, left alone because nobody had asked. The founder asked.

## The argument, restated because it is now the reason

Four tiles of assurance prose — bounded analysis, product context, secure by design, you stay in control — at the foot of a management list.

**"What does Vibe do with my code" is a question asked in the connect flow, not here.** Somebody on this page connected their repositories already; they came to see which ones, and on which branches. Answering a question they finished asking weeks ago costs them the bottom of every visit, and on a phone it was ~600px of a 2,466px page.

Assurance that arrives after the decision is not assurance, it is reassurance — and this product's own writing rules are against saying a thing where it does not land.

## What went

The block, the `TrustItem` component it existed for, and the three icons nothing renders any more. Nothing in the assurance was untrue and nothing was moved elsewhere: the claims it made are stated where they are load-bearing — in the connect flow, in `/privacy`, and in the terms.

## Validation

Unit 8,884 · browser 645 · lint 0/0 · typecheck clean · no migration. Page height 1,050 → 1,000 at 1440 and 2,466 → 2,015 at 390 — **451px off a phone**, which is most of what the block cost.

## A note on Sprint 0189

It says, in a section headed *What was found and deliberately not changed*, that this block stays because nobody asked for it to go. That sentence is now false at HEAD and it is **not** being edited. `docs/sprints/` is a record: it says what was true when written, and it was.
