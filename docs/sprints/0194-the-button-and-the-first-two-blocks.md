# Sprint 0194 — The button, and the first two blocks

**Date:** 2026-09-09
**Decision:** the landing call to action is one row of type; the page below the hero gets a block at a time, starting with the gap and the scan.

## What was asked

*"Der Marketing CTA gefixt, dass da kein Zeilenumbruch drin ist, und es muss auch nicht so riesig sein. Ich find den Button nicht so schön."* And then: *"wir gehen jetzt unter der Herocard nächster Block, nächster Block, nächster Block … was fehlt noch, was muss rein, was muss auf alle Fälle drinstehen."*

## The button

It was a two-line block about 76px tall behind a halo four rems wider than
itself, and inside 0193's hero card it was the loudest object on a screen whose
subject is the sentence above it.

It is a single row now, and the label is a **length constraint** rather than
free copy: `whitespace-nowrap` states that a call to action which breaks across
two lines has stopped looking like one thing to press, so the words have to fit
the narrowest place the component is used — about 300px inside the hero card at
390. "Start with your GitHub repo" did not fit. "Start with GitHub" does. The
arrow beside the GitHub mark went with it: a mark on the left and an arrow on
the right are two ornaments on a control whose whole job is to be one thing.

What UI-29 was protecting is unchanged. The assurance still answers the
objection a visitor has *at the moment of pressing*, so it is still attached to
the control — one line under the button instead of one line inside it.

**And the component was fighting itself.** It appended `px-8`, `rounded-card`
and `font-bold` beside the size's own `px-6` and `rounded-nav`. `cn` is a
filtered join rather than `tailwind-merge`, so both shipped and the generated
stylesheet picked the winner — the same defect `SIZE_CLASSES` already records
for `text-base` against `text-body`, where the padding grew and the type did not
for the whole life of the landing page. The geometry comes from the size, once.

## Block one — the gap

The page went from the claim straight to a preview of the Business Brain: *here
is the thing* ahead of *here is why you would want a thing*, and every block
after it was another feature at the same rhythm. Nothing agreed with the visitor
first.

`LandingProblem` asks five questions and takes them from `BUSINESS_LENSES` — the
audit's own nine areas — rather than a list typed into a marketing file. The
type is `Partial<Record<BusinessLens, string>>`, so a category invented for the
landing page is a compile error rather than a plausible-looking drift nobody
notices from either side.

It is deliberately not a card. Every other block on the page is an object with a
border; this one is a statement with hairlines, so the page has somewhere quiet
before the Business Brain arrives.

## Block two — the scan

Moved out of `LandingFlow`'s first tab rather than copied. A tab bar asks the
reader to stop and choose inside a page whose whole shape is a scroll, so the
six steps are being taken apart one at a time; *Understand* went first and the
flow section is five tabs now, with its own intro line corrected from "from
product understanding" to "from what Vibe read", because the step it used to
contain is a block above it.

**Three of the four sources are not `ready`.** Vibe read the code, half-read the
live product, and has not seen past the sign-in at all. A marketing page's
instinct is four greens; this one shows the product's real component in its real
states, because `SourceCoverage` states *why* it stopped short in the module
that owns the vocabulary, and a page that hid that would be promising a first
scan that does not happen.

**Every remedy is null, and that is the finding.** In the product a partial
source carries its own way out — *Scan again*, *Deep Scan*, and a price beside
it. Rendered on a landing page those are buttons a visitor can press against no
project and no balance: "Scan again" jumped to the top of the page and "Deep
Scan · 25 Credits" jumped to the pricing section. A control that cannot do what
it says is worse than no control. The block's prose says what the states mean
instead, and a guard counts **zero** pressable things inside the section.

`EXAMPLE_SOURCES` moved to `landing-sources.ts` on the way. Three blocks read it
and it lived in whichever one defined it first, so the trust bento was importing
its evidence from `landing-flow` — an import that would have travelled with the
section as it is dismantled.

## Two things the browser said and the source did not

**The phone had the evidence before the argument.** At one column "left" and
"right" collapse into "above" and "below", so the reader met four source cards
before any sentence said what they were evidence of. `max-lg:order-first`, and a
guard that compares the two boxes' page offsets rather than trusting the class.

**Removing a tab broke the build before it broke the test.** The mutation for
the tab-count guard deleted a step, which left `PLAN_STEPS` unreferenced and
failed `tsc` — so the guard never ran and the mutation proved nothing. Adding a
sixth tab instead is the mutation that actually exercises it, and it failed as
it should.

## Ten guards, each broken to prove it

The CTA is one line at 1440 and 390 · the assurance is outside the pressable
area · five questions, each named by an area the audit holds · the gap arrives
from both sides and is fully there once reached · four sources with one partial
and one unread · a partial source states why it stopped · nothing inside the
scan block is pressable · the argument sits above the evidence on a phone · the
flow has five tabs · the panel switch reserves its height.

Mutations: the long label back, `whitespace-nowrap` removed, the assurance back
inside the button, a question deleted, a remedy restored, every source turned
`ready`, the reason sentence flattened, `max-lg:order-first` removed, a sixth
tab added. All caught.

Two existing specs were repaired rather than deleted — both pinned the old CTA
label while asserting something else entirely (that the primary action goes to
`/signup`, not `/login`), and the source-coverage assertions moved from
`first-ten-minutes` to the block that now owns them rather than being dropped.

## Named and not fixed

A sideways reveal still travels sideways on a phone, where the same 44px is a
larger share of the screen. It is clipped and it is not wrong, but the direction
stops meaning anything at one column; the fix is a width-aware `from`, and it
belongs with the next block that needs one rather than here.

Unit 9,475 · browser 763 with 8 new · tsc clean · eslint 0 · build clean
