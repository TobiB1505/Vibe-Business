# Sprint 0150 — The rail that refetched itself

**Date:** 2026-09-07
**Decision:** [ADR 0102](../decisions/0102-the-rail-is-a-layout-per-area.md)

## What was reported

Three things, six hours after the rail was rebuilt.

1. Clicking through the product shows a clear loading state and does not feel fluid. An animation for the sidebar folding over would help — Vercel does it that way.
2. The rail is very compact, and the reason is that the project button is far too big. The logo goes at the top; under it a project field like Vercel's, with the **plan** beside it, and the products selectable from it.
3. A third screenshot showed the expanded state — Vercel's team panel — with the note: not quite that large.

## What was actually wrong

(1) was not about animation, and the animation was not the fix.

[ADR 0101](../decisions/0101-one-rail-that-unfolds.md), decided that morning, put the navigation in one catch-all slot route on this reasoning: *a route boundary is a remount boundary, so one route never remounts.* True about mounting. Wrong about everything else — a **page is matched per URL**. Every section click, Nova to Plan to Agent, re-ran the rail on the server and refetched all five of its reads.

The second half was worse and is what the founder actually felt. The slot had no `loading.tsx`, so it had no Suspense boundary of its own, and the nearest ancestor is `src/app/app/layout.tsx`, which has none either. So the router could not commit **any** navigation under `/app` until the rail's queries came back. Every click in the product waited on the chrome standing beside the thing being navigated to. That is the "klarer Ladestatus" and the "nicht flüssig", exactly.

And the 12px fold had never been visible — not because 12px is too small, but because the thing it animates was still waiting on its own queries. The movement finished before anything arrived to move.

(2) was measurable. The switcher was a bordered card three lines tall — name, repository, connection state — 110px of a 256px rail. At a 900px viewport that left the section list showing **four of seven** rows; Action Plan, Agent and Experiments were behind a scroll with a fade nobody had reason to try.

## What was built

**Each area's navigation is a layout.** A layout is matched by its own segment and preserved while that segment holds, so `@rail/projects/[projectId]/layout.tsx` is read once per *product* and then stays; a section click re-renders a `null` page underneath it and nothing else runs. The active row already came from `usePathname`, so it keeps up with no server render at all. The pages under those layouts render nothing and import nothing, which is the invariant and is asserted rather than remembered.

A required catch-all beside a sibling `page.tsx`, not an optional one: Next refuses an optional catch-all with the same specificity as a route beside it, and it refuses it at both levels — once for `/app` against `[[...path]]`, once for `/app/projects/[projectId]` against `[[...section]]`.

**`@rail/loading.tsx` is the boundary that was missing.** `RailSkeleton` draws the real lockup and skeletons at the heights the real rows occupy. It is reached only when the *area* changes, because within an area the layout is preserved; a route with no rail renders `default.tsx`, which is synchronous, suspends nothing, and never sees it. Both crossings — the `Settings` row and Settings' way back — are `prefetch`ed, so in practice even that frame is skipped.

**The switcher is one row.** The mark, the name, the account's plan, a selector glyph. Measured after: all seven sections fit at 900px with room left over.

The plan is a real fact, not decoration: `PLAN_KEYS` is Free, Builder, Pro, and `activePlanName` reads the live subscription and lets `getPlan` name it — one subscription row, not `getBillingOverview`, because a frame is not a place to pay for a page. The switcher never writes a plan name; that is asserted with a quoted-literal match rather than a substring, or `Pro` would hit `ProjectSwitcher` and the test would be about nothing.

**Two things did not move into the panel.** A product with no repository connected keeps a dot on the trigger — everything Vibe does depends on that connection, so "not connected" is the reason nothing is working, not a detail to be found by opening something. And a **sibling** product whose connection was never read renders no line at all rather than "No repository connected": the switcher read is a bounded two-column query, and printing a connection state it did not check would be the product stating something it does not know. The prop is `string | null | undefined` and all three mean something different.

No search field in the panel. Vercel's has one because a team list is long; this one holds at most five products, and a filter over two rows is furniture.

## What the guards say now

Two new ones, both mutation-tested by breaking them:

- **The navigation is a layout, and the pages under it do nothing.** Giving `@rail/settings/page.tsx` an import and a render failed it, which is the exact regression that would bring the per-click refetch back.
- **The slot has a first frame.** Moving `@rail/loading.tsx` aside failed it.

And the plan badge is asserted twice: that the slot reads `activePlanName`, and that the switcher contains no plan name of its own.

## Loose ends this closed

`no-html-link-for-pages` stops flagging `global-error.tsx`'s deliberate `<a href="/app">` — the rule had been reading `@rail/[...path]/page.tsx` as a page at `/app/`, and with the catch-all gone the suppression became an unused-directive warning. Removed rather than left as scenery.

`ChevronsUpDownIcon` joins the generated set from Lucide's manifest ([ADR 0097](../decisions/0097-icon-paths-come-from-lucide-the-frame-stays-vibes.md)). A single chevron says "expand"; two say "pick", and this control changes what the row names.

## Validation

Unit 8,839 · browser 589 · lint 0/0 · typecheck clean · no migration.

What none of it proves is the thing the founder will judge: that a section click now costs the rail nothing. These are fixture routes with no client navigation between them, so the structure is what holds it — the navigation is a layout, its pages import nothing, and the slot has a boundary. All three are asserted; whether that adds up to "flüssig" is a question for the deployment.
