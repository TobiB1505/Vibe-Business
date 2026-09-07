# 0098 - The palette ships behind one switch, not one route at a time

Status: Accepted
Date: 2026-09-07

Supersedes the rollout clause of [ADR 0096](0096-the-second-design-system-arrives-scoped.md). The second design system is chosen once, in the root layout, from `VIBE_PALETTE`. It is not migrated route by route, because the ground is a fixed layer and a half-migrated product changes its own background as a founder navigates.

## Context

ADR 0096 shipped the second palette dormant: same token names, new values, every declaration scoped to `[data-vibe="v2"]`, and nothing in the product carrying the attribute. It also wrote down how the rollout would go — "a route opts in by carrying the attribute on a layout wrapper; it opts out by deleting it."

Three sprints later the vocabulary is finished. S2 and S3 closed the type scale, the corner scale and the figure scale, gave every text field, choice, filter, rating, empty state and subject-number one component, and removed the last places where a call site retyped a token. So the question stopped being whether v2 works and became who sees it, and when.

Two measurements settled it, and both were taken before anything was written.

**The switch costs one test.** With `data-vibe="v2"` on `<html>` and the whole product rebuilt: 8787 unit tests pass, and 587 of 588 browser tests pass. The single failure is `ground.spec.ts` asserting the ground paints nothing in the first palette — the dormancy guard itself. A second failure in the first run did not reproduce in isolation or on a re-run.

**The ground is real, and it is global.** `.vibe-atmosphere` is `position: fixed; z-index: -1`: one luminance ramp behind the entire application. Measured in decoded pixels on Nova Home, v1 is flat at 9.51 luminance from top to bottom; v2 runs 21.38 at the top to 10.64 at the bottom, a 2.01× ramp.

## Decision

### The palette is chosen once, from configuration

`src/app/palette.ts` resolves `VIBE_PALETTE` to `v1` or `v2`, defaulting to `v1`. The root layout writes the result to `<html data-vibe={activePalette()}>`. Nothing else in the product sets the attribute, and `design-tokens.test.ts` asserts exactly that — one setter, at the root, reading configuration rather than writing a value in.

Server-only rather than `NEXT_PUBLIC_`, matching the repository's other `VIBE_*` configuration: the root layout is a server component and no client code needs to know.

### The resolved palette is always in the document

`data-vibe="v1"` styles nothing. It is written anyway, because "why is it still the old design" should be answerable by looking at the document rather than by working out which deployment read which variable.

### An unknown value is v1, and is not an error

A typo in a cosmetic flag should not fail a deployment. `V2`, `2`, `true`, `1` and an empty string all resolve to the palette customers already have; only a trimmed `v2` switches. `palette.test.ts` pins each of those, because a flag that answers to four spellings cannot be reasoned about from a dashboard.

### Route by route is abandoned, and this says why

ADR 0096 assumed a route could opt in on a layout wrapper. It can — the attribute is a plain CSS scope — but the *ground* cannot follow it. A fixed, full-viewport ramp belongs to the document, not to a route, so a product where half the routes are v2 has a background that switches on and off as a founder moves between screens, with the corner radii jumping at the same moment. That is worse than either end state.

Making the ground scopeable is possible and is real work: it would stop being a ground and become a container, which changes what it is rather than where it applies. It buys a gradual rollout that nobody wants once the flicker is named out loud.

## Consequences

- Turning the design system on is one environment variable, and turning it off is removing it. There is no per-route state to reason about and no partial condition to test.
- Preview deployments can run `v2` while production runs `v1`, which is the dogfooding shape without a second mechanism.
- The dormancy guard changes shape rather than disappearing: it asserted that nothing opts in, and now asserts that exactly one thing does and that it reads configuration. A literal `data-vibe="v2"` anywhere in the product fails it, because that would be a route ignoring the switch.
- `ground.spec.ts` gained the assertion the rest of the file could not make. Every other test there reads a computed style — which is exactly what `.vibe-atmosphere` had while it was dead code, a rule that resolved on a class nothing wore. The new test decodes the pixel and asserts the ramp's direction and size, and it is the only one in that file that fails when the ramp is deleted.
- This gates no capability, so CLAUDE.md rule 78 is not engaged; it is documented in [docs/deployment/environment.md](../deployment/environment.md) regardless, which rule 83 keeps true at HEAD.
- The flag takes effect at build time. The root layout is baked into every statically prerendered page — `/`, `/privacy`, `/terms`, `/_not-found` — so setting the variable on a running server without rebuilding switches the dynamic routes and leaves the marketing and legal pages on v1. Measured, not assumed. Forcing the layout dynamic would fix it and would give up static generation for the whole product to serve a cosmetic flag, which is the wrong trade; a redeploy is what Vercel prompts for anyway.
- When v2 is what everybody has, the values move into `@theme`, the scope and the switch are deleted, and no compatibility layer is left behind — unchanged from ADR 0096.
