# 0097 - The second design system arrives as a scope, not as a rewrite

Status: Accepted; its **rollout clause** — "a route opts in by carrying the attribute on a layout wrapper" — is superseded by [0102](0102-the-palette-ships-behind-one-switch.md) on 2026-09-07. Everything this ADR decided about the *shape* of the second system — same token names, new values, one scoped attribute, no compatibility layer at the end — stands unchanged and is what 0098 switches on. What did not survive is the assumption that a route could opt in alone: `.vibe-atmosphere` turned out to be a fixed full-viewport layer, so a half-migrated product changes its own background between screens. Its **material clause** — "glass is spent on the card and nowhere else" — is superseded by [0103](0103-glass-is-the-material.md) on 2026-09-07: a panel and the chrome are panes too, and the shells had been painting over the ground that made any of them one.
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

### The eyebrow leaves the mono, and the mono gets a different face

`MonoLabel` set ordinary labels in JetBrains Mono, uppercase, at 0.16em tracking — 289 uses across 51 files. `DESIGN.md` says the opposite and always did: "repository names, branches and SHAs may use mono, but ordinary scores and labels stay in the interface family", and "technical identifiers use the mono family sparingly". A product line reading CONFIRMED BY YOU in a monospace face is a sentence about what a person did, printed as though a machine emitted it. `typography.tsx`'s own docblock had drifted the same way: it still named Space Grotesk as the interface face, which UI-6 removed and `design-tokens.test.ts` asserts cannot return, and assigned "scores, counts, credits" to mono.

Four treatments were rendered and compared. **v2 sets the eyebrow in the interface family at 11px, 600, 0.10em.** The component's four hard-coded literals became four tokens — `--font-label`, `--eyebrow-size`, `--eyebrow-tracking`, `--eyebrow-weight` — composed by an `eyebrow` utility, so v1 answers them with exactly what it shipped and its 51 files were not edited. Verified in the browser rather than assumed: 10.5px / 400 / 1.68px / JetBrains Mono before and after. The utility sets no `line-height`, because `MonoLabel` never did and adding one would move every block it sits above.

That leaves mono doing only what `DESIGN.md` keeps it for, so the face was chosen for that job alone. Four candidates — IBM Plex Mono, DM Mono, Martian Mono, Source Code Pro — were rendered on real SHAs, branches, repository names and paths, plus the pairs a hex SHA puts in collision (`0`/`O`, `1`/`l`/`I`, `5`/`S`, `8`/`B`, `2`/`Z`, `rn`/`m`). A pangram flatters every monospace equally and would have answered nothing. Geist Mono was excluded by instruction. **DM Mono** was chosen: geometric, low-contrast, the same construction logic as Geist, so an identifier reads as the same voice as the interface one notch more technical. Its weakest pair is `1`/`l`, named before the choice rather than discovered after it.

Two consequences were handled rather than accepted:

- **DM Mono ships latin and latin-ext only**, against JetBrains Mono's six writing systems. Since Geist has no Greek either, dropping JetBrains Mono outright would have left v2 with no Greek in *either* family. So `--font-mono` lists DM Mono first and the JetBrains subsets behind it; each face declares its own `unicode-range`, so the fallback is per character rather than per family, and the bytes are already in the repository.
- **DM Mono has no 600**, and three places in the product set mono at `font-semibold`. Shipping 400 alone would have produced a synthesised faux bold, so 500 ships too and CSS font matching resolves the request to it.

### The primitives get hooks, and the motion obligations get a mechanism

S2 gave every primitive a class naming what it is — `vibe-surface-card`, `vibe-well`, `vibe-control` — emitted from the primitive's own base list, where a caller's `className` can add to it but never remove it because `cn` is a join. In v1 those classes match nothing. `theme-v2.css` is where they acquire material, so the whole material layer is written without editing a call site, and a test asserts every such rule stays inside the scope.

The control hook is emitted from `buttonClasses()` rather than from `<Button>`, because `<Link className={buttonClasses()}>` renders no Button and is most of the product's primary actions.

`DESIGN.md` asks three things of every animation, and asked them of each component individually: honour reduced motion, pause on a hidden tab, reserve geometry. Twenty-two components import `motion` and each had to remember all three; one that forgets is not a compile error and not a test failure. S2 moved them into the mechanism. Reduced motion is a media query on the class. The hidden-tab pause is one attribute stamped on `<html>` by `MotionProvider` and one rule in `globals.css` — a component subscribes to nothing. Reserved geometry is the keyframes themselves: `vibe-reveal` interpolates opacity and transform and has no layout property to animate, which a test enforces by set-equality rather than by absence of a blocklist. The primitives are CSS and server-rendered, so an entrance does not drag a `"use client"` boundary over a subtree; the `motion` dependency stays for orchestration and layout animation.

**Two defects the rendered page found and the files did not.** The card's blur was a Tailwind utility hard-coded in the primitive, so `--glass-blur` could say 14px while the card rendered 24 — a token that lies. The blur now comes from the palette, which is the one `vibe-*` rule outside the scope, narrowed by tests to that property and to token-only values. And writing `-webkit-backdrop-filter` beside the standard property made Lightning CSS keep the prefix and drop the standard declaration, so the card computed `backdrop-filter: none` in *both* palettes; the build prefixes from its own targets, and a hand-written twin fights it. Neither was visible in a diff, in a type check or in a passing test.

### The semantic components needed less than expected, and one token that did not exist

S3 found the semantic layer already composing primitives rather than drawing its own material — `FindingCard` renders through `Surface level="panel"`, and none of the nine writes its own `rounded-card`. So S2's hooks reached them for free, and S3 is two findings rather than nine rewrites.

**The sheet had the card's bug.** `Sheet` hard-coded a blur utility exactly as the card had, so `--glass-blur` would have said one thing while the evidence drawer rendered another. It now carries `vibe-overlay` and takes the blur from the same rule the card does — one rule for both, asserted, because two glass surfaces that disagree about what glass looks like is how a product acquires a second material without deciding to. In v2 the drawer takes the card's fill, line and sheen: `DESIGN.md` and the chosen direction both spend glass on overlays, and an evidence drawer is literally one.

**Decision D5's token did not exist and eleven headings were working around it.** `--text-lead` is already 15px but carries prose leading (1.7), so eleven card headings write `text-[0.9375rem] leading-snug` by hand. The size was never the problem; the leading was, and one token cannot serve both. `--text-card-title` is declared at **1.375 in v1 rather than the 1.35 the spec proposed** — 1.375 is `leading-snug`, which is what those eleven already render, so naming what ships makes this a rename instead of moving every card heading in the product by a third of a pixel to match a number nobody had looked at. v2 takes 1.35, which is what a second palette is for. Measured: v1 renders 15px/20.625px, v2 15px/20.25px.

The remaining ten conversions are route work and belong to S4, where each screen is looked at rather than swept.

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
