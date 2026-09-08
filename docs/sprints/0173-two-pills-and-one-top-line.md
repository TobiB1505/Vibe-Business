# Sprint 0173 — Two pills, and one top line

**Date:** 2026-09-07
**Decision:** none. Craft inside [ADR 0106](../decisions/0106-the-rail-is-a-layout-per-area.md).

## What was reported

1. The breadcrumb should come up to the height of the lockup, so the top of the screen is one line.
2. The avatar and name should be built as a round button, like the Credits pill above it.
3. The `+` should be its own round button beside the balance rather than inside its pill — *"man sieht, dass das zwei verschiedene Elemente sind."*

## What was built

**The column comes up to the lockup.** Last sprint the lockup was pulled out of the box that centred it against the page's first heading line, and the alignment it was chasing was given up as being between two columns that do not have to agree. That was half right. The alignment is worth having; what was wrong was the direction — pushing the mark *down* into the middle of its own surface to meet a heading. Both columns read `--frame-inset` now, so they start level and neither is nudged. `--shell-top` and `--shell-heading-line` are retired; the content columns keep a generous `pb-16`, because symmetric 20px would end a page 20px above the fold.

**The `+` is its own control.** It was the right-hand end of the balance's pill, divided from it by an inset hairline. That is a common shape and the wrong one here: reading a balance and buying more of it are two acts with two destinations, and drawing them as one object with a line through it makes the line the thing you see. Two round controls with a gap — a pill that takes the width, and a 40px square beside it.

**The identity is that same pill.** Its third shape. It was a bordered card, then — two sprints ago, on my argument — a row with no container until hovered, because every other row in the rail is exactly that shape and a bordered card among borderless rows was the odd one out.

That argument was about the *navigation*, and the identity is not in it: it sits below the divider that ends the navigation, beside the balance, and the two are the account-level pair at the foot of the rail. A pill and a nothing-until-hovered is two treatments for one kind of thing. Both are `h-10`, both `rounded-full border-line-2 bg-surface-2`, and the height is asserted — it is what makes them read as a pair rather than as two round things of nearly the same size.

The second line went with it. It said `Founder` on a product rail and `GitHub account` on the account one: a constant, and a fact Settings → Profile states properly. Neither was worth the control being two lines tall beside a one-line balance, and the `subtitle` prop is gone rather than left unused.

## What the guards say now

Three changed, two new, all mutation-tested.

The browser guard on the identity **asserted the opposite** of what was asked for — it required a transparent resting fill and a transparent resting border. It now requires both to be painted, to be fully round (radius ≥ half the height), and to match the balance's fill, border and height exactly. That is the reversal made visible rather than quietly deleted.

New: the balance and the top-up have a real gap between them (> 4px), both are fully round, both the same height, and the `+` is square — a round control with an oblong body is a pill with one item in it. And the lockup's vertical centre is within 8px of the breadcrumb's; putting the lockup back in a taller box fails it.

## Validation

Unit 8,840 · browser 595 · lint 0/0 · typecheck clean · no migration.

One honest note: two `profile.spec.ts` tests failed on the first full run and passed on the second, in isolation and in the full suite. They are the two that load a real avatar image from a host that does not exist, and they take ~13s each either way. That is a pre-existing timeout, not something this sprint touched, and it is written down rather than called a flake and forgotten.
