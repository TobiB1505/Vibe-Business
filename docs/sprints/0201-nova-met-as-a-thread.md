# Sprint 0201 — Nova, met as a thread

**Date:** 2026-09-09
**Decision:** module five of the landing page is Nova, and she is met as a conversation — five things she actually says, with her own registers on them.

## What was asked

*"Mach mit nova weiter."*

## The fifth shape, and why it is not another diagram

Two tiles, a staircase, a narrowing, a passage. Every one of those explains a
**mechanism**, and this block is the only one on the page that does not: it is
about who says all of it. A thread is the one shape here that reads as somebody
talking rather than as a drawing of something, so the block is bubbles down a
column with the mark beside them, staying there while they are read.

She is one object rather than one avatar per bubble. An avatar repeated down a
thread is a chat interface; this is an introduction.

## Every word is hers, and none of it was written on this page

`novaCandidateMessage` is the product's accessor over the single table where
Nova's sentences live, and it is deliberately built so a caller gets one
sentence for one candidate and cannot iterate, reorder or extend it. So the page
chooses **which** five moments to show and the product supplies **every word** of
all five. A sentence invented for marketing is not expressible in this file.

The register on each bubble comes from `statusForCandidate` for the same
reason. The tone, the status word and the dashed contour of an open loop are the
product's reading of what kind of moment this is — not a colour chosen because
it looks calm beside a paragraph. A run suspended on a person is `waiting` and
**open**; a check that ran and returned non-zero is `problem` and closed. Those
were once the same amber, and the vocabulary was rewritten precisely because
"less bad" and "less certain" are different claims.

## Three of the five are sentences most products would never publish

*A check on one of your changes did not pass.* *What I know about your code is
older than your code.* *Nothing needs you right now.*

They are the argument. A co-founder who only ever reports good news is one you
cannot use to make a decision, and the last of them is the one a growth team
would cut first: a product that always has something for you is a product
inventing work.

The order is the page's — a narrative from *your turn* to *nothing needs you* —
and the docblock says so, because `deriveNovaFocus` is the only thing in this
system that ranks anything.

## The introduction was playing to nobody

`NovaPresence introduce` assembles the mark on mount: the blades seat
themselves, the iris opens, the light curve draws last. On a one-screen page
that is exactly right. On an endless scroll every block mounts when the page
loads, so the one entrance the component was built for happened roughly six
thousand pixels above the reader, every time, and nobody had ever seen it
outside a design study.

`NovaEntrance` holds it. The server still draws the mark — a reader with no
JavaScript gets no observer and no effect, and the mark is what this block is
*about* — and the client, once running, keeps that same element invisible until
the block is reached, then hands over to the introduction. Same element, same
geometry, so nothing on the page moves at the swap.

A reader who asked for no motion keeps the server's mark, drawn and still,
however far they scroll. There is no assembly coming for them, and holding it
back would be movement of a different kind: an element appearing.

## A guard that passed by racing hydration

The reduced-motion guard first asserted the mark reads `drawn` at first paint —
and it was **green with the reduced-motion branch deleted entirely**, because at
first paint the attribute reads `drawn` for everybody: the server drew it. It
was measuring the server, then finishing before the client contradicted it.

It scrolls to the block and waits now, which asserts the property that actually
matters: no assembly ever arrives.

## Two locators that named positions

`const legend = section.getByRole("list")` was fine while the section had one
list. The thread is a second one, so it now asks for the legend by name — the
same defect as the rail guard in 0197, in a section that had simply never had a
second list before.

And in the note gutter, the first layout gave the thread the whole remaining
width: the bubbles are `w-fit` and the notes sat 232–374px to the right of the
sentences they annotate. A margin note that has to be searched for is a second
column. The gutter is sized to the widest bubble measured at 1440 now, and the
gaps are 56–198px.

## Four guards, four mutations

The product's own five sentences · the product's own register on each, checked
by class · the introduction held until the block is reached · and never
assembled at all under reduced motion.

Mutations: every bubble given one candidate's sentence, the tone pinned to
`neutral`, the hold removed, and the reduced-motion branch removed. All caught —
after the first attempt at the sentence mutation deleted the accessor call
outright and failed the **build** instead of the test, which proves nothing.

Unit 9,475 · browser 786 with 4 new · tsc clean · eslint 0 · build clean
