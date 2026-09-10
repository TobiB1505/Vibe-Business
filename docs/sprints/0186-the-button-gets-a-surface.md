# Sprint 0186 — The button gets a surface

**Date:** 2026-09-08
**Decision:** treatment 3 from `study-button-look` — "Verlauf und Lichtkante".

## What was asked

Sprint 0185 settled *how many* buttons there are. This settles *what one looks like*: five treatments, researched from the registries, rendered against the same jobs, chosen at the picture. The founder picked 3.

## What the research actually returned

**ReUI has nothing free for buttons** — both matches are premium blocks. 21st.dev has plenty, and four mechanisms were worth taking:

| Mechanism | Source | Used as |
|---|---|---|
| Lit gradient fill, bright top edge, outer halo | Glow Button | **treatment 3 — chosen** |
| Colour moved from the fill to the rim | Gradient Button | treatment 2 |
| Accent as a chip inside a dark container | Anti Metal | treatment 4 |
| Hairline plus glow plus one coloured dot | Subtle Button | folded into 2 and 5 |

Rejected on sight, and named so the rejection is on the record: rotating conic shimmer borders, animated multi-hue gradients, "nebula" pulses. This product tells a founder what their business is worth fixing; a button that shimmers while they read that is lying about where the attention belongs.

## What shipped

**A control has a surface, not a colour.** A wash down the face, a lit top edge, and — on the accent — the glow underneath.

The wash is **white over black**, not a pair of hand-mixed hexes. That is what lets the same two stops work over mint, over coral and over a 4%-white neutral, and it is why the whole treatment is seven colour tokens and six shadow tokens rather than a gradient per variant. Three intensities, because what reads as lit on a saturated fill bleaches a neutral one.

**Hover raises the light; it does not change the colour.** `primary` used to swap `bg-mint` for `bg-mint-hover` — a different green under the pointer. It lifts the sheen now, so the button stays the one mint. `--color-mint-hover` keeps its real job: the hover for mint *text*, which is where nine call sites already use it.

The two arguments that predate the skin both survive it, and are still guarded: every variant has a resting fill (touch has no hover), and `danger` warns at rest with a coral sheen rather than a white one, so the warning is not washed grey.

## Four guards, and the two gaps they were hiding

Adding a gradient exposed three things the existing guards could not see:

1. **`bg-gradient-to-b` starts with `bg-`.** The "every variant has a container at rest" guard checked exactly that prefix, so a variant with *only* a wash and no ground would have passed — the phone argument silently lost. The check now rejects gradient, `bg-transparent` and `bg-none`, and there is a test of the guard against its own loophole.
2. **The colour-utility guard never looked at gradient stops.** It scanned `text|bg|border` only. `from-sheen-lift-typo` would have emitted nothing, the wash would have vanished, and no build would have said so — the identical failure `text-danger` caused. It scans `from|to|via` now.
3. **A disabled control kept the light.** The sheen is a `background-image`: `disabled:bg-surface-3` replaces the background *colour* and `disabled:shadow-none` reaches the box-shadow, and neither touches the wash. Without `disabled:bg-none` a disabled primary kept a 36% white gradient over the disabled grey and read as lit and pressable.

Six mutations run, all caught after the fix below.

## The third time this trap has been paid for

The `disabled:bg-none` mutation left the suite **green**. The assertion read the raw file, and the comment above that class explains it *by name* — so the guard matched its own prose.

Sprint 0175 lost a `role="alert"` this way. Sprint 0183 lost a `<select>`. This is the third, in a file written after both. Every assertion in `button.test.ts` now reads a comment-stripped copy, and the docblock on that constant says why, because the lesson clearly does not travel by being written in a sprint document.

## Validation

Unit 8,880 · browser 639 · lint 0/0 · typecheck clean · no migration. Billing, project settings and repositories rendered and looked at; the study itself stays reachable at `/e2e/study-button-look` so the four alternatives can be seen beside what shipped.

**Not proved:** hover and press were judged from statically-applied classes in the study and from the real product at rest. Nobody has moved a pointer across the new primary on a real machine, and nobody has pressed one on a phone — which is exactly the surface where the resting-container argument was learned in the first place.
