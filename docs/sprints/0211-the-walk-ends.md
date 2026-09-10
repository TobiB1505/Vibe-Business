# Sprint 0211 — The walk ends

**Date:** 2026-09-10
**Decision:** the FAQ questions get their size back and lose their quotation marks; step ten closes the walk.

## The questions, and the marks around them

*"Beim FAQ die Fragen etwas größer und keine Anführungszeichen."*

`text-lead` to `text-moment` — 0.9375rem to 1.5rem — which is roughly where they were before the accordion shrank them into rows.

The quotation marks go for the same reason nothing here is attributed: **marks around a sentence nobody said imply somebody said it.** The block's own rule was already written down — these are the doubts this product meets, not testimonials — and the marks were quietly working against it. A guard asserts the first question carries no quote character at all, beside the existing ones for no `cite`, no image and nothing shaped like an attribution.

## Step ten is a bookend, deliberately

Nine shapes, each different, because a long scroll with one rhythm stops being read. This one repeats: an object on a lit ground with a sentence and one control, which is the hero. The page opens on a card and closes on one.

That is the only place a reprise belongs. A reader who has come nine blocks knows where they are, and the thing to give them is the shape they started at with what they have learned in it — the mark rather than a screen, because everything the product does has already been shown above.

`last` on `LandingStep` draws the rail short, which is what makes a numbered walk *end* rather than run off the bottom of the page.

## The last sentence is the one a call to action would cut

> And if there is nothing worth doing yet, Vibe will say that too.

Nine blocks of refusing to overclaim cannot end in an overclaim. A guard pins it, and the mutation that proves the guard is the sentence a growth rewrite would put there instead: *"Vibe finds what to do next, every time."*

## A guard that measured the wrong box

The rail-stops-here test compared the segment's foot against the **section's** foot and passed with `last` removed — because the section carries 112px of bottom padding that the rail sits inside, so both states cleared the threshold. Measured against the rail's own box the difference is the six rems `last` actually draws, and the mutation fails as it should.

## And a fourth contract followed its claim

`landing-contract.test.ts` pinned *"From product to business, together."* and *the first control points at signing up* against `page.tsx`. That file now composes ten components and contains no `href` of its own, so the second assertion was checking an empty string. Both repointed — the close and the hero — after the hero, the proof section and the plan cards before them. The pattern is worth naming: **this contract reads files, and files that stop containing the claim keep passing it.**

Six guards across the two changes, six mutations: the questions shrunk, a quote mark restored, every FAQ row opened, `last` removed, the honest sentence replaced with a promise, and the close pointed at sign-in. All caught.

Unit 9,486 · browser 809 with 3 new · tsc clean · eslint 0 · build clean
