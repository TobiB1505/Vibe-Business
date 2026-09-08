# Sprint 0172 — The mark that floated, and the name that did not fit

**Date:** 2026-09-07
**Decision:** none. This is craft inside [ADR 0106](../decisions/0106-the-rail-is-a-layout-per-area.md); nothing about the rail's shape or its data changed.

## What was reported

The fold is fluid now. Three things about the rail itself:

1. The lockup sits in the middle rather than at the top and does not look good. Pull it up, and let everything follow so the rail has area and air.
2. `Vibe-Business` is severely truncated in the switcher — maybe make the mark smaller, or change something else.
3. Business Health and My Product could sit further up; the space is not being used. *"Wahrscheinlich liegt es wieder an irgendeinem Layer-Problem, weil wieder alles handgezeichnet ist und nicht eigentlich ein Design System."*

## And one thing that was not reported

**Nova was missing from the navigation.** The screenshot shows the rail starting at Business Health, on the Nova page. Six sections exist; five were rendered.

## What was actually wrong

All four are the same defect seen from four sides, and the founder's guess about it was right.

The rail's spacing was set element by element and never as a system: `pt-[--shell-top]` (44px) above the lockup, a 37px box around it, `gap-7` between regions, `pt-8` on the foot, `my-3` and `mt-3 pt-3` on the dividers. Measured at 780px — a 13" screen with browser chrome — that left the section list 219px for 299px of rows. Two of six sections were behind a scroll.

The lockup was 50px down its own surface because it was centred inside a box the height of a page heading's first line, so the mark and the heading beside it would read as level. That is a real argument, and it was chasing an alignment between two columns that do not have to agree — at the cost of the navigation running off the bottom of a laptop.

The name had **74px**. The trigger carried a 24px mark, the name, the plan badge and the selector glyph on a 256px rail; `Vibe-Business` measures 97px at that weight, so it rendered as `Vibe-B…`. A control that truncates the one thing it exists to say has spent its width on the wrong half.

And Nova: the list is a scroll container, and **the browser was scrolling it**. Scroll anchoring adjusts a container's `scrollTop` to keep visible content stable when something above it changes height — which is exactly what happens when the rail's skeleton is replaced by the real list, one row taller. On a navigation that means silently scrolling past the first section. It is a production-only symptom, because the fixture renders the real rail with no skeleton before it.

## What was built

**Two numbers, and every region of the rail reads one of them.** `--rail-inset` is the space above the lockup and below the identity; `--rail-gap` is the space between the rail's three regions. `--shell-top` stays what it is — the content column's top padding, a different question with a different answer — and the rail no longer borrows it.

The lockup starts at the top of its own surface. The dividers and the foot follow the same rhythm.

**The trigger drops the mark.** The lockup is directly above it and the panel keeps the marks where they help you tell products apart. The name now gets 113px against the 97px `Vibe-Business` needs — measured against the *longest plan name*, `Builder`, not the fixture's `Free`.

**`overflow-anchor: none` on the section list.** A navigation's natural position is its top, always.

## What it measures

At 780px the section list is 309px in a 309px box: nothing scrolls, all six sections are on screen, and there is room left over. The lockup is 20px from the top of the rail, down from 50px.

## What the guards say now

Four new browser assertions, each mutation-tested by putting the old behaviour back:

- The lockup starts within 28px of the rail's top. Restoring the centring box fails it.
- Every section of a product fits at 780px, and Nova, Business Health and Experiments are all visible. Restoring the old padding fails it.
- The scroll container's computed `overflow-anchor` is `none` and its `scrollTop` is 0 at 700px. Removing the class fails it.
- The product's name gets more than 105px. Putting the mark back on the trigger fails it — it drops to 89px.

The name budget is asserted rather than the fixture's own name, which is `Acme` and would prove nothing about a name that does not fit.

## What was traded

The lockup no longer aligns with the first line of the page heading beside it. That alignment was deliberate, it was computed from the type scale rather than nudged, and it is being given up on purpose: a mark at the top of its surface reads as the top of the product.

The switcher has no product mark at rest. Keeping an 18px one would leave the name 89px against the 97px it needs; the only way to have both is a wider rail, which takes width from the page.

## Validation

Unit 8,840 · browser 593 · lint 0/0 · typecheck clean · no migration.
