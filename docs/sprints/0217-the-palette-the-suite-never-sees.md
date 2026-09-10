# Sprint 0217 — The palette the suite never sees

**Date:** 2026-09-10
**Decision:** no new ADR. [ADR 0108](../decisions/0108-a-phone-is-not-a-narrow-desktop.md)'s screens, continued — and one finding about the suite that is worth more than the screens.

## What a design review measured

98 fixture screens at 390px. The median prose column was **284px, about 47 characters** — a good measure. The product is largely fine on a phone, and the useful part of the review was the tail:

| screen | prose column | why |
|---|---|---|
| product scan | **5px** | a `min-w-0 flex-1` column shrank instead of wrapping the 175px button beside it |
| billing | 147px | `justify-between` with a `shrink-0` right column, no wrap |
| action plan | 162px | a 48px hanging indent inside a well that already starts 57px in |
| business health | 202px | 48px of every line reserved for an `aria-hidden` ornament |

All four are one shape: **a two-column row that stays two columns on a phone.** None of them overflowed, so nothing caught them — a layout that squeezes rather than wraps stays inside the viewport, and stays inside every rule about staying inside the viewport.

Fixed at 390 and below only, `max-sm:` throughout: the text column gets a basis so the wrap has something to trigger on, two rows stack, the hanging indent shortens, the ornament shrinks. Worst case went from 5px to **222px**. Measured at 1440 afterwards, the four originals are untouched — `flex-basis: 0%`, a row that is still a row, and two gutters still at their measured 48px — and a browser test says so rather than a diff.

## And then the mutation passed

Removing the first fix and re-running the guard: **eight passed.** Twice, and the second time with no stale server to blame.

The paragraph really was five pixels again. The guard really did look at it. It passed because **the browser suite runs the v1 palette and the defect only exists in v2** — same screen, same width, same build: v1 gives that paragraph 256px, v2 gives it five.

Everything in this review was measured against a server started with `VIBE_PALETTE=v2`, because that is the design being worked on. The suite's own server sets no palette at all. So a guard written the obvious way runs in the palette where the defect does not exist, passes forever, and guards nothing.

That is the **third** time on this branch that a fixture which makes the suite deterministic has made a surface invisible to it. UI-35 found the consent cookie, which hid a banner covering the whole navigation. UI-36 found a voice sweep built with default arguments. This is the largest of the three, because it is not one fixture hiding one surface — **it is every browser test in the repository running a palette the product is moving away from.**

The reading guard forces v2 through `localStorage`, which is the override the product already has. It is a patch on one spec, not an answer.

## The other half of the same failure

The first version of that guard could not have caught anything anyway: it collected paragraphs, filtered to the squeezed ones and asserted the result was empty. **An empty set passes an "is empty" assertion.** It now asserts it examined something first — the same guard the identity sweep in UI-36 already carried, which should have been the default here and was not.

## What was not changed

`text-[0.68rem]`, `text-[0.65rem]` and `text-[0.62rem]` appear across the product understanding and audit surfaces. Arbitrary values where `text-label` exists are a defect by this repository's own rule, and every one of them is on a desktop path as much as a phone one. Changing them is a design-system pass, not a mobile one, and this work was mobile only.

Unit 9,508 · browser 847 with 8 new · tsc clean · eslint 0 · build clean
