# 0213 — The ranking the screen threw away

**Date:** 2026-09-07
**Renumbered:** written as 0166 on 2026-09-07, moved to 0213 on 2026-09-10 — `main` had meanwhile numbered its own sprint 0166 ([THE PART SHE HAS NOT SEEN](0166-the-part-she-has-not-seen.md)), and two records cannot share a number. The work and its date are unchanged.
**Decision:** [ADR 0103](../decisions/0103-glass-is-the-material.md) (material); this record covers the dashboard composition, which needed no new decision.

## The founder's instruction

> „danach die skills und mcp verwenden um ein ganz neues Dashboard zu bauen"

Preceded by the review of the same screen, one screen at a time, in both palettes.

## What the audit found, and what it got wrong

Four things were checked at 1440px and 390px, in both palettes, across the scored, unscored and empty fixtures.

Two candidate findings did not survive being measured, and are recorded because an audit that only lists confirmed problems cannot be told apart from one that stopped early:

- **"A nav item is off-screen at 390px."** `Team · SOON` sits at x 438–474 in a 390px viewport, and the first probe reported `overflow-x: visible`. The probe read the `<nav>`; the `<ul>` inside it is `overflow-x-auto` with a mask on its right edge, `scrollWidth` 544 against `clientWidth` 358. It scrolls. Not a defect.
- **"Chrome glass bands the empty rail."** Luminance down the rail every 8px, with and without `.vibe-chrome`: spread 8.13 against 8.08. The variation is the grain and the ramp, present either way. Not a defect.

One was real and is the whole of this sprint.

## The ranking the screen threw away

`buildAttentionItems` produces a tiered, ordered list of everything waiting — `blocked`, `decision`, `ready`, `setup` — each with a title, a sentence and its own action. CORE-6 removed the list from `/app` and kept only the count in the subtitle and the ordering of the grid, on the argument that "the information was per-product and already encoded in each card's action".

`attention.ts` contradicts that in its own comment:

> a project with a failed validation and waiting moves genuinely needs attention twice, and hiding one behind the other would mean the user never sees it

A card has one action. So on the three-product fixture, Payflow raises a **blocked** failed validation *and* waiting moves; the hero offered "View action plan", the card offered "Review change" — which is the *waiting* change — and the word "failed" appeared nowhere on the screen. The tier was not rendered at all: a blocked validation and a never-run audit were the same rectangle with a different verb.

## What was built

**`AttentionStack`**, beside the hero rather than above the grid. It renders what the product already ranks: tier dot, project, title, one sentence, one action. It is a level-2 panel next to a level-3 card, so CORE-6's real win — one primary object — is untouched.

**The hero's own item is dropped by what its control answers**, not by position. The first attempt dropped `attention[firstIndexOfHero]`, which on Payflow removed the *change* and left the *move* — so the screen offered the move twice and still never mentioned the change. It is now keyed on `moves_waiting` / `never_audited` / `no_repository` depending on which control the hero is actually showing.

**The hero lays out against its own width.** Putting a panel beside it took the card from 1080px to 652px, and `xl:grid-cols-[9.5rem_minmax(12rem,0.9fr)_minmax(18rem,1.3fr)]` is 696px of hard minimum. Measured: the inner grid was 696px inside a 586px content box and the chart hung 77px outside the card, painted over the panel next to it. A viewport breakpoint cannot be right for a card whose width no longer follows the viewport, so the card is an `@container` and the three-column tier is `@3xl`. First use of a container query in this repository.

**Connect moved into that column**, because the column was otherwise a tall empty space beside a tall card, and it is the one thing on the screen that belongs next to the list rather than after it. The column is sticky at the same 44px the content opens at.

**The balance reaches the phone.** The account rail's credits were `hidden lg:flex`, so below 1024px the account shell showed no balance at all — on screens that offer priced actions. A price without a balance is half a disclosure, and that argument does not stop at a breakpoint.

## The ceiling moved, and this is the argument

`account-dashboard.spec.ts` caps the screen at 36 countable elements and says in its own docblock that a new ceiling has to be argued for in the sprint record. This is that.

The budget exists to stop the screen growing unrelated strips — "a usage strip, a recent-activity list, a repository count, a plan nudge". The stack is none of those: it is the same ranking that already chooses the hero and orders the grid, and the count of *objects* is unchanged at four, because the signal and the next move are one card and connect moved into the stack's column.

Measured: 31 today, of which the stack is 7. Its worst case is four rows rather than two, so 37. The ceiling is now **40**, which leaves the three or four elements of headroom the old number left. The activity feed stays gone and the test still says so.

## What is not here

The product grid was left alone. Moving it into the right column as compact rows would have made the page one screen, and it would have cost the sparkline, the three facts and the per-card action — depth that `/app/products` does not duplicate so much as extend. It is a real alternative and it was refused, not overlooked.
