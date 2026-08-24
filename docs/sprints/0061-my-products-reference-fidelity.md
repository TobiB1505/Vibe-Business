# UI-9 — My Products Reference Fidelity

**Status:** implemented on branch, preview dogfood pending. **No infrastructure change** — no
migration, provider, AI call, paid work or per-product query was introduced.

## Problem

CORE-6 gave the account a correct product index, but reused the compact Home cards. That made the
route functionally redundant: Home and My Products showed the same objects at the same density,
while the supplied reference treated My Products as the place to compare product identity,
audience, intent, repository state and Business Signal.

## What changed

- The existing dark Vibe design system is retained; the reference contributes structure, spacing,
  density and interaction rather than forcing a global light-theme change.
- The header now carries functional search, workflow filters and sorting.
- A four-part summary reports only values the domain owns: total products, analysed products,
  products needing attention and the existing connect action. The reference's “Active products”
  and average Business Signal are deliberately not reproduced because neither is a Vibe result.
- My Products has a dedicated wide list row. Home keeps its compact card, so the two account routes
  now have different jobs rather than different headings over the same component.
- Product descriptions, purpose, audience and founder goal come from the exact Product Profile used
  by the latest audit, overlaid with current founder corrections, plus the existing closed-enum
  founder intent. Missing fields remain missing and render as such.
- Repository visibility, default branch, score history and workflow status use existing columns and
  deterministic presentation rules. No logo, technology stack or “Active” badge is inferred.

## Cost boundary

`getProductsOverview` composes the existing dashboard read model with three batched reads: exact
profile ids already attached to the latest audits, one corrections row per project and one founder
intent row per project. The number of queries does not grow with the number of products, no loop
contains an `await`, and the dashboard cost contract now guards this module explicitly.

## Verification

- TypeScript: clean, including generated route types and the client/server boundary for the new
  index.
- ESLint: zero errors; the repository's existing 15 warnings remain unchanged.
- Unit suite: 6,126 tests across 341 files, all green. The new summary, search/filter/sort and cost
  contract tests are included.
- Browser contract: eight My Products scenarios are registered — hierarchy, search, filter reset,
  score sorting and no horizontal overflow at 1440, 1024, 768 and 375 pixels.
- Production build: the normal Turbopack build again remained in “Creating an optimized production
  build” without an error and was stopped after one minute. UI-8 records the same behaviour and the
  pre-existing diagnostic Webpack `node:crypto` failure; this record does not call the build green.
- Browser preview comparison: pending. Repository policy prevents starting branch code outside the
  approved isolated runtime, and this repository has no Sites hosting configuration. The existing
  Vercel preview remains the correct safe dogfood surface after push.
