# 0100 - The account level is Settings, and `/app` resolves to a product

Status: Accepted
Date: 2026-09-07

Supersedes the **account-dashboard clause** of [ADR 0046](0046-account-dashboard-and-context-swap.md). `/app` renders nothing: it decides which product to open and redirects. What was account-level chrome — the product list, the connected repositories, billing, the profile — is one Settings area with its own rail, at `/app/settings/*`.

## Context

ADR 0046 gave the account level a screen of its own, and the reasoning held for a product where the account was a place you went. Three sprints of building that screen made it clear it is not: CORE-6 removed the attention list and the activity feed from it, Sprint 0145 put the attention model back, Sprint 0146 rebuilt the whole thing as a ranked desk. Each pass made it a better answer to a question a founder was not asking.

Vibe works on **a product**. Everything that matters — the reading, the moves, the agent, the merge — is a project route. The account level had exactly one job, *pick which product*, and a full screen to do it in, which put a page between a founder and the thing they came for on every visit.

The founder's instruction was to remove it: land directly on Nova, keep products and repositories, and nest them in Settings the way Vercel does.

## Decision

### `/app` is a resolver, not a screen

It answers three cases and renders nothing in any of them:

- **No products** → onboarding, the only screen that can help.
- **Setup never finished, for anything** → resume it. The takeover ends the moment a founder has completed setup once; after that an unfinished second product is an *offer*, not a destination, or the workspace becomes unreachable for the person who least needs the flow. That offer moved to Settings → Products, which is the only surface left that shows a founder a product they have not finished.
- **Otherwise** → a product.

It carries no `loading.tsx`. A first frame there would paint a skeleton of a page nobody is going to.

### Which product: the last one, then the ranking

The attention ranking is the right answer on a first visit and the wrong one on every visit after: a founder who spent the morning in one product does not want to be sent elsewhere because something else raised a decision while they were away.

The hint is a **cookie**, written by a client effect in the project layout. That is per browser rather than per account, and a new device, a private window or cleared site data all fall back to the ranking — a correct screen rather than an error. What it buys is no schema, no write on a hot path and no request of its own.

A column on `projects` would survive devices. It would also need the write to happen on a client effect anyway: a write during a Server Component render runs on Next's *prefetch* too, so hovering a link would record a visit nobody made.

The cookie is a hint and never an authority. `resolveLastVisited` takes the ids the session owns and returns a value only if the cookie names one of them, so a forged cookie is indistinguishable from a missing one and nothing downstream has to re-check.

### The account level is one Settings area

`/app/settings` with a rail: **General, Products, Repositories, Billing, Profile**, and `Team` still named as a label rather than a link because there is no sharing primitive to expose. Four top-level rows for four settings pages made the account look like a second application; it is one area, the way this category does it.

General stopped being a grid of three cards. Two of those cards are rows in the rail beside it now, and a card that duplicates the nav item next to it is the same link twice. What is left is what belongs there and nowhere else: who this account is, the one destination that is genuinely outside Vibe (GitHub's own installations page), and the one control that cannot be undone.

### The old addresses answer

`/app/products`, `/app/repositories`, `/app/billing` and `/app/profile` redirect to their nested homes, index and anything beneath them. These are the destinations of the old rail, of `requireSession` redirects people have bookmarked after a login, and of links in the project workspace. Temporary rather than permanent, for the reason the existing table gives: a 308 settles a routing decision in caches this repository cannot edit.

A failed GitHub connection redirects to Settings → Repositories rather than to `/app`. `/app` could render a notice when it was a screen; it cannot now, and the page about GitHub access is where a founder looks after a connection did not work.

## Consequences

- The dashboard, its composition, its model and its browser contract are deleted — `account-home.tsx`, `desk.ts`, `desk-head.tsx`, `desk-row.tsx`, `dashboard-contract.test.ts`, `account-dashboard.spec.ts` and the three fixtures behind them.
- `/app` makes the same two constant-cost reads it always made and renders nothing, so it fetches strictly less than before: no shell, no credit balance, no per-project anything.
- The Settings rail is the account rail renamed and re-pointed, so the shell, the wallet and the account menu are unchanged. `AccountSection`'s segments are relative to `/app/settings` now, which `accountSectionHref` is the single place that knows.
- Two guards changed shape rather than disappearing. `loading-coverage` asserted `/app` has a first frame and now asserts it has none *and* redirects. `route-titles` gained a third exemption, because a route that renders nothing cannot name a tab.
- `ground.spec.ts` measured the ground on the dashboard fixture, which no longer exists. It measures an ordinary Settings screen instead, and its v1 assertion became a ratio: an absolute half-pixel bar failed at 1.0 on a page with cards, because a `shadow-card` bleeds past its own box and is not hit-tested. Noise cannot fake a fourfold difference; a leak cannot survive one.
- What is genuinely lost is a single place that showed every waiting decision across products. Nothing replaces it, and that is the trade the instruction makes: the ranking still orders `/app`'s fallback and Settings → Products, and a founder who wants to see another product goes there or uses the switcher.
