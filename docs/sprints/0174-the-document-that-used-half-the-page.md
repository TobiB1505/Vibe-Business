# Sprint 0174 — The document that used half the page

**Date:** 2026-09-07
**Decision:** none. Craft on two public routes.

## Why these pages, and why now

Nova, the Agent and the scanner are being worked by three other branches and are thick with AI logic — a fourth writer there would be a merge problem, not progress. What is left is the work nobody enjoys and everybody needs: the legal pages, the auth screens, Settings, Billing, Project Settings. They all exist. None of them was finished.

This is the first of them.

## What was wrong

Two defects, both geometric, both invisible from the source because every component rendered correctly.

**The article used half the screen.** `legal-page.tsx` set `max-w-[46rem]` with no `mx-auto`, inside `MarketingShell`'s `max-w-[96rem]` container. Measured at 1440: `main` 1440px wide, the `h1` starting at x=40, and roughly 700px of nothing to the right of the text. Not a narrow column — a column pinned to one edge.

**A nine-section legal document had no way in.** Privacy has nine `h2` sections, Terms eight, and neither page carried a single `#` link. Reaching the retention clause meant scrolling past eight others.

They are the same defect: the page never decided what to do with the space it has.

## What was built

A contents list, and the contents list is what fills the space. Sticky beside the article from `xl`; the same list as a closed `<details>` below that, because a reader who came to read should not scroll past a table of contents to begin, and a reader who came for one clause needs one tap.

The article keeps the left margin the header's lockup already sits on, so nothing a reader has found moves — what changes is that there is now something to its right.

**The list is derived from the sections, not written beside them.** A list of headings passed in as a prop is a second copy of the document's structure, and the two drift the first time somebody adds a section and forgets the list — silently, because a missing entry breaks nothing visible. `LegalPage` reads its children, and one `sectionId` function computes the anchor for both the entry and the section it points at. A link that goes nowhere is not something that can be written here.

`scroll-mt-28` on every section, because the marketing header is `sticky top-0` and without it each link lands with its own heading underneath the bar the reader just clicked through.

**And the column got narrower, not wider.** 46rem of 14px body text measures 77 `0`-advances — nearer ninety real letters, well past the bound this repository's own audit procedure sets. 39rem is 70.

## What the guards say

`e2e/legal.spec.ts`, over both documents, four claims each — all three load-bearing ones mutation-tested by restoring the old behaviour:

- Every entry in the list points at a section that exists, compared as ordered lists rather than counts. Making the anchor differ from the link fails it.
- Clicking an entry lands its heading below the sticky header. Removing `scroll-mt-28` fails it.
- The contents sit to the right of the article rather than the article sitting alone. Hiding the column fails it.
- A phone gets the list as a closed disclosure, no sticky column, and no horizontal overflow.

## What is still true and still not done

The `Not yet complete` panel stays, and so does everything in it: the operating entity, the governing law, the refund terms, the notice periods, the support contact. None of those facts exists anywhere in this repository, and inventing them would be worse than omitting them. This sprint made the documents readable; it did not make them finished, and the page still says so itself.

## Validation

Unit 8,840 · browser 603 · lint 0/0 · typecheck clean · no migration.
