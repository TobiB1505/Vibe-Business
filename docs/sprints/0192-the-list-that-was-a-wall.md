# Sprint 0192 — The list that was a wall

**Date:** 2026-09-09
**Decision:** treatment A from `study-products` — the products page is a list, and its one action is a button.

## What was asked

Products audited in v2, four shapes, and the one the founder picked. **A.**

## What the audit found, measured

At 1280, 1440 and 390, on `account-products`, with `VIBE_PALETTE=v2`.

Two findings were the same defect in different clothes.

- **Focus was invisible on the search field.** The page carried its *own copy* of the search box, and 0189's fix went to the repositories page only. Measured with real Tab presses: `box-shadow: none` and a border going to 32% mint here; `rgb(0, 229, 160) 0px 0px 0px 2px` one page over. One hand-written field repaired, its twin not.
- **The one action was dressed as a fourth statistic.** `Connect product` sat in the metric row at the size and shape of `3 Products`, drawn with its own border, fill and hover — after 0185 folded every pressable control into `Button`.
- **The metric row counted the list beneath it**: 3 products, `2/3` analysed, `2` needing attention, above three cards that said so.
- **One card stated the same absence seven times in five wordings**: `NOT ANALYSED` · No product summary is available yet · Not established yet ×3 · Product profile pending · No data yet · **Analysed not yet** — which is not English and disagreed with the pill two lines above it.
- **Three products, three heights**: 252 / 194 / 231 at 1280.
- **Four zones per card in four rhythms**: identity, a definition grid, a metadata list, a score block with a sparkline.
- **2,792px on a phone**, the first ~430 of it four stacked tiles of arithmetic.

## What shipped

One card, three rows, one height. **1,074 → 900px** at 1280 and **2,792 → 1,130px** at 390.

A row carries the mark, the name, the state as a word, the signal and where pressing goes — which is the question the page answers. What a product *does* is a thing to read inside the product, where there is room for it. An unread product says so once, in its pill.

The header carries the page's one action and nothing else; the list's own controls moved above the list. That split was forced by measurement rather than taste: `SectionHeader` gives `actions` `sm:shrink-0`, so four controls in that slot overflowed the page by 109px at 1024 and 109px at 768.

## The search field is one component now

`SearchField` joins `SegmentedControl` and `SortSelect` in `list-controls.tsx`. The ring lives there, so does the clear control, and the two fills that had drifted — `bg-surface-2` against `bg-field` — are one.

`clearLabel` is a prop rather than derived from the field's label, because a template produces "Clear search repositories" and nobody says that.

## Three things the browser said and the source did not

**A `min-h-9` that did nothing.** It sat on the name column to reserve two lines for rows carrying a project label. Removing it changed no measurement: the mark beside it is 44px and the column reaches 36 at most, so the mark sets the row height. Found because the guard that should have caught its removal passed. Deleted, with the reason written where it was.

**`flex-wrap` wrapped the wrong thing.** Wrapping the name column alone put the mark on a line of its own — three lines per row on a phone, 162px each. The mark and the name are one flex item now, so they take the first line together and the state and signal go under them.

**A one-pixel divider was a height difference.** The hairline was on the link, so the first row measured 76 against its neighbours' 77 — the height problem this rebuild removed, reintroduced by a border. It belongs to the list item, which also stops the hover fill painting under the line above.

## Six guards, each broken to prove it

One card and not three · mint on `Connect product` and nowhere else · every row the same height · an absence said once · no tally of the rows · a focus ring on **this** page's search field.

Every one was mutated: the primary turned secondary, a facts grid put back on one row, "Analysed not yet" restored, a metric section reinstated, the shared ring deleted. All six failed as they should.

The three unit guards that named the deleted file were repaired rather than deleted: the identity boundary now reads the row, `design-tokens` drops an allowance for a file that no longer exists, and `figure.test.ts`'s floor moves from eight wearers to seven — a number that moves when a deliberate deletion moves it, and never quietly.

Unit 9,475 · browser 749 with 6 new · tsc clean · eslint 0 · build clean
