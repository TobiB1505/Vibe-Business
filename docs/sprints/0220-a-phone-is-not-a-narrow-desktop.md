# Sprint 0220 — A phone is not a narrow desktop

**Renumbered:** written as 0214 on 2026-09-10, moved to 0220 on 2026-09-11 — `main` had meanwhile numbered its own sprint 0214 ([THE SCREEN NO FOUNDER COULD REACH](0214-the-screen-no-founder-could-reach.md)), and two records cannot share a number. The work and its date are unchanged; this is the second such collision on this branch, after 0166.
**Date:** 2026-09-10
**Decision:** [ADR 0108](../decisions/0108-a-phone-is-not-a-narrow-desktop.md). The shell only; the screens follow.

## What the measurement said

Production build, 390×844, v2 palette. Nothing here was reported by a test, because nothing here is the kind of thing a test was asking.

| | before | after |
|---|---|---|
| `main` begins | y=476 | **y=56** |
| page heading | y=546 | **y=126** |
| sideways scroller | 836px of sections in a 358px window | **none** |
| shell controls under 44px | 8 | **0** |

Four hundred and twenty pixels of an 844px screen, spent on chrome, given back.

## The sentence this turned on

**A rail is not a thing that gets smaller.** On a wide screen a column down the left is peripheral — the eye starts on the content and the navigation waits at the edge of vision. Stacked into one column by `flex-col lg:flex-row`, its *position* starts saying "read me first", and it says it about chrome.

The account level suffered worst. The balance and the identity belong to the whole account rather than to the product being looked at, and they ended up above the product's own heading because the rail's footer became the page's third paragraph. Hence two levels in two places: sections along the bottom where the thumb is, account behind one avatar in the corner.

## The shape, and why `empty:hidden` still governs it

Below `lg` the `<aside>` becomes a layer — `fixed inset-0`, `pointer-events-none`, no surface — and its children place themselves. A layer rather than three separately-mounted fixed elements, because `empty:hidden` is the one rule deciding whether this product has chrome at all and it can only decide that about one element. Onboarding and the connect flow lose the whole of it in one declaration, exactly as before, and `:has()` reserves the two bars' heights only where there are two bars to reserve.

Four sections plus *More*, not six, because a tab is a fifth of 390px and at six the labels stop being words. Each section carries a one-word `short` name in `PROJECT_SECTIONS` beside its full one, so the two names cannot drift into a lookup table in a component.

*More* carries a dot exactly when something behind it is waiting, derived from the same `count` and `status` the visible tabs render. Hiding a section hides its count with it, and Agent — where a prepared change waits — is behind there. A dot that could appear when nothing is waiting would be a fabricated signal, so it reads the items rather than a flag.

## Three defects that were already there, and one the guard found

**The consent banner covered the navigation.** `z-50` fixed to the bottom, over a `z-40` tab bar: every tap on a section was intercepted, and a founder who had not answered the cookie question could not move around the product. No test had ever seen it, because `playwright.config.ts` sets a refusing consent cookie for the entire suite — the banner appears in exactly one spec, and that spec does not look at navigation. **A fixture that makes the suite deterministic also makes one surface invisible to it**, and this is the second time on this branch that a guard was blind to something adjacent to its subject.

**`Sheet`'s bottom variant was never a bottom sheet.** A modal `<dialog>` is given `inset-block: 0` by the browser; a fixed box pinned at both ends with `height: auto` fills, so `mt-auto` had nothing to push against. Its height cap was also set in two places — `max-h-dvh` in the shared list and `max-h-[85dvh]` in the side — and `cn` is a filtered join, so both shipped and stylesheet order picked the wrong one. Measured: 844px tall in an 844px viewport.

**v2's `.vibe-overlay` set `position: relative` on dialogs.** Right for a panel, whose sheen it anchors; wrong for a modal dialog, where it replaces the positioning the platform gives a top-layer element.

And the new guard earned itself immediately: **the tab bar was transparent in v1.** `--color-surface-1` there is a 2.4% white — a film meant to sit on the page's ground, which is exactly what a bar fixed over scrolling content does not have. Both palettes composite their film over `--color-ground` now.

## What was not built

The screens. Page content still carries its own touch targets under 44px, its own dense rows, and on the landing page the consent banner still lands on the hero's primary action at 390px. This was the shell, on purpose, so the direction could be looked at before everything moved.

## A measurement that was wrong

The first report from this session said the landing page opened on a blank screen at 390px. It did — in a dev server that was answering its own JavaScript chunks with 403, so nothing hydrated and no entrance animation ran. On the production build the hero is there. The lesson is the one this repository keeps relearning from the other direction: **a measurement is only as good as the thing being measured**, and a browser that agrees with your suspicion deserves a second question rather than a fix.

Unit 9,498 · browser 826 with 10 new · tsc clean · eslint 0 · build clean
