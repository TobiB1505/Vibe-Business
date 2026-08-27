# ADR 0058 — Security response headers, and a CSP that starts by watching

**Status:** Accepted · **Date:** 2026-08-27 · **Drives:** VB-005

## Context

Vibe served **no security headers at all**. The [2026-08-26 launch readiness audit](../audits/2026-08-26-launch-readiness/README.md) recorded it as VB-005: no CSP, no HSTS, no `nosniff`, no frame policy, no `Referrer-Policy`, no `Permissions-Policy`, and `X-Powered-By: Next.js` naming the framework to every caller.

The headers are not the interesting part — five of the six are a settled industry default and the only real decision is which values. The Content-Security-Policy is different: it is a standing constraint on what the product may ever load, and getting it wrong breaks the application for whoever hits the case its author did not think of.

That risk is not hypothetical here. Writing the policy from reading the code surfaced two loads that a by-the-book CSP would have broken, neither of which is visible from the header set:

1. **Next injects inline scripts on every page** — bootstrap and RSC payload. A `script-src` without `'unsafe-inline'` or a nonce blanks the application.
2. **Customer brand logos are plain `<img>` elements pointing at arbitrary customer-controlled URLs** (`ProductLogo`, `Avatar`, which deliberately does not use `next/image` because the origin is unknown at build time). `img-src 'self'` blanks every logo on the dashboard.

## Decision

### 1. The CSP ships report-only

The launch gate already prescribes the sequencing — *"CSP report-only ≥1 week, then enforced"* — and this ADR adopts it rather than inventing one.

A first CSP written from reading a codebase is a **guess about what a browser actually loads**. Report-only turns that guess into a measurement at no risk, because a report-only policy changes nothing a browser is willing to do.

The cost of saying this plainly: **a report-only CSP stops no attack.** It is an instrument, not a defence. Enforcement is a separate decision, and it belongs with the violation reports rather than ahead of them.

### 2. Two directives are deliberately weaker than a textbook policy

Both are recorded here and pinned by test, because a CSP whose weak points are undocumented is one nobody can tighten later.

**`script-src 'unsafe-inline'`.** The alternative is per-request nonces, which means generating one in `proxy.ts` — the file whose own comments explain how a mistake there hands one user another user's session, and the single most safety-critical file in this repository. Bundling that into the change that *first turns headers on* trades a large new risk for a policy nobody is enforcing yet. It is the natural next step, before enforcement, and not part of this change.

**`img-src https:`.** The product renders customer logos from arbitrary origins. The alternatives are to blank them or to proxy every customer logo through Vibe — a product change with its own bandwidth, caching and SSRF questions, not a header change. An image is also not a script: the exposure it carries is pixel-tracking and information leak, which `Referrer-Policy` already narrows.

### 3. Environment-derived origins narrow the policy when absent

`connect-src` needs the Supabase project and the Sentry ingest host, both of which vary per deployment and are read from `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SENTRY_DSN`.

An unset or malformed variable yields `null` and the origin is **omitted**, never replaced by a wildcard and never interpolated as `undefined`. A build without Sentry configured should refuse Sentry's origin. This is asserted directly, because "absence widens the policy" is the failure mode that would make the whole header worthless while still looking correct.

Only the origin is taken — never the path, and never the DSN's public key.

### 4. HSTS ships without `preload`

Preloading is enforced by browser vendors and removal takes months. It should be chosen deliberately once the apex domain and every subdomain are known to be HTTPS-only, not inherited as a side effect of turning headers on.

### 5. The headers are applied in `next.config.ts`, not in the proxy

`headers()` reaches every response, including routes the proxy's matcher excludes and static assets. The proxy would cover less and would put a second concern into the file that already carries the session-refresh and cache-poisoning rules.

## Consequences

- Six headers on every response; `X-Powered-By` gone.
- Nothing the application does changes. Every header is additive, and the CSP is observational.
- **Not yet achieved, and the point of the ADR:** the CSP protects nothing until it is enforced. Two follow-ups stand between here and there — read the violation reports, and decide nonces versus `'unsafe-inline'` on that evidence.
- No CSP violation *reporting endpoint* is configured, so reports currently reach the browser console and nothing else. Wiring `report-to` is part of the enforcement step, and until it exists "≥1 week of report-only" means a week of manual checking rather than a week of collected data. Named here rather than assumed.

## Alternatives considered

**Enforce immediately.** Rejected: an enforced first-guess CSP breaks production for the case the author missed, and the gate asks for the opposite order.

**Nonces now.** Rejected for sequencing, not on merit — see §2. It is the right end state.

**Skip the CSP and ship the other five headers.** Rejected: those five are the easy half, and shipping them alone would let VB-005 be marked done while the header that actually constrains an attacker was never written.
