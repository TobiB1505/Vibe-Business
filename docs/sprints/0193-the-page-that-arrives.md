# Sprint 0193 — The page that arrives

**Date:** 2026-09-09
**Decision:** treatment 3 from `study-hero-shape` — the deck — and the landing page becomes one long scroll whose blocks arrive as they are reached.

## What was asked

*"es soll eine endless scroll landing page werden, die verschiedenen Komponenten kommen immer reingefadet beim Scrollen, sehr prominente mittige Hero-Card, mit Background."*

And before that, a correction that was right: *"die Hero Card ist schon absolut hässlich, weil du wieder nur 4 Varianten machst und nicht 4 von Grund auf neu erstellst."*

## The correction, and what it changed about the method

The first hero study drew **one** card and hung four backgrounds behind it —
grid, aurora, border beam, spotlight — and the docblock presented that as the
method. It is a method for choosing a ground. The card itself was never
designed, and four wallpapers behind one shape is four of the same picture.

`study-hero-shape` inverts the variable. The ground is identical in all four,
the words are identical in all four (`HEADLINE_A`, `HEADLINE_B`, `SUB`, `Cta`,
`Assurances` are shared constants), and each card is a different **object**:

1. **Die Konsole** — a product window: header bar with project and state, log
   lines, control at the foot. The headline sits above the card.
2. **Zweigeteilt** — one card split 55/45: argument and CTA left, a cropped
   fragment of the real product right.
3. **Das Deck** — three cards stacked, the front sharp, two behind cropped.
4. **Die Fensterbank** — wider than tall: a type band on top, the products
   page's own row shapes at full width below.

**3.**

## What the first render showed, and what it cost to find

Every card was **transparent**. V2's surfaces are translucent films —
`--color-surface-2` is white at 3.4% — built to sit on the app's opaque ground
and pick its atmosphere up. Over a lit field they did exactly that: grid lines
ran across every log row, and all four read as ghosts rather than objects.
`.study-hero-object`, and now `.landing-hero-card`, composite the same film over
`--color-ground` as one opaque colour. Sub-surfaces *inside* a card keep their
film, because they finally have something opaque to sit on.

Three more, all only visible in the picture:

- **The deck lay on itself.** The two behind were positioned against the
  padding box rather than the front card, so a 26px offset put them 56px too
  high and their text overlapped.
- **The Fensterbank truncated "Payflow" to "P…" on a phone** — the exact defect
  `product-list-row` documents, because the pill never shrinks. Mark and name
  are one flex item there now, as they are in the product.
- **The headline broke three-deep** with "business." alone on the last line.

## The landing page

The hero holds a screen: `100dvh` minus the sticky nav, the deck centred in it,
the next block below the fold. Measured at 1440×900 the hero card's bottom edge
is at **797px**, so the first scroll is a deliberate move rather than an
accident of where the content ended.

Everything under it is a `Reveal`: opacity and a 26px rise, `once: true`, fired
by `whileInView` a little before the block's top reaches the viewport floor.
Nine blocks. The page is 7,913px at 1440 and 11,049px at 390.

The two cards behind the front one are `aria-hidden`. A screen reader meeting
three stacked headings would meet a sequence the page is *showing* rather than
saying, and `LandingFlow` names the same three steps in text further down — so
nothing here is only visual.

## The reveal has three ways to fail, and two of them are silent

The server renders every block **hidden**, because `useReducedMotion()` returns
`null` during the server render and the animated branch is what gets shipped.
That is fine for the ordinary reader and a blank page for two others:

- **Reduced motion.** `initial={false}` renders each block at its `animate`
  target with no transform. But that is a client decision, so a CSS backstop
  under `prefers-reduced-motion: reduce` covers the window before hydration.
  Both were mutation-tested **separately**: with the JS branch removed the CSS
  alone holds the guard green, and with the CSS removed the JS alone does. With
  neither, the guard fails.
- **No JavaScript at all.** A `<noscript>` style forces every `[data-reveal]`
  visible. Deleting it fails the guard, which is the point — a marketing site
  that is one card and then nothing does not announce itself.

## Two things the browser said and the source did not

**`test.use({ reducedMotion: "reduce" })` did not reach the page.** Inside the
test that asked for it, `matchMedia("(prefers-reduced-motion: reduce)")` read
`false` — so a guard written that way would have run the ordinary path twice
and called one of them reduced. `page.emulateMedia` is explicit and works.

**The hero overflowed its screen by 6px, on a build whose source had already
passed.** 906px against a 900px viewport, because the measurement was taken
before the real face had loaded and the fallback is taller. The same font race
`expectNoHorizontalOverflow` documents, arriving as a height instead of a
width. The guard waits for `document.fonts.ready` now, and the card's padding
came down so it fits with room.

## Seven guards, each broken to prove it

Every block reaches full opacity once scrolled to · every block is present at
first paint under reduced motion · every block is present with JavaScript off ·
the hero card's fill is opaque · one `h1`, and the deck's two rear cards out of
the accessibility tree · the hero holds the first screen · the hero fits a phone.

Mutations: the reveal made to animate to its own hidden state, the JS
reduced-motion branch removed, the CSS backstop removed, both removed, the
`<noscript>` deleted, the card returned to `bg-surface-2`, `aria-hidden`
dropped, the screen-hold class dropped. All caught.

`landing-contract.test.ts` was repaired rather than deleted: the positioning it
pins moved into `LandingHeroDeck` when the hero became a component, so it reads
that file too and joins it to `PUBLIC_SURFACES` — a contract pointed only at
`page.tsx` would have gone on passing an empty search. Mutated by rewriting the
headline; it failed.

## Named and not fixed

`MarketingCta`'s label wraps "repo" to a second line at 390px inside the hero
card. The card's padding makes it ~48px narrower than the page column the CTA
used to sit in, so this is a regression of mine — but the fix is either
shortening copy that is shared across every marketing surface or changing a
component nobody asked about, and neither is this sprint's business.

Unit 9,475 · browser 756 with 7 new · tsc clean · eslint 0 · build clean
