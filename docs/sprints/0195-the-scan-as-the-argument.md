# Sprint 0195 — The scan as the argument

**Date:** 2026-09-09
**Decision:** the landing page's second block shows the Product Scan, settled — the real component, on a fourth variant, scanning Vibe.

## What was asked

*"Zeig den Product Scan in diesem Block, der ist viel eindrucksvoller … dass er das Produkt dahinter erkannt hat, ist viel eindrucksvoller."*

Right, and the block it replaced was making the wrong argument. Four rows of
source coverage say *Vibe read your files*. Nobody arriving at a landing page
cares which files were opened; what they want to know is whether it understood
what it was looking at. The Product Scan is the only surface in the product
that shows that happening — a constellation with the product at its centre and
six facets around it, each one a thing worked out rather than a field somebody
filled in.

## What "a bit adapted so it looks better" turned out to mean

Nothing was invented. Four things were **fixed**, and every one of them was a
defect in the product's own component rather than a marketing licence.

**The scan was empty.** The first mount passed the events and the presentation
without an operation, and `ProductScanExperience` builds its picture from all
three together — so the landing page rendered a constellation with six facets
all reading "Detecting…", "Not observed" and "0 found". A screenshot of the
product failing.

**The heading was in the wrong tense.** *What we're discovering*, over six
ticked rows of a scan that had finished. One tense for two states, and it was
wrong in the workspace too at the end of every run. It follows the state now.

**An arrow that went nowhere.** *Product profile ready →* was a `<span>` with a
`→` beside it and no destination. UI-26 settled that the mark means navigation
and removed seventeen of these; this was the eighteenth.

**Four of six labels unreadable on a phone.** *Product t…*, *Core feat…*,
*Audience…*, *Brand / i…*, in the surface whose entire subject is what Vibe
recognised — plus *Audience signals* clipped beside *AI builders and founders*
in the panel rows at any cap the value column was given. The facet card is a
fixed 10.75rem beside the graph, where truncating is what it is for; below `md`
it becomes a full-width tile and was still truncating. Two lines there, and the
rows stack below `sm`.

## A fourth variant, and why it earns its place

`showcase`. The other three collapse a settled scan — correctly, for a founder
who has already seen theirs and wants the summary line back. A visitor who has
never seen one wants the opposite, and there is nothing here to collapse *into*:
no live activity, no next step, no project.

It drops the console half — the live trail and the same six facets again as
saved cards — because a "Live activity" heading over a finished list is a label
that is not true, and a third rendering of six facets is length rather than
evidence. **1,825px instead of 2,433.**

And it never refreshes the router. The other callers fire `router.refresh()` on
a completed operation to pick up what the scan wrote; this one has nothing to
pick up and no session to pick it up with, so on the landing page that call was
a refresh of a marketing page on every load.

## The scanned product is Vibe

Every other option is worse. An invented customer is a fabricated record
whatever the caption says; a real customer's product needs their permission; a
placeholder called "Your product" throws away the one thing worth showing.

So it reads Vibe Business, and every line is true of this repository: a Next.js
web application, for AI builders and founders, with authentication, business
guidance and product scans as capabilities, and subscription signals in the
code. The timestamps and the operation id are example. The **shape** is not —
`ProductScanPresentation` and `ProductScanEvent` are the types a real scan
produces, so a facet the scanner cannot fill is a compile error rather than a
flattering picture.

The honesty did not get dropped, it moved: `SourceCoverageStrip` sits under the
constellation, one line marking the two sources Vibe fell short on, with the
sentence about what a scan cannot reach beside it.

## Two tests that were measuring the wrong moment

**A geometry guard started its stopwatch too early.** `keeps the scanner
geometry fixed while individual findings arrive` took its "before" reading
straight after `page.goto`, which resolves on `load` — ahead of the graph's own
layout, with the facet cards still in flow and the fallback face still in place.
It read **1062** against a settled **130** and reported a geometry break that
was a measurement error. It passed alone and failed beside its neighbours, which
is this repository's signature for exactly that.

**A clipping guard was measuring an intended ellipsis.** Written for both
widths, it also asserted no truncation at 1440 — where a facet card is a fixed
10.75rem and truncating is the design, right on the boundary. Same font race,
third form. It is a 390 guard now, with the reason written where it is.

`product-scan.spec.ts` had also pinned the running tense against a completed
scenario, and was passing on a heading that was wrong. Repaired, not deleted.

## Five guards, each broken to prove it

A finished scan of a product it recognised · the caveat is still on the page ·
nothing inside the block is pressable · no clipped labels on a phone · the four
existing reveal and CTA guards unchanged.

Mutations: the operation dropped so the constellation empties, `showcase`
losing its expansion so the block collapses to a summary line, the presentation
losing its product type, the tense pinned back to one state, a source remedy
restored so a dead control returns, and the phone truncation put back. All
caught.

Unit 9,475 · browser 764 · tsc clean · eslint 0 · build clean
