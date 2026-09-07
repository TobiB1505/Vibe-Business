# 0101 - One rail, unfolded by a parallel route

Status: Accepted
Date: 2026-09-07

Supersedes the **two-rails clause** of [ADR 0046](0046-account-dashboard-and-context-swap.md) and the **scroll-model clause** of [ADR 0051](0051-project-shell-context-ownership.md). There is one `<aside>` in the signed-in product. It is rendered by the layout every `/app` route shares, it is one width, it never scrolls, and what changes between a product and Settings is the navigation inside it.

## Context

ADR 0046 made the two rails "mutually exclusive by construction": the account pages lived in a `(account)` route group with its own layout, `projects/[projectId]` sat outside it with its own. That is a correct way to guarantee only one renders. It also guarantees that moving between them **unmounts a whole rail and mounts another** — the two are in different branches of the route tree, so there is nothing for React to keep.

The two had also drifted to different widths: 256px in the project layout, 280px in the account one. Nothing enforced otherwise, because there was no shared thing to enforce it on.

The founder's report was about exactly this and was about pixels: clicking Settings made the navigation *wider* and visibly rebuilt it, and clicking back out reloaded the whole page onto Nova. What Vercel does instead — the reference given, with screenshots — is keep one sidebar that stays the same size and simply unfolds in place into the settings sub-nav, landing on General, with the content column following.

"Back to your product" made it worse in a way that had nothing to do with rendering: it pointed at `/app`, which is a resolver that redirects (ADR 0100), so leaving Settings cost a server round trip before anything could paint.

## Decision

### The `<aside>` belongs to `src/app/app/layout.tsx`

That layout is the only ancestor both areas share, so it is the only place an element can be rendered from and survive the move. `AppFrame` renders it, and nothing else in the codebase renders one — the width, the chrome material, the sticky positioning and the scroll model are properties of the frame rather than of either area. The 256/280 disagreement is not fixed; it is unrepresentable.

A route with no navigation — onboarding, the GitHub connect flow, the internal console, `/app` itself — renders nothing into the slot, and the empty `<aside>` is hidden by `empty:hidden`. A layout cannot ask what its slot produced, so the absence is expressed where it is knowable. A conditional would need the layout to know the route, which is the coupling this shape removes.

### The navigation is a parallel route, and there is exactly one of them

`@rail/[...path]/page.tsx` matches every address under `/app` and returns the navigation for whichever area that address belongs to. One route rather than one per area, because **a route boundary is a remount boundary**: a slot route per area would rebuild the navigation every time a founder moved between sections of their own product.

It is a required catch-all, not an optional one — `[[...path]]` has the same specificity as `/app` and Next refuses the pair. `/app` needs no rail anyway and takes `default.tsx`.

The lockup and the identity are composed by that route, above and below the navigation, so React keeps *the same DOM nodes* across the fold. Rendered by each area instead they would be two identical copies, and "identical" stops being true the first time somebody edits one of them. It is also one read each rather than two: the balance and the GitHub identity are account-scoped and say the same thing in both areas.

Between them, only the navigation is replaced, and it animates the short distance it conceptually travelled — in from the right entering Settings, from the left coming back.

### One scroll model, and the list is what runs out of room

The account surface scrolled the document; the workspace scrolled a column inside itself. One rail cannot sit in two scroll models. The document scrolls and the rail is `sticky top-0 h-dvh`, which is the model that leaves anchors, `scroll-mt` and browser scroll restoration working everywhere.

The rail itself is not a scroller. The lockup stays at the top and the identity stays at the bottom; only the section list between them scrolls, with a mask at its foot so a clipped row reads as a list continuing rather than a rendering fault. Before this the whole `<aside>` scrolled, so a product with seven sections pushed its own footer 22px below where Settings put it — a small number that lands on the exact thing the fold is trying to keep still.

The scroller is deliberately not wrapped around the project switcher: an overflow container is a clipping container, and the switcher's panel is absolutely positioned.

### The way back names a product

Settings' back row points at `/app/projects/<id>` and says "Back to *Acme*", resolved from the same `vibe-last-project` cookie `/app` would have read. The row is read under RLS, so a cookie naming somebody else's project resolves to nothing and the generic `/app` destination stands — still correct, and only in the case where there is nothing better to point at.

### Two rows that offered the products index from inside it

`View all products` in the switcher and `All products` in the rail are both gone. The switcher panel **is** the list of products — open, with the products in it and a tick beside the current one — so a row offering to go and look at them elsewhere offered the founder the thing they were already looking at. Settings → Products remains the complete inventory and is a rail row there.

What is left in the project rail is the way *out* of the project context, under the label `General` rather than `Account`: `/app/settings` is General, so the founder is told where the fold arrives before the click rather than after it.

## Consequences

- **Easier.** The rail cannot be resized, restyled or duplicated by one area, because neither area has one. Adding a section to either navigation is a change to a list. `RailFooter` is the single wearer of the balance and the identity, so the two states of the fold cannot acquire different feet.
- **Harder.** The frame is now three files where it was two: the layout renders the box, the slot composes the parts that do not change, and each area contributes its navigation. A reader looking for "where is the sidebar" has one more hop, which is the price of it outliving the route.
- The project layout no longer loads the navigation counts, the Agent status, the sibling products, the identity or the balance — the rail does. The project row itself is shared through `getProjectFrameContext`, a `cache()`d read with **positional** arguments, because `cache()` compares each argument with `Object.is` and an options object would miss on every call while looking exactly like it worked. The move cost no extra query, and `workspace-routes.test.ts` now holds the cost contract against both halves of the frame.
- Two route-enumeration guards learned that a slot is not a route. `route-titles` skips `@`-prefixed directories — metadata exported from a slot merges into the page's, which is how a rail ends up renaming the screen beside it — and `loading-coverage` skips them because the route a click navigated to is what a founder waits for.
- `no-html-link-for-pages` began flagging `global-error.tsx`, which uses `<a href="/app">` deliberately: the router is what failed, and `Link` would ask the broken thing to navigate. The rule reads `@rail/[...path]/page.tsx` as a page at `/app/`. It is suppressed on that line with the reason, rather than the rule being weakened.
- What a browser can prove, `rail-fold.spec.ts` proves: the rail is the same box and the same height in both areas, the lockup and the identity land on the same pixel, the column beside it starts at the same height, the list is what scrolls when a 700px viewport runs out of room, and a route with no navigation reserves no width at all. What it cannot prove is that the element survives the navigation as the same DOM node — these are fixture routes with no client navigation between them — and that property is structural: the `<aside>` is in `AppFrame` and in nothing else, which `rail-switch.test.ts` holds.
