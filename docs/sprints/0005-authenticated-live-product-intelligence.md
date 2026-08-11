# Sprint 5 — Authenticated Live Product Intelligence

**Status:** in progress — analysis engine, entitlement policy and schema complete and tested; session lifecycle, UI, and audit integration outstanding (see [Delivery status](#delivery-status)).
**Branch:** `feat/authenticated-live-product-intelligence`
**Decision record:** [ADR 0012](../decisions/0012-authenticated-browser-analysis.md)

## Goal

Vibe understands a repository and a public website. This sprint adds an **optional third evidence source**: the authenticated application.

```
Repository Intelligence          Ready
Public Product Intelligence      Ready
Authenticated Product Intelligence   ← new, optional
```

The goal is not to bypass authentication. The user authenticates manually inside a temporary remote browser; Vibe then inspects that already-authenticated session and destroys it.

## The known public-analysis limitation

Sprint 3's crawler is anonymous and static, so on our own product it stopped here:

```
GET /       200
GET /app    302 → /login
```

Two separate problems:

1. **`/app` was not discoverable.** Nothing public links to it. A crawler following links never finds it. It appeared only in Repository Intelligence's route list, derived from the file tree.
2. **`/app` was not analysable.** Anonymously it serves a redirect, so there was nothing to inspect.

This sprint fixes (2) and reuses the answer to (1) rather than papering over it: **the public crawler's behaviour is unchanged.** It still reports `/app → /login`, which is the truthful anonymous result, and that redirect is now itself treated as *evidence that a protected surface exists*.

## Deep Scan — product policy

User-facing name: **Deep Scan** ("Vibe can analyze what users experience after they sign in"). Internal name stays Authenticated Product Intelligence. The provider is never the feature name — no "Browserbase Scan", no "Authenticated Crawler Session".

**Each project receives one included successful Deep Scan. Additional Deep Scans are credit-gated** (PRODUCT.md §12.1).

| | Consumes the included scan? |
|---|---|
| Snapshot successfully persisted, run completed | **yes** |
| Browser session merely created | no |
| Analysis failed | no |
| Session cancelled | no |
| Session expired before analysis | no |
| Authenticated origin never reached | no |
| Browserbase unavailable | no |
| Our own persistence failed | no |

Consumption is **derived, not flagged**: a completed snapshot with `access_mode = 'included_first_scan'` is the proof, and a partial unique index makes a second one impossible. There is no boolean that could drift into claiming the free scan was used while no usable snapshot exists.

`authorizeDeepScan()` is a pure decision function holding no Browserbase knowledge, and the browser service holds no pricing knowledge — so Credits can later add an access mode without touching orchestration. **`credits_required` is evaluated before any provider work begins**, so we never pay for a session and only then discover the user could not run the scan.

Abuse limits are centralized in `START_ATTEMPT_LIMITS`: one live session per project, 5 starts per hour, a 2-minute cooldown after an abandoned attempt — and provider failures deliberately do **not** count toward the limit, because an outage is our problem, not the user's quota.

## Threat model

Authenticated analysis is the most sensitive thing Vibe does: it operates inside a live application, logged in as the owner, on pages containing real customer data.

| Risk | Mitigation |
|---|---|
| Vibe learns the user's password | Credentials go user → remote browser → target site. Vibe's runtime is not in that path; no field, column, or log exists for them. |
| A stored session becomes a bearer credential for a customer's app | Nothing is stored: no cookies, no `storageState`, no persistent Context, no tokens. State dies with the session (ADR 0012). |
| A recording of the login is retained by the provider | `recordSession: false` and `logSession: false`, set explicitly — the SDK defaults both to `true`. Asserted by tests. |
| Analysis changes or deletes customer data | Mutating HTTP methods refused; no clicking, typing, or form submission; `logout` and destructive-looking paths never visited. |
| Analysis wanders onto third-party sites while logged in | Top-level navigation confined to the configured origin; OAuth tabs are ignored, never read. |
| Customer records land in our database | Structural extraction only — "table present", never row contents. Sanitization is a separate gate with no field for raw content. |
| A hostile page attacks Vibe | Its JavaScript executes only in the provider's browser, never in Vibe's runtime. Extraction output is treated as untrusted input and re-validated. |
| A capability URL leaks | Live-view and CDP URLs are fetched per use after ownership checks, never persisted, logged, or put in audit metadata. |

## Architecture

```
Project page
  → start session (server action)
      → BrowserSessionProvider.createSession()      [Browserbase adapter]
      → authenticated_browser_sessions row (status: waiting_for_login)
  → user logs in manually in the embedded Live View
  → "I'm logged in — Analyze"
      → BrowserSessionProvider.getLiveView() is no longer needed
      → connectReadOnly(connectUrl, origin)          [Playwright over CDP]
          → attachReadOnlyGuards(context, origin)
      → analyzeAuthenticatedProduct(...)
      → authenticated_product_intelligence_snapshots row
      → terminateSession()  (always: success, failure, cancel, expiry)
```

`BrowserSessionProvider` has four verbs — `createSession`, `getLiveView`, `connect`, `terminateSession` — so Browserbase stays infrastructure. There is no multi-provider routing and no second adapter.

## Manual-login model

1. The user clicks **Analyze authenticated app**.
2. A temporary browser opens, navigated to the project's configured production origin (or an evidence-backed application route — never a guessed sensitive path).
3. The user signs in **in that browser**, completing MFA, OAuth, or a CAPTCHA themselves.
4. The user clicks **I'm logged in — Analyze**.
5. Vibe connects to the *existing* session, verifies a tab is on the configured origin, and switches to read-only analysis.

If no same-origin authenticated page is found, the result is `authenticated_origin_not_reached` and the user stays in the login step while the session is still valid.

## Session lifecycle

```
created → waiting_for_login → analyzing → completed
                                       ↘ failed
                            ↘ cancelled
                            ↘ expired
```

Every session belongs to a user (via project ownership) and a project. Termination is attempted on **completion, failure, cancellation and expiry**; the provider's own `timeout` is set on every session as an independent backstop, so an abandoned browser ends even if our cleanup never runs. There is no background queue — cleanup is opportunistic plus provider-side timeout, by design.

**`keepAlive: true` is required, and the first version of this adapter had it wrong.** The manual-login flow spans two server requests with a human in between: create the session, then reconnect after the user has signed in through the Live View. With `keepAlive: false` the provider may end the session when the first request's connection drops, so the reconnect finds nothing and every scan fails. `keepAlive` is *session continuity, not persistent authentication* — it stores nothing, and it makes the explicit short `timeout` and `REQUEST_RELEASE` on every terminal path load-bearing rather than incidental.

A partial unique index allows at most one live session per project, so a double-click cannot start two remote browsers.

## No-persistent-auth decision

See [ADR 0012](../decisions/0012-authenticated-browser-analysis.md). Summary: **authentication material is ephemeral and provider-session-bound.** No persistent Context, no `storageState()`, no `context.cookies()`. Refresh requires re-login, and that is the accepted cost of not holding bearer credentials for customers' production applications.

## Recording policy

`recordSession: false`, `logSession: false`, `solveCaptchas: false`, no `context`, **`keepAlive: true`**, explicit short `timeout`. Live View remains available — it is a live interactive stream, not a stored artefact. Recording is never enabled for debugging, and no screenshot of any authenticated page is captured or stored.

## Read-only analysis policy

| Behaviour | Policy |
|---|---|
| `GET` / `HEAD` / `OPTIONS` | allowed |
| `POST` / `PUT` / `PATCH` / `DELETE` / anything else | **refused**, counted, reported |
| Top-level navigation off-origin | **refused**, counted, reported |
| Third-party subresources (fonts, images) | allowed — they cannot mutate the product, and blocking them breaks rendering for no safety gain |
| Downloads | cancelled; contents never read |
| Uploads / file choosers | never set; a chooser is dismissed with an empty list |
| Camera, microphone, geolocation, notifications, clipboard | revoked for the whole context |
| Dialogs | dismissed, never accepted (accepting a `confirm()` could approve a destructive action) |
| Clicking, typing, filling, submitting | never — navigation is `page.goto()` to validated paths only |

**The POST caveat, stated rather than hidden:** applications that hydrate via GraphQL, server actions, or tRPC batching use POST for reads. Blocking those can leave a page partly rendered. We block anyway and emit `non_get_request_blocked` plus `application_requires_mutating_method_for_render`, downgrading the snapshot to `partial`. Safety beats completeness, and mutation protection is never relaxed to make our own dogfood look better.

## Route discovery

The public crawler missed `/app` because it was unlinked. The wrong fix is a dictionary of guesses (`/admin`, `/internal`, `/secrets`) — that probes surfaces we have no reason to believe exist, inside someone else's application, while logged in as them.

Instead every candidate carries the evidence that justifies it:

| Source | Evidence |
|---|---|
| `landing` | the page the user was on when they confirmed login |
| `public_protected_redirect` | a path the public crawl saw redirect to a login surface — **this is the `/app` case** |
| `repository_route` | a non-dynamic `page` route enumerated from the file tree by Repository Intelligence |
| `authenticated_link` | a same-origin link visible in the authenticated UI |

No evidence means no candidate. Dynamic routes (`/project/[id]`) are dropped — we have no id, and inventing one could address a real customer's record. `api` and `layout` routes are not user-visible surfaces. Product-critical paths (dashboard, onboarding, workspace, settings, billing, analytics) are *ordered* first, never *invented*.

## Data minimization

Retained: path, title, main heading, navigation labels, action labels, form counts and input **types**, table presence, empty-state presence and short labels, detected surfaces.

Never retained: raw DOM, HTML, scripts, stylesheets, full body text, screenshots, field values, hidden fields, tokens, cookies, or storage. The in-page script never reads `.value` and never selects `input[type=password]`; sanitization then re-validates everything, because the page's own JavaScript runs in the same browser.

Structure, not records: *"data table present"*, not the rows; *"project workspace detected"*, not the customer's project names or revenue figures.

## Snapshot model

`authenticated-product-intelligence.v1`, analyzer `authenticated-product-analyzer-v1`:

```
source · session · crawl · pages · productSurfaces · navigation
applicationSignals · metrics · completeness · warnings
```

Evidence ids follow `auth.surface.*`, `auth.navigation.*`, `auth.feature.*`. Confidence is `high | medium | low` only. No business recommendations — this layer is diagnostic, like the other two.

## Business Audit integration

Planned, not yet implemented (see [Delivery status](#delivery-status)).

The audit **must keep working without** a Deep Scan — Repository Intelligence + Public Product Intelligence + Business Context remain sufficient. When an authenticated snapshot exists, it becomes additional evidence, which requires a new evidence-pack version (`business-evidence.v2`) rather than a silent change to `v1`, and a new successful Deep Scan must produce a new audit input identity.

When authenticated surfaces are detected and no Deep Scan exists, the audit shows a quality notice — *"Vibe has not analyzed your signed-in product experience yet. Your audit can still run, but a Deep Scan may provide better product evidence."* — with both actions available. It must not claim the audit will score higher, and must not call the existing audit invalid: a Deep Scan improves **evidence coverage**, and coverage is not a score. Running a Deep Scan never triggers a paid audit automatically; the user decides when to re-run.

## Costs

The first Deep Scan is free to the **user**, not to Vibe. Browser sessions cost provider **wall-clock seconds**, not tokens. This is a different cost concept from Anthropic inference and is deliberately not merged into the token ledger. `metrics.browserSessionDurationMs` records session duration; exact provider cost is not fabricated when the provider does not return it synchronously. Vibe Credits are not implemented.

## Delivery status

**Complete and tested (114 tests in this sprint's modules):**

- `BrowserSessionProvider` port + Browserbase adapter, including the recording/context/captcha invariants
- Typed error and warning model
- Central budgets with a tracker
- Evidence-backed route discovery and origin policy
- Read-only request/capability policy
- DOM extraction script + sanitization gate
- Snapshot schema
- The analyzer, including tab selection, off-origin refusal, budget degradation, and warning composition
- Playwright CDP connector with read-only guards
- Server-only Browserbase env module
- Database migration (both tables, RLS, concurrency guards)
- ADR 0012 and this document
- **Deep Scan entitlement policy** (`authorizeDeepScan`, consumption rule, abuse limits, safe access status)
- **Authenticated surface detection** for the activation prompt
- **Provider usage record** shape, kept separate from token accounting
- **Entitlement + usage schema** (`access_mode`, one-included-scan unique index, `deep_scan_provider_usage`)
- `keepAlive: true` correction for the two-request manual-login flow
- **`store.ts`** — session and snapshot persistence, entitlement-fact gathering, provider-usage write. `provider_session_id` is excluded from the client-safe projection and reachable only through the explicitly named `getSessionWithProviderId`
- **`service.ts`** — the full lifecycle: `startDeepScan` → `getDeepScanLiveView` → `analyzeDeepScan`, plus `cancelDeepScan` and `getDeepScanAccessStatus`
- **`getConnection` on the provider port** — the missing verb that made the two-request flow possible at all (see below)
- **Audit-log events** (`deep_scan.started` / `.completed` / `.failed` / `.cancelled`)
- **Supabase test double** modelling the migration's three partial unique indexes, so the concurrency and entitlement guarantees are exercised rather than assumed

### A second missing verb, found while wiring the lifecycle

`createSession` returns a `connectUrl`, and that URL is deliberately never
persisted — it is a capability granting full CDP control. But the manual-login
flow spans **two** server requests, so the second one had no way to reach the
browser the first one opened. The port had no verb for it.

This is the same class of defect as the `keepAlive` bug and would have had the
same effect: every scan failing at the reconnect. Fixed by adding
`getConnection(providerSessionId)` to `BrowserSessionProvider`, implemented on
Browserbase via `sessions.retrieve()`, which also reports the provider's own
session status — so a session that timed out or was released is discovered
*before* connecting rather than as a hung socket. The capability URL is fetched
per use and dropped, exactly as before.

**Outstanding — PR #12 is not mergeable until these are done:**

- Project-page UI: activation prompt, Live View modal, status section, second-scan credits state, user copy
- Server Actions / route handlers wiring the service to the UI
- Evidence pack `v2` and audit input identity
- Business Audit quality notice
- Migration deployment (`db:push`)
- Dogfood run and its security verification

## Known limitations

- The user must log in manually, and MFA may need interaction.
- Applications that render via POST may be partially analysed (reported, not hidden).
- Some authenticated routes will remain undiscovered, because paths are never guessed.
- Client-heavy applications take longer and may hit the duration budget.
- Unusual navigation patterns may yield only partial analysis.
- No persistent session: refresh requires re-login.
- A remote-browser provider is required for this feature.

## Validation

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` all pass. No test starts a real browser or contacts Browserbase; the provider and browser are injected everywhere.
