# Sprint 0149 — The two rails that were one

**Date:** 2026-09-07
**Decision:** [ADR 0101](../decisions/0101-one-rail-that-unfolds.md)

## What was reported

Four things, in the founder's order, with the last one marked as the important one.

1. `View all products` out of the project switcher.
2. `All products` out of the project rail — *"das macht auch wirklich 'n Sinn"*.
3. The rail's account section should say `General`, not `Account`.
4. *"Und das Allerwichtigste"*: clicking Settings reloads the page and the sidebar gets **wider** and is visibly rebuilt; clicking back reloads the whole page onto Nova. Two Vercel screenshots were attached. What Vercel does is keep one sidebar that stays the same size and unfolds in place into the settings sub-nav, landing on General, with the content column following — *"man zieht praktisch nur die Sidebar und der rechts geht praktisch mit"*.

## What was actually wrong

Every part of (4) was literally true and none of it was a rendering bug.

`/app/settings/*` rendered `AccountShell` from `(account)/layout.tsx`. `/app/projects/*` rendered `ProjectShell` from `projects/[projectId]/layout.tsx`. Different branches of the route tree, which [ADR 0046](../decisions/0046-account-dashboard-and-context-swap.md) chose deliberately so the two rails would be "mutually exclusive by construction" — and which, for exactly the same reason, means React has nothing to keep when a founder moves between them. The whole `<aside>` was unmounted and a different one mounted.

The widths were `lg:w-64` and `lg:w-[17.5rem]`. 256 against 280. Nothing enforced otherwise because there was no shared thing to enforce it on.

And "Back to your product" pointed at `/app`, which since [ADR 0100](../decisions/0100-the-account-level-is-settings.md) is a resolver that redirects — so leaving Settings cost a server round trip before anything could paint. That is not a perception of a reload; it is one.

## What was built

The `<aside>` moved to `src/app/app/layout.tsx`, the only ancestor both areas share. Its width, its chrome material, its sticky positioning and its scroll model are properties of `AppFrame` now, and no other file in the repository renders one. The 256/280 disagreement is not fixed, it is unrepresentable.

The navigation became a parallel route: `@rail/[...path]/page.tsx`. **One** route matching every address under `/app`, not one per area — a route boundary is a remount boundary, and a slot per area would rebuild the navigation every time a founder moved between sections of their own product. The first attempt used `@rail/projects/[projectId]/[[...section]]` and `@rail/settings/[[...section]]`, and Next refused the build outright: *"You cannot define a route with the same specificity as an optional catch-all route."* The catch-all is required rather than optional for the same reason one level up — `[[...path]]` collides with `/app` itself, which needs no rail and takes `default.tsx`.

The lockup and the identity are composed by that route, above and below whichever navigation it returns, so React keeps **the same DOM nodes** through the fold. Rendered by each area they would be two identical copies, and identical is a property that stops holding the first time somebody edits one of them. It is also one read each rather than two: the balance and the GitHub identity are account-scoped and say the same thing in both areas.

A route with no navigation returns `null` and the empty `<aside>` is hidden by `empty:hidden`. A layout cannot ask what its slot produced, so the absence is expressed where it is knowable. Verified two ways: `.empty\:hidden:empty` beats `.flex` on specificity *and* order in the built stylesheet, and a fixture renders the frame with a null rail so a browser says the column starts at x=0.

## Three things measurement changed

**The scroll model had to be picked, not merged.** The account surface scrolled the document; the workspace scrolled a column inside itself with `lg:h-dvh lg:overflow-hidden` on the frame. One rail cannot sit in two, and the frame is now shared — so a rail-less route like onboarding would have inherited whichever was chosen. `overflow-hidden` on a container with no inner scroller clips a page. The document scrolls and the rail is `sticky top-0 h-dvh`, which is what the account surface already did and what leaves anchors, `scroll-mt` and scroll restoration working. Nothing in the workspace depended on the inner scroller: the only `sticky` in the project routes is a comment about a header that no longer exists.

**The footer moved 22px and the guard was right.** With the rail as one scroller, the product rail measured `scrollHeight` 922 against a 900px viewport — seven sections, a switcher and the palette control — so its identity sat 22.375px below where Settings put it. A number that small, landing on the exact thing the fold is trying to keep still. The lockup and the identity are pinned now and only the list scrolls, with a mask at its foot so a clipped row reads as a list continuing rather than a rendering fault. The mask is unconditional and still only ever visible when it is true: the region fills the space left over, so a list that fits ends above the fading band.

The scroller is deliberately **not** wrapped around the project switcher. An overflow container is a clipping container and the switcher's panel is absolutely positioned.

**Two of my own guards did not discriminate.** The first version of the "identity stays at the foot" test passed under a mutation that put the whole rail back into one scroller — because `min-h-0 flex-1` on the navigation already pins the footer *at rest*, and the difference only shows once somebody scrolls. The second version asserted `scrollHeight > clientHeight` on the rail and also passed, because a flex child with `min-h-0` shrinks and its overflow does not extend the parent's scroll height. What discriminates is the pair the design actually rests on: the rail's computed `overflow-y` is `hidden`, and at 700px the list region's is `auto` and it genuinely overflows. Both mutations then failed.

## The other three

`View all products` and `All products` are deleted. The switcher panel **is** the list of products — open, with the products in it and a tick beside the current one — so a row offering to go and look at them somewhere else was offering the founder the thing they were already looking at. Settings → Products remains the complete inventory and is a rail row there.

The section label is `General`. `Account` was my choice in Sprint 0148 over the founder's own word, and it names an area rather than the row the click arrives on: `/app/settings` **is** General. A chevron was added to the row, because it does not open a page inside this navigation — it unfolds the rail into the other one.

The way back names a product. `Back to Acme`, `/app/projects/<id>`, resolved from the same `vibe-last-project` cookie `/app` would have read, under RLS so a cookie naming somebody else's project resolves to nothing and the generic destination stands.

## What this cost elsewhere

Ten call sites, none of them surprising, and one that was.

The project layout stopped loading the counts, the Agent status, the siblings, the identity and the balance — the rail loads them. It still needs the project's name for the breadcrumb, and so does the rail, so `getProjectFrameContext` is a `cache()`d read shared by both. Its arguments are **positional**: `cache()` compares each argument with `Object.is`, so an options object is a fresh reference every call and would miss the cache on every lookup while looking exactly like it worked. `workspace-routes.test.ts` holds the cost contract against both halves of the frame now, or half of it would sit outside the boundary that keeps it cheap.

Two route-enumeration guards learned that a slot is not a route. `route-titles` skips `@`-prefixed directories — metadata exported from a slot merges into the page's, which is how a rail ends up renaming the screen beside it — and `loading-coverage` skips them because what a founder waits for is the route they clicked.

The surprise: `@next/next/no-html-link-for-pages` started flagging `global-error.tsx`, which uses `<a href="/app">` on purpose — the router is what failed, and `Link` would ask the broken thing to navigate. The rule reads `@rail/[...path]/page.tsx` as a page at `/app/`. Confirmed by moving the slot directory aside and watching the error disappear. Suppressed on that one line with the reason written next to it, rather than turning the rule down.

## Validation

Unit 8,833 · browser 589 · lint 0/0 · typecheck clean · no migration.

`rail-fold.spec.ts` is new and measures what a founder sees: the rail is the same box, the same width and the same height in both areas; the lockup and the identity land on the same pixel; the column beside it starts at the same height, because `--shell-top` is one number both columns pad with; at 700px the list is what scrolls and the identity is still on screen; a route with no navigation reserves no width; and Settings' way back is a `/app/projects/…` address rather than a redirect.

What it does not prove is that the `<aside>` survives a navigation as the same DOM node. These are fixture routes and there is no client navigation between them. That property is structural — the element is in `AppFrame` and in nothing else, `rail-switch.test.ts` holds that, and it now also holds that neither area declares a rail width, renders its own lockup, or composes its own balance.
