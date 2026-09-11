# Sprint 0219 — The cap that survived the stack

**Date:** 2026-09-11
**Decision:** no new ADR. One defect the founder found on their own phone, the sweep for others like it, and the two guards that would have caught it.

## What the screenshot showed

The Agent page on a real phone. The heading and the prose run the full width of the page; the three-fact panel under them stops at about **62%** — a card that reads as having failed to load the rest of itself.

One line: each fact carries `max-w-[230px]`. Above `sm` the three sit side by side and 230px is exactly right. Below it they stack, and each one **keeps the cap**. `max-sm:max-w-none` is the whole fix.

## Why no sweep here found it

Two reasons, and the second is the one worth keeping.

It does not overflow. Nothing throws, every element is present, the page scrolls normally — and 98 fixture screens measured at 390px reported nothing, because the sentence inside the card is 37 characters and [sprint 0217](0217-the-palette-the-suite-never-sees.md)'s prose sweep only looks at paragraphs over 45.

And **the component lives in no fixture at all.** It sits in `WorkspaceSection`'s `actions` slot on the real Agent route, which needs a session and a project. Nothing in the browser suite had ever rendered it. There is a fixture now — `agent-trust-panel` — and that is the part of this that keeps mattering after the CSS stops being interesting: a surface no test can reach is a surface no test protects, however many tests there are.

## The sweep for others like it

The rule is narrow enough to state: **a fixed maximum width under a phone's own is a decision, and a decision has a reason.** Seven in the repository are under 360px without a `w-full` beside them. Six are deliberate and now say so in `narrow-widths.test.ts` — two planet captions, two customer logos capped so a wide wordmark cannot set a row height, a table of contents that is `hidden xl:block`, and a design study reviewed at a desktop measure.

The seventh was this one.

That guard is a source sweep rather than more browser tests, for the reason above: the browser can only check the screens it can reach, and this was not one of them. A width written in a class string is visible whatever route renders it.

## Both guards were wrong first

The source sweep reported `agent-header.tsx` on its first run — for the **sentence in its own docblock** explaining the cap, not for the cap. A rule that reads prose fails whenever somebody writes about it. It strips comments now, the way `nova-ui.test.ts` already did.

The browser guard measured the **panel** and passed with the cap still on. The panel is a block-level flex column; it fills its parent whatever its children do. The capped thing is each fact, so each fact is what has to be asked — which is the fifth time on this branch that a guard has named something adjacent to its subject, and the first time it happened twice inside one sprint.

Unit 9,510 · browser 850 with 2 new · tsc clean · eslint 0 · build clean
