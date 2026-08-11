# ADR 0012 — Authenticated browser analysis and ephemeral authentication state

**Status:** Accepted
**Date:** 2026-08-11
**Supersedes / amends:** none. Complements [ADR 0010](0010-safe-outbound-http-inspection.md) (public, anonymous, static HTTP inspection) rather than replacing it.

## Context

Public Live Product Intelligence ([Sprint 3](../sprints/0003-live-product-intelligence.md)) is anonymous and static: it fetches HTML over a guarded HTTP boundary and never executes JavaScript. That is the right design for a public website, and it produced a real, known limitation on our own product:

```
GET /            200
GET /app         302 → /login      ← analysis stops here
```

Everything behind the login is invisible. For a product whose entire value is "understand this product", the application itself — dashboard, onboarding, settings — is the part that matters most, and it is exactly the part we could not see. `/app` was also not discovered by crawling, because nothing public links to it; it surfaced only from repository route evidence.

Three ways to see an authenticated application:

1. **Ask for the user's password** and log in on their behalf.
2. **Ask for a session cookie / token** and replay it.
3. **Let the user log in themselves**, in a browser we can then inspect.

## Decision

**Option 3.** A temporary remote browser is opened for the user, the user authenticates in it directly, and Vibe then inspects that same already-authenticated session. Afterwards the browser is destroyed.

**Authentication material is ephemeral and provider-session-bound. Vibe does not persist reusable authenticated browser state in V0.1.**

Concretely:

- No password fields, no credential vault, no password column, no automatic login, no password replay, no OAuth token extraction, no cookie paste UI.
- No Browserbase persistent Context; no `storageState()`; no `context.cookies()`; no cookie, token, or header persistence anywhere.
- Sessions are created with `recordSession: false` and `logSession: false`, both **explicitly** — the SDK defaults are `true`.
- The analysis phase is read-only: mutating HTTP methods are refused, downloads are cancelled, off-origin top-level navigation is blocked, and the analyzer never clicks, types, or submits anything.
- Browserbase sits behind a four-verb `BrowserSessionProvider` port so the provider does not become domain logic.

Refreshing the analysis therefore requires logging in again. That is the accepted cost.

## Why not store the session

Storing a session cookie or `storageState` would make refresh frictionless, and it is the obvious next feature request. We are declining it in V0.1 because of what the stored artefact *is*: a bearer credential for someone's production application, held by us, usable without their presence, for as long as it remains valid.

That changes Vibe's threat model fundamentally. A database leak stops being "derived intelligence about products" and becomes "live access to customers' applications". It also changes what we would have to promise and audit — encryption at rest with a separate key, rotation, revocation, per-session scoping, and a credible answer to "what did Vibe do in my app last Tuesday".

The honest statement we can make today — *"Vibe does not store your password, and the temporary browser is destroyed after the analysis"* — is worth more than the convenience, and it is a promise the code structurally keeps rather than merely intends. If persistent sessions are ever needed, they need their own ADR, their own encryption design, and their own consent flow.

## Why the human logs in

Manual login is not a limitation we tolerated; it is the mechanism that makes the rest sound.

- **MFA, OAuth and CAPTCHA are the user's to complete**, so we need no automation for any of them — which is why `solveCaptchas` is off and no AI agent participates.
- **We never see the credentials.** Keystrokes go from the user's browser to the remote browser to the target site. Vibe's runtime is not in that path and captures nothing.
- **Consent is explicit and situated.** The user is present, watching the browser, at the moment access is granted.

The provider necessarily processes the browser interaction — that is unavoidable for any remote-browser design, and it is why recording and logging are disabled rather than left at their defaults.

## Why not route all live analysis through a browser

It would be simpler to have one crawler. We deliberately keep two:

| | Public | Authenticated |
|---|---|---|
| Identity | anonymous | user's own session |
| Transport | static HTTP via safe-fetch (ADR 0010) | remote browser over CDP |
| JavaScript | never executed | executed, in the provider's sandbox |
| Cost | fractions of a cent | provider browser-seconds |
| Trigger | automatic | explicit, optional, per analysis |

Routing the public crawl through Browserbase would make a cheap deterministic feature expensive and would put JavaScript execution in the path of every project. The public path must stay anonymous, static, and SSRF-guarded.

## Consequences

**Accepted:**

- A remote-browser provider is now a hard dependency of one optional feature. If Browserbase is unavailable, authenticated analysis is unavailable; nothing else degrades.
- Re-analysis requires a fresh login.
- Blocking mutating requests can leave applications that hydrate over POST partially rendered. The snapshot says so (`application_requires_mutating_method_for_render`) instead of pretending completeness.
- Some authenticated routes will remain undiscovered, because we refuse to guess paths.
- Provider cost is variable and per-second, unlike token cost. It is measured separately and never merged into Anthropic token accounting.

**Required by this decision:**

- JavaScript from a customer's application executes only inside the provider's browser — never in Vibe's Node, Vercel, or Supabase runtimes.
- Page content remains untrusted **data**, never instructions (CLAUDE.md rule 25, 36), and no model participates in navigation.
- Live-view and CDP connect URLs are treated as short-lived capability URLs: fetched server-side per use after ownership verification, returned to the owner at most, and never persisted, logged, or placed in audit metadata.
