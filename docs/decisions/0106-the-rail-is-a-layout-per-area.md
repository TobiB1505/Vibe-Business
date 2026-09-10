# 0106 - The rail is a layout per area, and it has a first frame

Status: Accepted
Date: 2026-09-07

Corrects the **one-catch-all clause** of [ADR 0105](0105-one-rail-that-unfolds.md), decided the same day. The `<aside>` still belongs to the shared layout and the navigation is still a `@rail` parallel route; what changes is that each area's navigation is a **layout** rather than one catch-all page, and the slot has a `loading.tsx`.

## Context

ADR 0105 chose one catch-all slot route, `@rail/[...path]/page.tsx`, over one route per area, on this reasoning: *a route boundary is a remount boundary, so one route never remounts.*

That sentence is true about mounting and wrong about everything that matters. A **page** is matched per URL. Moving from `/app/projects/x` to `/app/projects/x/plan` is a different match of the same route, so the rail re-rendered on the server and refetched all of it — the project context, two count queries, the Agent's status, four sibling names — on every single section click. The `<aside>` stayed; nothing inside it did.

The second half was worse. The slot had no `loading.tsx`, so it had no Suspense boundary of its own, and the nearest ancestor is `src/app/app/layout.tsx`, which has none either. The router therefore could not commit *any* navigation under `/app` until the rail's reads returned. Every click in the product waited on the chrome standing next to the thing being navigated to. The founder's report was "es fühlt sich nicht flüssig an" and "man sieht 'n klaren Ladestatus", and both were describing this exactly.

## Decision

### Each area's navigation is a layout

```
@rail/projects/[projectId]/layout.tsx   the product's navigation
@rail/projects/[projectId]/page.tsx     null
@rail/projects/[projectId]/[...section]/page.tsx   null
@rail/settings/layout.tsx               the account's navigation
@rail/settings/page.tsx                 null
@rail/settings/[...section]/page.tsx    null
@rail/default.tsx                       null — no rail at all
```

A layout is matched by its own segment and **preserved while that segment holds**. `projectId` is the segment, so the rail is read once per product and then simply stays: a section click re-renders a `null` page underneath it and nothing else runs. The active row was already derived from `usePathname` on the client, so it keeps up with no server render at all.

The pages render nothing and import nothing. That is the invariant — a slot page that draws something is a slot page matched per URL — and it is asserted rather than remembered.

A required catch-all `[...section]` beside a sibling `page.tsx`, not `[[...section]]`: Next refuses an optional catch-all that has the same specificity as a route beside it, at both levels.

### The slot has a first frame

`@rail/loading.tsx` is the boundary that was missing. `RailSkeleton` draws the real lockup and skeletons at the heights the real rows occupy, so the arriving navigation lands on reserved geometry.

It is reached only when the **area** changes, because within an area the layout is preserved. A route with no rail renders `default.tsx`, which is synchronous, suspends nothing, and never sees it.

The two links that swap the rail — the project rail's `Settings` row and Settings' way back — are `prefetch`ed. An unwarmed swap is the difference between a fold and a wait.

### The switcher is one row, and it carries the plan

The product switcher was a bordered card three lines tall: name, repository, connection state. 110px of a 256px rail, spent saying which product you are in on a screen that also has the product's name in the breadcrumb and its navigation directly beneath. Measured at a 900px viewport, that left the section list showing **four of seven** rows, with the rest behind a scroll nobody had reason to try.

It is one row now — the mark, the name, the account's plan, a selector glyph — and all seven sections fit with room left over. The repository and the connection state moved into the panel, beside every other product's, which is where a fact you compare belongs.

The plan is a real fact: `PLAN_KEYS` is Free, Builder, Pro, and `activePlanName` resolves it from the live subscription with `getPlan` naming it. It is one subscription row, not `getBillingOverview` — a frame is not a place to pay for a page. Never a literal in the switcher, which is asserted.

Two things stayed visible rather than moving into the panel. A product with **no repository connected** keeps a dot on the trigger, because everything Vibe can do depends on that connection and "not connected" is the reason nothing is working, not a detail to be found by opening something. And a sibling product whose connection was never read renders **no line at all** rather than "No repository connected" — the switcher read is a bounded two-column query, and printing a connection state it did not check would be the product stating something it does not know.

## Consequences

- A section click costs the rail nothing. An area change costs one skeleton frame, usually none, because both crossings are prefetched.
- The 20px fold is visible for the first time. It was 12px and it was invisible — not because 12px is too small, but because the navigation it belongs to was still waiting on its own queries, so the movement had finished before anything arrived to move.
- Two layouts each compose the brand, their navigation and the foot. The alternative was a shared `@rail/layout.tsx` holding the brand and the foot, which would keep those DOM nodes across the fold — and would also read the balance and the identity on onboarding and the connect flow, which show no rail. The reads stay where they are used; the brand and the foot are identical markup either way, so the fold looks the same.
- `ADR 0105`'s claim that the lockup and the identity survive the fold as the same DOM nodes no longer holds; the `<aside>`, its width and its position still do, which is what the founder was reporting.
- `no-html-link-for-pages` stops flagging `global-error.tsx`. The rule had been reading `@rail/[...path]/page.tsx` as a page at `/app/`; with the catch-all gone the suppression is unused, and unused suppressions are themselves a lint warning, so it is removed rather than left as scenery.
- `ChevronsUpDownIcon` joins the generated set from Lucide's manifest ([ADR 0101](0101-icon-paths-come-from-lucide-the-frame-stays-vibes.md)). A single chevron says "expand"; two say "pick", and this control changes what the row names.
