# 0103 - Glass is the material, and the ground has to be visible for it to be one

Status: Accepted
Date: 2026-09-07

Supersedes the "glass is emphasis" clause of [ADR 0097](0097-the-second-design-system-arrives-scoped.md). In the second palette a `card`, a `panel` and the chrome are all panes; a `section` is the one opaque step. And the shells stop painting `--color-app` over the whole viewport, because that is what had been covering the ground the glass was drawn to refract.

## Context

The second design system was chosen, in three full-fidelity studies, as glass rather than flat tiles. What shipped in S2 spent glass on `card` and the sheet, and wrote the reason down: `backdrop-filter` on stacked dense content is what makes a product judder.

Then the first screen was reviewed in both palettes, and two things were measured.

**One surface in five was a pane.** On the account dashboard, `vibe-surface-card` computed `blur(14px)` and the other four surfaces computed `backdrop-filter: none`. The four are the product grid — the thing a founder actually looks at. A card floating alone over four fills is not a restrained version of the chosen direction; it is a different one.

**The ground had never been visible in the product.** `.vibe-atmosphere` is `position: fixed; z-index: -1`, which paints it above the canvas and below everything in flow. Every shell root carried `bg-app` on a `min-h-dvh` element — the same colour `body` already paints, so nothing looked broken. Decoded pixels down the dashboard's content column, every 100px:

```
v1   9.51  9.51  8.51  8.41  8.41  8.41  8.41  8.51  9.51  9.51
v2  11.79 11.79 10.79 10.52 10.52 10.52 10.61 10.79 11.79 11.79
```

11.79 is `--color-app` in v2, exactly. There is no ramp in either column. The luminance change the glass exists to sample was not there, on any signed-in route, at any point since S2 — which is precisely the failure mode `atmosphere.tsx` documents in its own opening paragraph, arrived at a second time by a different door.

The existing `ground.spec.ts` pixel test did not catch it because it samples Nova Home at `x = 4`: the rail, whose translucent fill and opt-in `AtmosphereField` both sit *inside* the shell and above the covering background.

## Decision

### The panel is glass; the section is not

`vibe-surface-panel` takes `--glass-fill-panel`, `--glass-line-panel`, a `::before` sheen and `blur(var(--glass-blur-panel))` — 9px against the card's 14. The judder argument was right and is answered by the radius rather than by opacity: `backdrop-filter` costs by blur radius, and a shallow blur over a real ramp still reads as a pane, because the ramp is what makes it one.

`vibe-surface-section` stays a fill. Glass behind glass gives the inner pane another pane to sample instead of the ground and neither reads as glass; the hierarchy needs one opaque step and the quiet grouping band is the right one.

A panel carries less fill and a quieter line than the card, because a panel sits *on* the ground where a card sits over the page. Without the split a panel inside a card disappeared into it.

### Chrome is glass

`DESIGN.md` named chrome as a place glass belongs before it named anything else, and it was the last one still painted as a flat fill. `.vibe-chrome` on the account rail and the project rail: the card's blur radius, and much less fill (`--glass-fill-chrome`), because chrome is pinned — its blur is computed against a ground that does not move under it — and it runs the full height of the viewport, where a panel's fill would stack into a slab.

### No shell paints the page background over the viewport

`bg-app` comes off five shell roots. `body` already paints `--color-app` and it propagates to the canvas, so this changes nothing about what v1 renders — measured, v1 is 9.51 flat before and after — and it uncovers the ramp in v2: 20.30 at the top to 9.81 at the bottom, a 2.07× ramp, matching what ADR 0098 measured in the study.

`bg-app` on a *bounded* element stays fine and there are many — a menu panel, a diff well, a chip. The defect is the pair: a viewport-tall root that also fills.

## Consequences

- v1 is untouched. Every rule added here is scoped to `[data-vibe="v2"]`, and the one unscoped change removes a background that duplicated the one `body` paints.
- Two guards, both mutation-tested. `material.test.ts` fails if any `min-h-dvh` element in `src/components/layout/` carries `bg-app`; `ground.spec.ts` decodes pixels on the *dashboard* — an ordinary product screen in the account shell — and fails if the ramp is flat there. The old pixel test could not have caught this and now has a sibling that can.
- The material reaches a surface only through `Surface`. Sixty-eight places in the product draw a fill, a border and a radius by hand instead, and none of them will become glass — that is the redesign's remaining work, screen by screen, and it is the reason the design system does not "automatically rewrite" a screen.
- `DESIGN.md`'s description of the direction changes with it: "glass spent on chrome and signature moments rather than on dense data" is retired, recorded in `RETIRED_CLAIMS`, and history may still quote it.
- The `glass` prop on `Surface` narrows to what it now means: a way to blur a `section`, which is the one level the palette leaves opaque. It is unused at HEAD and should stay rare — a section is a fill for a structural reason, not by omission.
