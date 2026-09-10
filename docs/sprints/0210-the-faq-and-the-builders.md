# Sprint 0210 — The FAQ, and the builders under the button

**Date:** 2026-09-10
**Decision:** the objections become an FAQ that opens, and the list of where a product was built moves to the hero's own screen.

## What was asked

*"Das machen wir ein FAQ, aufklappbar — und die Tool-Leiste mit Lovable, Emergent, v0, Bolt, Base44 und den ganzen Erstellungsseiten kommt direkt unter die Hero-CTA."*

## The FAQ is the better form of the same argument

0209 set the doubts in display type with the answers permanently beneath, arguing that a page which has spent eight blocks explaining itself should let the objection be the loudest thing on screen.

An FAQ keeps that and improves it: five sentences a reader can scan for **theirs**, and only that one has to be opened. Nothing is hidden — every answer is in the document and in the page's own text — it is ordered behind the question it answers, which is what `Disclosure`'s docblock has argued in this repository since UI-3.5.

`<details>` rather than a client component, for the reasons that file already records: keyboard operable, `aria-expanded` for free, works with JavaScript off, no hydration. A browser guard opens a row **with JavaScript disabled** and asserts the answer appears, because that is the whole reason for choosing the platform's accordion over a written one.

`Disclosure` itself is not reused: its trigger is a ghost pill sized to its label, and an FAQ row is the width of the list with the whole row as the control.

## "Directly under the CTA" is a position on a screen

The builders list was four blocks down the page, where a visitor had already decided whether the product was for them. Under the button it answers the first question they have — *is this for what I built?* — and the answer is a list of the places they built it.

It sits **inside** the hero's own screen rather than below it, which is the difference between answering that question and answering it later. That cost 32px of height, so:

- the label and the names share one line instead of stacking;
- the hero's padding drops from `py-10 sm:py-14` to `py-8 sm:py-10`.

Measured at five viewports: 1440×900, 1440×1000, 1280×800 and 1512×850 all fit. **390×844 does not** — the hero card alone is 817px in an 844px viewport, so nothing fits beside it, and on a phone the strip is the first thing a scroll reveals. That is stated rather than hidden, and a guard asserts the desktop case at 1440×900 so it cannot quietly regress into "four blocks down the page, just closer".

## Named products, and nothing else

Lovable, Emergent, v0, Bolt, Base44, Replit — then *"and whatever else you built it in"*, because a list of six is a category rather than a roster. No logos, no "trusted by", no customer count: a list of where a product might have been built is a fact about Vibe, and a logo wall is a claim about somebody else. The guard asserts no image, no endorsement vocabulary, and the honest closing clause.

Six guards across the two changes, three mutations: every row opened by default, a named builder deleted, and the strip pushed below the fold with a large margin. All caught.

Unit 9,486 · browser 806 with 3 new · tsc clean · eslint 0 · build clean
