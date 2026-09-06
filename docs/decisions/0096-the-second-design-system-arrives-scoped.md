# 0096 - The second design system arrives as a scope, not as a rewrite

Status: Accepted
Date: 2026-09-06

Introduces `src/app/theme-v2.css` and five self-hosted Geist subsets. Redefines the whole colour, type and shape vocabulary under `[data-vibe="v2"]`, which nothing in the product carries yet, so production renders byte-identically. Adds no runtime dependency and changes no component.

## Context

The product was asked for a new design system: modern, deliberately motion-heavy, glass rather than flat tiles, new typefaces — and rolled out gradually rather than in one cut.

The naive shape of that work is a second design system beside the first: new token names, and every screen migrated from the old vocabulary to the new one. Measured against this repository, that means **162 of 224 `.tsx` files** consume Vibe tokens, so it is 162 diffs, a long period in which two systems are half-applied, and a permanent double vocabulary — the state `DESIGN.md` explicitly forbids.

Three facts made a cheaper shape available, and all three were checked before anything was written rather than assumed.

**Tailwind v4 resolves tokens at use time.** `globals.css` declares `@theme`, not `@theme inline`. The inline form substitutes values into the utilities during the build; the plain form emits real custom properties and compiles `bg-surface-3` to `background-color: var(--color-surface-3)`. There is also no `theme()` call anywhere in the file — the other build-time escape. So the value behind every utility in all 162 files is a runtime reference that something further up the tree can re-point.

**Unlayered CSS beats a layer.** Tailwind emits `@theme` tokens into `@layer theme`. A plain `[data-vibe="v2"]` block outside any layer wins over `:root` regardless of specificity, with no specificity contest and no `!important`. The `.v2`-over-`@layer` fallback that was planned turned out not to be needed.

**A direction cannot be chosen from an intention.** The risk in this work is material and motion, and both are invisible in a wireframe. Three full-fidelity direction studies of Nova Home were built first, on the existing `e2e/[scenario]` fixture harness, on the real view models — [Sprint S0](../sprints/README.md), reachable at `/e2e/study-a-depth`, `/e2e/study-b-precision`, `/e2e/study-c-editorial`.

## Decision

### The vocabulary is redefined, not replaced

Same token names, new values, scoped to one attribute:

```css
[data-vibe="v2"] {
  --color-surface-3: rgb(255 255 255 / 0.048);
  --radius-card: 12px;
  --font-sans: var(--font-geist), …;
}
```

Every `bg-surface-3` beneath that attribute picks up the new value, in all 162 files, with none of them edited. A route opts in by carrying the attribute on a layout wrapper; it opts out by deleting it. When everything is v2, the values move into `@theme` and the scope is deleted, leaving no compatibility layer behind.

### The direction is Study B's material, Study A's typeface, and mint

Chosen at review, from the studies rather than from a description. The three axes were chosen **independently**, which is why the studies now declare `skin`, `focusLight` and `display` instead of being branched on by id:

- **Material — Precision & Light.** Edge-driven and dark. Opaque panels, bright hairlines, tight corners. Glass is spent on chrome, overlays and signature moments only; dense data never sits behind a blur, because `backdrop-filter` on stacked content is what makes a product judder. Light is a focus tool — one directional band on one card per screen — not an ambience.
- **Typeface — Geist**, self-hosted.
- **Accent — mint `#00e5a0`, unchanged.** Two of the three studies put the brand colour genuinely at risk, which is the only honest way to ask the question; the answer came back that it stays, and it keeps the job `DESIGN.md` gives it: *Vibe is acting*, never generic approval.

One value moved after the decision. Study B's ground was tuned around signal blue and is noticeably cold; mint on that field read slightly sickly. The blue is neutralised by one step (`#05070a` → `#06080a`), which is enough without turning the product green.

### Glass, atmosphere and motion get names the product did not have

`--glass-*`, `--atmos-*`, `--ease-out`/`--ease-inout` and `--dur-*` exist because the product has never had a lit ground or a shared motion curve. S1 lands them as values; S2 spends them inside the primitives, where the three motion obligations — reduced motion, hidden-tab pause, reserved geometry — are structural rather than remembered per component.

### The palette is measured, not trusted

`design-tokens.test.ts` now measures **both** palettes under the same rules. That is the whole reason `theme-v2.css` is a separate file: the test resolves a token by first regex match in `globals.css`, so a second block of the same names there would have left every assertion still measuring v1 while v2 shipped unchecked — which is exactly how `--color-fg-meta` reached production at 3.38:1 and stayed there for the life of the design system.

Measured against `--color-surface-4`, the deepest surface real text sits on: every load-bearing ramp step clears 4.5:1, weakest `fg-meta` at **5.59:1**. Two further assertions guard the shape rather than the numbers — 40-for-40 token parity in both directions, so a v1 token added later cannot silently inherit and a v2-only name cannot become a dependency that breaks when the scope is deleted.

### Geist ships no Greek

Latin, Latin Extended, Cyrillic, Cyrillic Extended and Vietnamese are committed as five subsets, split per writing system the way the foundry ships them, so a browser fetches only what a page needs. Greek is the one script the interface face gives up by moving off the platform-native stack, which covers it. It falls through to `ui-sans-serif` and renders correctly in the system face — a graceful fallback, not broken text, and named here rather than discovered later.

## Consequences

**Nothing changes today.** No element carries `data-vibe="v2"`, and a test asserts that, so S1 is a foundation rather than a redesign. The first visible change is one attribute on one layout, and reverting it is deleting that attribute.

**Two palettes exist and both are live in the stylesheet.** That is a real cost: a colour decision now has two homes until the scope is retired, and a change made in one is not a change made in the other. The parity tests make the omission loud rather than silent, but they cannot make the second edit for anybody.

**The 15 MB of study screenshots are not in the repository.** `pnpm screenshots:studies` regenerates them; `screenshots/` is ignored. The studies themselves are code and stay, as the record of what was compared.

**Switzer and Instrument Serif remain committed for the studies that lost.** They are lab-only and latin-only. Switzer is ITF Free rather than OFL, which permits self-hosting but is not the same licence as the rest — worth reading before it ever reaches a product build, which on this decision it does not.

**The direction studies are not a design system.** They render one screen. The composition Vibe actually ships is built in S2 and S3 out of the primitives and the semantic components, whose props, semantics and states are unchanged by any of this.
