# Sprint 0216 — A thumb is not a cursor

**Date:** 2026-09-10
**Decision:** no new ADR. [ADR 0108](../decisions/0108-a-phone-is-not-a-narrow-desktop.md) said the shell was first and the screens would follow it; these are the screens.

## What the sweep said

107 fixture routes, 390×844, v2. Two results, and the second is the useful one.

**No horizontal overflow anywhere.** Not one route. That rule has been enforced for long enough to hold on its own.

**About three hundred and forty controls a thumb could not reliably hit** — and they were not scattered across screens. They were four shared shapes:

| shape | instances | routes |
|---|---|---|
| `Button`, at its measured 40px | ~134 | 47 |
| a hand-written `<summary>` in `change-gates.tsx` | 48 | 24 |
| `Disclosure`'s trigger and `plan-detail-panel`'s expander | 40 | 16 |
| `SeeMore` | 22 | 18 |

Fixing screens would have been fixing the same four things forty times. **The sweep is what turned a list of pages into a list of components.**

## Why the controls did not get bigger

Because 40px was measured, not picked. `button.tsx` records both candidates being built and screenshotted: at 44px, 47 dense controls grew and broke the chrome they sit in — "Manage connection" and the wallet pill each wrapped to two lines. That decision is still right, and it is right on a phone, where those controls have less room rather than more.

So the drawing is untouched and the **tappable box** is not: `.vibe-tap` centres a transparent box of at least 44×44 on the control. Nothing reflows, nothing wraps, and a thumb hits what it is aiming at — which is what the target-size rules are about.

**`pointer: coarse`, not a width.** The condition is a finger. A phone in landscape is 844px wide and still a phone; a desktop window dragged narrow is still a mouse, and growing its hit areas would make controls swallow each other for a pointer that never needed it. Measured: with a mouse at 1440 the pseudo-element's `content` is `none` and the button is 40px; with a touchscreen at the same 1440 it is 44px of hit area around the same 40px of button.

Inline links in prose are exempt and stay exempt. A 44px target in running text is a paragraph with holes in it, and the rules say so.

## The trap in my own utility

`.vibe-tap` sets `position: relative`, because the pseudo-element needs a positioned box and most controls have none. Written as a bare rule it **beat `absolute`** — an unlayered declaration wins against every layered one however specific, and this class is on every button in the product.

Nothing was broken by it: swept across all 107 routes, no `vibe-tap` element had its own positioning overridden. That is exactly what made it worth closing rather than leaving. The first absolutely-positioned button to gain the class would have moved, silently, and the only signal would have been somebody noticing a control in the wrong corner. It lives in `@layer components` now, where a utility wins.

## What the cookie banner cost, and what it still costs

Stacked, its three controls were 136px and the banner came to **330px — thirty-nine percent of a 390px screen**, sitting on the landing page's only call to action, which measured untappable underneath it.

The three buttons are one wrapping row now: **330 → 245px**. Not a word of the copy moved, because what this page says about cookies is a legal decision and not a layout one.

**And that did not solve it.** The hero's control sits at y=632 and the banner now starts at 600, so it is still covered while the banner is up. Solving it would mean restructuring the hero — a shorter Nova pill, a tighter card deck — to win a case that one tap already resolves. That is optimising the wrong thing, so it is written down here rather than done quietly.

## The measurement that had to change with the fix

The first sweep read `getBoundingClientRect()`, which measures the drawing. The whole point of this change is that the drawing did not move — so the same measurement would have reported the same three hundred and forty failures on a fixed product.

The test asks the real question instead: **is the control the thing that answers twenty pixels above its own centre?** `document.elementFromPoint`, inside the 44px band and outside a 40px control. It went from ~340 to 3 to none, and the 3 were one hand-written button that never used `buttonClasses` at all.

Unit 9,508 · browser 839 with 8 new · tsc clean · eslint 0 · build clean
