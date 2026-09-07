# 0147 — The screen between you and the product

**Date:** 2026-09-07
**Decision:** [ADR 0100](../decisions/0100-the-account-level-is-settings.md)

## The founder's instruction

> „radikale Änderung wir werden diese home seite komplett rausnehmen, man kommt direkt auf nova […] wir brauchen diese Dashboards etc nicht, was wir noch gebrauchen können ist products und repositories aber in Settings dann neu verschachtelt wie die vercel Sidebar"

Two decisions were put back before anything was deleted, because getting either wrong would have cost the whole change: whether the Settings sections get real nested URLs, and which product `/app` opens when several are connected. The answers were **nest for real** and **the last one visited**.

## What was removed, one sprint after building it

The account dashboard, in every form it had. CORE-6 removed its attention list and activity feed; Sprint 0145 put the attention model back beside the hero; Sprint 0146 rebuilt the whole screen as a ranked desk. Each pass made it a better answer to a question a founder was not asking.

Vibe works on **a product**. The account level had one job — pick which — and a full screen to do it in, which put a page between a founder and the thing they came for on every visit. `account-home.tsx`, `desk.ts`, `desk-head.tsx`, `desk-row.tsx`, `dashboard-contract.test.ts`, `account-dashboard.spec.ts` and three fixtures are gone.

## The cookie, and why it is not a column

"Last visited" was chosen over the attention ranking, and the obvious implementation is a column on `projects`. It is refused, and the reason is not the migration:

**A write during a Server Component render runs on Next's prefetch.** Hovering a link to a product would record a visit nobody made, and the failure is silent and correct-looking. The write has to happen in a client effect either way — at which point a cookie written by that effect needs no schema, no round trip and no read model.

What it costs is stated rather than hidden: the memory is per browser. A new device, a private window or cleared site data all fall back to the ranking, which is a correct screen.

**The cookie is a hint and never an authority.** `resolveLastVisited` takes the ids the session owns and returns a value only if the cookie names one of them, so a forged cookie is indistinguishable from a missing one and nothing downstream has to re-check. That is one of six assertions in `last-visited.test.ts`, beside the one that catches a cookie written without `path=/` — which would belong to the route that wrote it and be invisible to `/app`, a bug that looks exactly like the feature not existing.

## What the move cost, and what it caught

Four sections moved to `/app/settings/*` with `git mv`, twenty-nine files were repointed, and the old addresses redirect — index and everything beneath. Ten unit tests failed, and every one of them was a real reference rather than a rename:

- `service-boundary.test.ts` and `identity-boundary.test.ts` name exact files in their allowlists. A moved file silently leaves an allowlist naming nothing, which is how a reviewed exception becomes an unreviewed one.
- `design-tokens.test.ts` counts glyph exceptions per file.
- `calibration.test.ts` binds a dogfood fixture to a surface that must exist, and said so: *"the class would be right and the work impossible"*.
- `documentation-currency.test.ts` holds a retired claim keyed on a path.
- `loading-coverage.test.ts` asserted `/app` has a first frame. It now asserts it has **none** and redirects — a skeleton there would paint a page nobody is going to.
- `route-titles.test.ts` gained a third exemption: a route that renders nothing cannot name a tab.

Two things that would have been lost silently were caught and rehomed rather than dropped:

- **The unfinished-setup offer.** A founder who finished setup once and started a second product had that offer on the dashboard. `/app` deliberately stops taking them there, so with the dashboard gone the flow was reachable only by URL. It is on Settings → Products now, which is the only surface left that shows a founder a product they have not finished.
- **The failed-connection message.** The GitHub callback redirected to `/app` and it rendered a notice. `/app` is a redirect, so the message would have been swallowed on the way to a product. It goes to Settings → Repositories, which is the page about GitHub access and already carries the control to try again.

## The ground test moved, and its claim got stronger

`ground.spec.ts` measured luminance on the dashboard fixture. Pointed at an ordinary Settings screen, its v1 half-pixel flatness bar failed at 1.0 — not a leak, but a `shadow-card` bleeding past its own box in a column `elementFromPoint` reports as page background. So the claim became the ratio between the palettes: v1's variation must be under a quarter of v2's. Noise cannot fake that; a leak cannot survive it.

## The credit coin, in the same sprint

The coin sat high in the pill, and the cause was upstream of the pill. The correction was `-0.06em`, described as "half a typical descender depth" — a guess about a *face*, and this product loads two. Measured on the rail at 13px, the same constant put the coin **0.47px low in the first palette and 0.53px high in the second**.

It is placed from the font's own metric now: the row aligns on the baseline, the wrapper's bottom edge sits on it, and the coin is pushed down by half its height minus half a `cap`. Measured in decoded pixels afterwards: 0.08px at 16px, 0.17px at 13px.

The guard claimed it checked "more than one size" and did not — every composition on the study drew the default, so the em constant was verified at 16px and nowhere else. The study renders all three sizes now, the spec runs in both palettes, and it fails on the old constant in each.

Unit 8,814 · browser 582 · lint 0/0.
