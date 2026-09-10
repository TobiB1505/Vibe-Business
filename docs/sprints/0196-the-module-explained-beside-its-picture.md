# Sprint 0196 — The module, explained beside its picture

**Date:** 2026-09-09
**Decision:** two tiles. The Product Scan is a small preview in one; what the module *is* is written in the other.

## The correction

*"Es war nicht gemeint, dass Du den Product Scan da komplett reinkopierst, sondern dass erklärt wird, was der Product Scan macht — in einem Zwei-Kachel-System, in die eine Kachel kommt der Product Scan als Bild, viel viel kleiner. Wir sind auf der Landingpage und wir müssen unsere Module erklären."*

Right, and 0195 had the emphasis exactly backwards. It put the whole scanner at
full width — 1,825 pixels of it — with a heading above and a caption below. It
showed the module beautifully and never said what the module was **for**. A
visitor who has never used Vibe cannot infer what a Product Scan is from a
picture of one, however good the picture.

So the words lead now and the picture supports them: a heading, one paragraph
of what the module does, three lines of what it reads, and the coverage strip
saying where it could not look. The preview sits beside all of that at about a
third of the size.

## The preview is still the real surface

`ProductScanExperience` on `variant="showcase"`, rendered at a desktop measure
inside a fixed box and scaled down — not a screenshot and not a marketing redraw
of the constellation. A change to the scanner still changes what this preview
shows, which is the whole reason for mounting the component rather than
illustrating it.

Cropped at the bottom on purpose: a fragment reads as a window into something
larger, where a complete miniature reads as a diagram of it. The fade is a mask
on the wrapper rather than an overlay, because a gradient painted *over* the
preview would need a ground colour to blend into and this block sits on the
shell's grid.

`aria-hidden`, and that is not a shortcut. At this scale the type is a texture
rather than something to read, and every fact in it is stated in words in the
tile beside it — a screen reader meeting the shrunk copy would meet the same six
facets twice, once illegibly.

## The arithmetic ran the wrong way round

A transform does not shrink an element's **layout** box. The scan is rendered
wide and scaled to fit, so without a definite width on the crop and `min-w-0`
on the grid cell, the 880px child sized the column: a 350px phone tile measured
**906**.

Then the obvious fix was worse. `--scan-scale: calc(100cqw / 880)` looks like a
ratio and is not even valid — dividing a length by a number yields a **length**,
so the scale came out as `0.69px`, the height that multiplied by it was dropped
as invalid, and the tile grew to its content at **1,139px**. It renders; it is
just wrong, which is the kind of CSS error that ships.

So the scale is the plain number and the render width is derived from it:
`width: calc(100% / var(--scan-scale))` is a percentage over a number, which is
a length, and the scaled result is exactly the tile's width at every viewport.
The box is an `aspect-ratio` rather than a height so the crop keeps its shape as
the tile narrows.

One thing the scale does **not** control: which layout the scan draws. The
scanner's own breakpoints are viewport queries, so on a phone the preview shows
the phone arrangement however wide the element it is rendered into. That is
correct here and the comment says so, because the opposite assumption is exactly
what `DiscoveringPanel` already records paying for.

## Two guards, both broken to prove it

**The preview fits its tile, at 1440, 1024 and 390** — measured as the painted
width against the crop's, with a floor as well as a ceiling, so a preview that
leaves half its tile empty fails too. Mutated by taking the crop's width away
and pinning the child at 880px: it failed.

**The picture is beside the words, not instead of them** — the preview carries
`aria-hidden`, the heading is not inside it, and the three lines of what the
scan reads are in the tile. Mutated by removing `aria-hidden`: it failed.

The five guards from 0195 stand unchanged and still pass, including the one that
counts zero pressable things in the block.

Unit 9,475 · browser 766 with 2 new · tsc clean · eslint 0 · build clean
