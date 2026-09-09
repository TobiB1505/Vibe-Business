# Sprint 0197 — The walk down the page

**Date:** 2026-09-09
**Decision:** the landing page's modules hang off a numbered spine that draws itself as it is scrolled to.

## What was asked

*"Die hinteren Kacheln waren gut … dadurch dass wir ein Endlos-Scroll haben, kann es sich anfühlen wie diese typischen Whiteboard-Tutorial-Illustrationen … und dann erklären wir den Ablauf und die Module von Vibe Business."*

## The reference, looked at rather than assumed

A whiteboard explainer is a line drawn while somebody talks: simple line art on
a plain ground, numbered steps hanging off the path, short annotations pointing
at the thing being explained, and the pen visibly moving so the eye follows it.
The technique behind the web version of that is a stroke whose `dashoffset` is
walked to zero as the reader scrolls — a route that draws itself.

Three things transfer to this page and one does not.

- **The path.** A spine runs down the left of the page and each step's segment
  draws itself as that step arrives. The scroll becomes the narrator's hand.
- **The numbering.** `01`, `02`, `03`. A reader always knows where in the walk
  they are, which is the thing an endless scroll otherwise takes away.
- **The annotation.** A short mono note beside the subject rather than a
  paragraph about it — which is what the module eyebrows already were.
- **Not the skin.** No handwriting face, no marker, no white board. `DESIGN.md`
  owns the type scale and the ground, and a felt-tip drawn on a dark product
  page is a costume — it would also make every real screenshot beside it look
  pasted in, which is the opposite of what this page's screenshots are for.

## `scaleY`, not a stroke

The spine is straight, so the classic `stroke-dashoffset` walk buys nothing a
transform does not, and a transform composites where a stroke property repaints.
`vibe-ring-draw` stays the mechanism for arcs, which is where a path length
actually has to be measured.

A first pass added a `.landing-rail` CSS animation *and* the motion component,
which is two mechanisms for one line. The CSS went; the component keeps it,
and inherits `Reveal`'s reading of the three obligations — a one-shot entrance
has no loop to pause, `initial={false}` lands the settled state under reduced
motion, and the rail occupies its full height from first paint so only the fill
inside it grows.

## Geometry, twice measured

**The number was 104px below the thing it numbered.** At `top-[6.5rem]` it sat
beside the preview tile rather than level with the block's eyebrow, because the
rail column starts where the section's padding ends and so does the eyebrow.
`top-0`.

**The segment faded out halfway.** A mint-to-transparent gradient reads as an
unfinished drawing rather than a path between two steps; the mint is
concentrated at the node now and the line holds at `line-strong`.

Below `lg` the rail is gone — it would spend a quarter of a phone's width on
decoration — and the number moves inline above the block. The walk is still
counted, which is the part carrying information.

## The gap block is not step zero

It keeps no number and no rail. The walk starts at the Product Scan; numbering
the question that motivates the walk would count it as one of the modules.

## Two guards, both broken to prove it

**Each module is numbered once** — the rail's copy above `lg`, the inline copy
below it, never both painted. Mutated by removing `lg:hidden`: it failed.

**The segment draws to full height and stays out of the reading** — measured as
a real box height after scrolling, plus the `aria-hidden` that keeps a drawn
line from being described to a screen reader that already has the headings.
Mutated by animating `scaleY` to zero: it failed.



## Sources

- [Whiteboard animation — Wikipedia](https://en.wikipedia.org/wiki/Whiteboard_animation)
- [What is whiteboard animation process — Hatch Studios](https://hatchstudios.com/what-is-whiteboard-animation-process-uses-elements-process-examples/)
- [Scroll Drawing — CSS-Tricks](https://css-tricks.com/scroll-drawing/)
- [stroke-dashoffset — CSS-Tricks](https://css-tricks.com/almanac/properties/s/stroke-dashoffset/)

## Addendum — the background that was there and invisible

The founder, looking at the hero on a phone: *"Wo ist der background hin?"*

Nothing had been deleted; `git diff` over `globals.css` since the hero landed
shows no removed line. It was measurably present and effectively invisible, and
the reason was **geometry, not opacity**.

Sampled off the rendered page at 1440:

| probe | before | after |
| --- | --- | --- |
| ground, far left | `7,10,12` | `11,13,14` |
| beside the card | `6,12,13` | `9,45,35` |
| above the card | `8,21,19` | `15,56,47` |

A 46%×42% mint pool at `50% 52%` is 626px wide, sitting behind a 768px card
that is opaque by design. The whole light was painted underneath the thing
covering it, and the only place it escaped was a thin band above the card. An
earlier pass widened the **mask**, which was never what was hiding it.

The light frames the card now — two pools at the shoulders and a broad low wash
reaching the section's edges — and the grid went from 8.5% white to 13%, because
8.5% composites to about +8 per channel over this ground: enough on a good
monitor at full brightness, and nothing on a phone, which is where it was
reported missing.

**One guard, mutated both ways**: the pools must sit off the centre line, and
the grid mark must clear the threshold this ground swallows. Recentring the pool
fails it; dropping the mark back to 8.5% fails it. Its limit is stated where it
lives — it reads the computed value rather than sampling pixels, so it would not
catch a light that is off-centre and still too weak, because decoding a
screenshot needs an image library the browser suite does not carry. The pixel
sampling stays a thing done by hand, which is how both of these were found.

## Addendum 2 — the ground between the lit places

*"Beim Product Scan sollte ja doch ein fließender Background sein oder nicht?"*

Yes, and it was not. A vertical profile down the left edge at 1440, green
channel, before:

```
hero          15  18  19  19  19  17  17  16  18  15  15  16
between       14  13  12  12  12  13  13          ← five hundred pixels
module 01     21  26  28  25  19
```

The hero stood on a field and the walk below it stood on nothing. A page that
goes dark between its lit places is three pictures with gaps, not one
atmosphere.

Two things fixed it.

**A room.** One `fixed` layer the size of the window, very low, so every scroll
position has ground under it. `fixed` rather than `absolute` on purpose: an
absolute layer would have to span ten thousand pixels and place its light at
percentages of a height that changes every time a block is added. Its pools are
centred vertically, because a fixed layer paints the same light at every scroll
position and an off-centre one put an identical dark quarter at the foot of
every screen — a vignette stuck to the window rather than a room.

**A pool per module**, alternating sides down the page and masked to fade in and
out, so consecutive steps are lit from opposite edges and the light travels
rather than restarting. The first mask fade was 22% and left a seam; with the
vertical bleed the component gives the element, 8% is enough.

After, at a real 900px viewport, the left edge reads 23–41 through the whole
scroll and never returns to the flat 12–13 it was.

## Addendum 3 — a selector that moved under its own guard

Adding the ground broke the rail guard, and the way it broke is worth keeping.
It found its subject with `#scan > [aria-hidden]` — a *position*, not a name —
so the moment the step gained a second decorative layer above the rail, the
guard started measuring the ground and timed out looking for a `span` inside it.

Both layers carry a class now (`landing-step-rail`, `landing-room`), and the
guards ask for them by name. A guard that identifies its subject by where it
happens to sit is one edit away from asserting something else entirely — and it
would not always fail loudly, which is the part that makes it worth a note.

**Two more guards, both mutated**: the room must be `fixed` (made absolute →
fails), and a module's pool must sit off the centre line (recentred → fails).

Unit 9,475 · browser 771 with 5 new · tsc clean · eslint 0 · build clean
