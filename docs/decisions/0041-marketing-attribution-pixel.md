# ADR 0041 — The Meta Pixel, and the two boundaries it runs inside

**Status:** Accepted
**Date:** 2026-08-23

## Context

Vibe Business advertises. An ad platform can only report which campaigns produced visits and sign-ups if the destination site tells it about the visits, which for Meta means their published pixel snippet.

That snippet is a third-party tag: it loads `fbevents.js` from `connect.facebook.net`, runs in every visitor's browser, and reports the URL of each page view to Meta. Three things about this repository make "paste it into the root layout" the wrong version of that:

1. **Rule 3** — a third-party provider is not introduced silently, which is why this record exists.
2. **The authenticated surface carries identifiers.** Paths under `/app` contain project ids. Meta receives the page URL of every view reported to it, so a pixel mounted globally would hand an advertising network a stream of internal identifiers alongside the visit, for no advertising benefit — the conversion being measured is a public-page visit and a sign-up, both of which happen before `/app`.
3. **Preview deployments are real browsers.** Every branch deployment and every local `next dev` would otherwise report page views nobody made into the ad account that decides where money goes.

`@vercel/analytics` and `@vercel/speed-insights`, already in the root layout, are Vibe's *product* analytics and are unaffected by this decision. They answer "how is the product used"; the pixel answers "which ad produced this visitor". Different questions, different vendors, different scope.

## Decision

Run Meta's published pixel snippet, unmodified apart from the id, inside two boundaries enforced in code rather than in configuration:

- **Production only.** The root layout renders the tag only when `isMetaPixelEnabled()` — `getAppEnvironment() === "production"`, the same tier resolution `src/lib/env/app-url.ts` already owns. Because the gate is evaluated in a server component, a Preview or development deployment ships no Meta script at all, rather than shipping one that decides at runtime not to fire. Verifying a pixel before it is live is what Meta's Test Events tool is for.
- **Public pages only.** The tag is not rendered on `/app` or anything beneath it. Absent, not silenced: there is no code path on the authenticated surface that could report a URL.

Supporting details:

- The pixel id (`1054822680793362`) is a constant in `src/lib/analytics/meta-pixel.ts`, not an environment variable. It is public by nature — visible in the page source of every site running one — identifies a destination exactly as a Sentry DSN does, authorises nothing, and does not vary by deployment. It is nonetheless validated as 10–20 digits before being interpolated, because it lands in inline script text.
- Client-side navigations re-report `PageView` from `MetaPixel`'s effect. A script tag observes only the load that ran it, so an App Router site shipping the raw snippet would report the first page of each visit and nothing after it.
- Only `PageView` is sent. No `Lead`, `CompleteRegistration`, `Purchase`, no Conversions API, no advanced matching, and no user data of any kind is passed to `fbq`.
- The privacy notice names Meta in the services list and states what the pixel sees, per rule 83.

## Consequences

**Good**

- Campaign spend can be attributed to visits and to the sign-up page, which is the whole point of running ads.
- The identifiers in Vibe's authenticated paths never reach an advertising network, and the exclusion is a structural property of where the component renders rather than a rule someone must remember.
- Ad reporting is not polluted by CI, local development, or branch deployments.
- Removal is one component and one gate: nothing else in the codebase knows the pixel exists.

**Bad / risks**

- A third party now runs script in visitors' browsers on public pages. That is inherent to the mechanism, not to this implementation, and it is why the tag is confined to pages that hold nothing but marketing copy and auth forms.
- No consent banner exists. Vibe has no cookie-consent mechanism today, and this decision does not add one; the privacy notice already carries a list of legal items still to be settled before public launch, and consent for advertising cookies in jurisdictions requiring it belongs on that list.
- A future conversion event (`Lead` on sign-up, say) would need its own decision, because the useful place to fire one is at the boundary this ADR deliberately closed.

**Neutral**

- `PageView` counts differ slightly from Vercel Analytics' page views by construction: this pixel sees production public pages only.
