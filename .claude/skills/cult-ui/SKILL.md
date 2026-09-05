---
name: Cult UI
description: Source texture-led components — textured cards and buttons, dynamic islands, expandable panels and tactile surface treatments — from the @cult-ui registry. Use for depth and material quality on a card or panel, and selectively for signature moments. No authentication required.
---

# Cult UI

Read [ui-design-system](../ui-design-system/SKILL.md) and
[component-sourcing](../component-sourcing/SKILL.md) first.

Registry `@cult-ui` → `https://cult-ui.com/r/{name}.json`. Present in the
official shadcn registry index; both direct requests and the CLI returned
**HTTP 429** at verification, which is throttling rather than absence. Retry
later, and do not "fix" it by changing the URL. Docs: `https://cult-ui.com`.

## Use it for

Material and depth: textured cards and buttons, dynamic-island patterns,
expandable and morphing panels, gradient and neumorphic surface treatments,
tactile hover states.

It sits between Kokonut (composition) and Aceternity (spectacle). Its subject is
**how a surface feels** rather than what it contains — which makes it useful for
raising the craft of an ordinary card without giving it a signature argument.

## The one that fits Vibe's grammar

Cult's depth treatments are the closest external match to Vibe's own surface
model — layered light over a dark ground rather than solid greys. Read
`--color-surface-1…4` and `--color-well` in
[tokens.md](../ui-design-system/tokens.md) before porting one: Vibe already has a
four-level hierarchy plus a black well, and a Cult texture usually replaces the
*visual* of a level rather than adding a fifth.

Never let a texture add a fifth white layer. Card-inside-card-inside-card is what
`--color-well` exists to prevent.

## Porting

[adaptation.md](../component-sourcing/adaptation.md). Specifically:

- Neumorphic treatments assume a mid-grey ground and collapse on near-black.
  Translate the intent, not the shadow values.
- Multi-stop gradients frequently carry a second hue. Vibe has one accent.
- Dynamic-island and morphing panels animate layout geometry — reserve the box
  before the first event, or they will move text somebody is reading.

## Do not

- Add a surface level.
- Introduce a second accent hue.
- Put a texture on every card. Depth that is everywhere reads as noise.
