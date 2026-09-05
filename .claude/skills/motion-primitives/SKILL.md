---
name: Motion Primitives
description: Source composable motion building blocks — text effects, transitions, staggered reveals, animated presence and layout morphs — from the @motion-primitives registry, built on the same Motion library Vibe already depends on. Use when a surface needs motion and the pattern is a general primitive rather than a decorative effect. No authentication required.
---

# Motion Primitives

Read [motion-design](../motion-design/SKILL.md) first — it is the authority, and
this is a source for it.

## Why this one is the default motion source

It is built on **Motion**, which is already a production dependency here
(`motion` v13, imported as `motion/react`). A port is usually a rewrite of
composition rather than an adoption of anything new — the lowest-cost motion
source available.

Registry: `@coss`-style shadcn namespace `@motion-primitives` →
`https://motion-primitives.com/c/{name}.json`.

```bash
pnpm dlx shadcn@latest search @motion-primitives --limit 20
```

If this returns HTTP 429, that is throttling, not absence. Wait and retry; do
not change the URL. Docs: `https://motion-primitives.com`.

## Use it for

Text effects and reveals · staggered list entrances · animated presence ·
layout morphing and shared-element transitions · scroll-linked reveals ·
disclosure and accordion motion · cursor and hover primitives.

These are **primitives**: they compose into Vibe's own motion language rather
than arriving as a finished look. That is exactly what makes them safe to use
broadly, where [aceternity-ui](../aceternity-ui/SKILL.md) is not.

## Porting

Import path is `framer-motion` in most published source — change it to
`motion/react`. Then [adaptation.md](../component-sourcing/adaptation.md).

**The three obligations arrive missing.** No published primitive handles
`prefers-reduced-motion`, hidden-tab pausing or reserved geometry, because those
are product decisions. You add all three. A text-reveal primitive with reduced
motion unhandled shows *nothing* to a reader who set that preference — the
content is animated in, so removing the animation removes the content. That is
the failure mode to check for first.

## Do not

- Animate a value the product has not measured, however elegant the primitive.
- Use a scroll-linked effect on a surface a founder returns to daily.
- Reach for a primitive because it is impressive. Say what it tells the reader.
