# Sprint 0203 — The bar that gets out of the way

**Date:** 2026-09-09
**Decision:** the marketing nav leaves on the way down and returns on the way up.

## What was asked

*"Den Header beim Scrollen ausblenden, nur wenn man nach oben fährt soll sie
aufblenden — sie stört beim Scrollen."*

## Why the pattern fits this page in particular

A page whose whole shape is a scroll spends its top 4.5rem on chrome that is
useful at exactly two moments: at the top, and when a reader has turned back
because they want out of the scroll. Between those it is a band across the
subject — which is what the founder was looking at, and what every screenshot in
the last four sprints shows sitting over a heading.

## The three things that would have made it a bad trade

**Moving the page.** The bar is `sticky`, so its space in the flow belongs to
the top of the document; a transform takes it off screen and nothing below it
shifts. The third motion obligation is met by the mechanism rather than by a
reserved box.

**Taking an action away from a reader who asked for no movement.** Reduced
motion keeps it pinned. *Sign in* and *Get started* stay on screen, which is
what that setting is for: the same information without the movement, and the
hide-on-scroll is a convenience rather than information, so removing it costs
that reader nothing.

**Hiding a control the keyboard is inside.** A bar translated off screen still
holds five focusable links, and tabbing into one that cannot be seen is worse
than never hiding it at all. Focus anywhere inside brings it back.

Direction is read from accumulated movement rather than from each event: a
trackpad emits sub-pixel deltas in both directions, and a bar that reacted to
each one would flicker. Eight pixels in one direction is the threshold.

## Two guards that passed for the wrong reason

**The focus guard passed with the focus handler deleted.** `.focus()` on an
element the browser considers off screen scrolls the window to it — which
scrolls *up*, which reveals the bar through the ordinary direction rule. The
test was watching the browser do the revealing and crediting the component. It
uses `focus({ preventScroll: true })` now and asserts `window.scrollY` did not
move, which leaves only one thing that can have revealed it.

**The reduced-motion guard passed with the derived state deleted.** That branch
is a backstop for a `useReducedMotion` that resolves after hydration, and the
effect's own early return already keeps `away` false — so either half alone
still behaves. The mutation removes both, which is the mechanism.

Three guards, three mutations: the transform swapped for an opacity change, the
focus handler removed, and the reduced-motion branch removed on both sides. All
caught, two of them only after the guard was rewritten.

Unit 9,475 · browser 791 with 3 new · tsc clean · eslint 0 · build clean
