# Sprint 12C — Google Search Console Metric Source

**Status: PARKED / DEFERRED.** Not started beyond foundations, not completed, not
abandoned.

| Slice | State |
| --- | --- |
| Official API contract verified against current Google docs | ✅ Done — findings below |
| Credential sealing primitive | ⏸ Parked in [PR #34](https://github.com/TobiB1505/Vibe-Business/pull/34) |
| Provider date semantics + missing-row-is-not-zero | ⏸ Parked in PR #34 |
| Property discovery and matching | ⏸ Parked in PR #34 |
| OAuth flow, routes, callback | ⛔ Never built |
| Connection persistence, RLS, migration | ⛔ Never built — **no migration was written, nothing deployed** |
| `BusinessMetricSource` adapter + registry wiring | ⛔ Never built |
| UI, browser E2E, dogfood | ⛔ Never built |

## Why it is parked

The product direction changed while the connector was still at its foundations.

Measurement is **infrastructure**, not the product. Requiring a customer to
configure an external analytics provider in the middle of the execution flow
inverts that: it makes Vibe's core loop depend on a third-party setup step, and
turns the end of every change into a prompt about Vibe's own missing integration.

The connector remains technically viable — the API verification below still
holds, and the parked code is complete and tested for what it covers. It is
simply not what the product needs next. The next priority is **expanding
executable business capabilities and explaining their business value clearly**,
which is what the 12C cleanup put in its place.

## What replaced it in the product

Nothing was rolled back. The Sprint 12B measurement foundation is intact and
untouched — plans, measurements, windows, data-quality semantics, causality
safeguards, RLS. What changed is only how the *absence* of measurement is
presented:

| Before | After |
| --- | --- |
| **Business impact** — *Measurement source required*, the metric, and an explanation of Vibe's missing connector | **Impact tracking** — *Long-term impact has not been measured.* |
| A prominent section in every project, for every change | One quiet line, secondary heading |

And a new deterministic layer explains the change itself, which is what a user
actually wants at that moment: see
[BusinessRationale](#businessrationale-the-layer-that-replaced-the-prompt).

## The API verification, kept

Re-checked against current official Google documentation before any code was
written. **No contradictions with the sprint's assumptions**, plus four details
worth keeping for whoever resumes this:

| Assumption | Result |
| --- | --- |
| OAuth 2.0 server-side flow for Search Console user data | ✅ |
| `webmasters.readonly` is sufficient | ✅ `sites.list` lists it alongside the read-write scope |
| Offline access via `access_type=offline` | ✅ — **but a refresh token is only returned on the first authorization**, so `prompt=consent` is required to guarantee one. This is not in the sprint brief and would otherwise produce connections that authorize cleanly and cannot do background measurement. |
| `sites.list` for discovery | ✅ returns `siteUrl` + `permissionLevel` (`siteOwner`, `siteFullUser`, `siteRestrictedUser`, `siteUnverifiedUser`) |
| Domain vs URL-prefix properties | ✅ `sc-domain:example.com` vs `https://www.example.com/` |
| `searchanalytics.query` with finalized data | ✅ `dataState`: `all` / `final` / `hourly_all` |
| **Dates are Pacific Time, not UTC** | ✅ documented as "PT time (UTC - 7:00/8:00)" |
| Quota exists | ✅ 1,200 QPM per site; Google's own load guidance says *avoid grouping by page or query, limit date ranges, and do not requery identical data* — independently matching the sprint's §16/§21/§22 |

## What the parked code contains

All of it in [PR #34](https://github.com/TobiB1505/Vibe-Business/pull/34), branch
`feat/search-console-connector`, commit `a6db9e3`. Retrievable in full with
`git show a6db9e3`. **Deliberately not merged to `main`**: it has no consumer
while the connector is parked, and unused security-critical code on the default
branch rots quietly (CLAUDE.md rule 15).

- **`sealed-credential.ts`** (13 tests) — AES-256-GCM with a fresh IV per seal,
  the connection id bound as additional authenticated data so a blob lifted
  between rows fails to open, and a key version in the envelope so rotation does
  not mean asking every user to reconnect. Provider-neutral: it would serve any
  future connector, or any other stored secret.
- **`dates.ts`** (12 tests) — half-open `[start, end)` windows to Google's
  inclusive `endDate`, resolved in `America/Los_Angeles` via `Intl` rather than
  offset arithmetic, provably independent of the host `TZ`. Plus the
  missing-row-is-not-zero rule: an unfinalized day has no row, a genuine zero
  comes back as `impressions: 0`, and conflating them makes a complete baseline
  look larger than an incomplete window.
- **`properties.ts`** (16 tests) — domain vs URL-prefix classification and a
  matcher that auto-selects only when exactly one candidate sits at the
  strongest real match level. A domain property and a URL-prefix property for
  the same site are both correct answers that return different numbers, so that
  case asks.

## Migration impact: none

**No Sprint 12C migration was ever written**, so nothing was deployed and
nothing needs reversing. Migration history ends at 12B's
`20260815120000_business_outcome_measurement.sql`, deployed 15.08.2026, and the
local/remote history remains aligned at 23/23.

The 12B schema stays exactly as it is. It is future-ready rather than dead:
`measurement_plans.compatible_source_kinds` already names `search_console`, and a
resumed connector registers against it without a schema change.

## Search Console as a future adapter

Not a current feature. Not dead capability either.

`MetricSourceKind` still includes `search_console`, the `BusinessMetricSource`
port is unchanged, and the registry still returns nothing for every project —
which remains the honest answer. When a connector is built it registers there
and no other layer changes. That was the point of the vendor-neutral port, and
parking the first adapter without touching the port is the evidence it worked.

**No dead production UI was left behind**: there is no Connect CTA, no OAuth
route, no property-selection screen and no Google environment variable anywhere
in the product.

## BusinessRationale: the layer that replaced the prompt

`src/modules/execution/business-rationale.ts`. Deterministic, capability-owned,
free, and requiring no AI — a capability's rationale is a property of the
capability, not of the customer.

The three concepts, which must never collapse:

```
BusinessRationale           why this change should matter
ProductOutcome              whether the intended behaviour was observed
BusinessOutcomeMeasurement  whether a business metric later changed
```

Each is knowable at a different moment and by different means: a rationale
before anything runs, a product outcome minutes after a merge, a measurement
after weeks and only with a source. Collapsing them is the standard way products
lie — *"this change improved your SEO"* reads as a measurement and is usually a
rationale.

A rationale is the **weakest** claim in the product, so it is held to the same
causal-language checker (`findCausalClaims`) that the measurement layer applies
to measured results, and it carries a mandatory limitation. A rationale without
its limitation is a promise.

### The SEO foundations rationale

| Field | Content |
| --- | --- |
| Problem | Search engines lacked structured discovery foundations. |
| Change | Vibe added the missing sitemap and search-engine crawling configuration. |
| Why it matters | This gives search engines a clearer way to discover and understand the public parts of the product. |
| Expected outcome | The public homepage can be discovered through the sitemap while authentication routes remain excluded. |
| Limitation | This establishes a technical foundation for organic visibility but does not guarantee rankings, traffic or revenue. |

Every sentence is checkable against what the capability emits. The limitation is
the load-bearing one.

## What a completed change now shows

```
What Vibe changed   Vibe added the missing sitemap and search-engine
                    crawling configuration.
Why this matters    Search engines now have a clearer path to discover
                    your public product.
Verified            ✓ robots.txt reachable
                    ✓ sitemap.xml reachable
                    ✓ homepage included
                    ✓ /login excluded
                    ✓ /signup excluded
Impact tracking     Long-term impact has not been measured.
```

No percentage, no invented result, and no requirement to connect anything.

If a real `BusinessOutcomeMeasurement` ever exists, the observed movement
appears *in addition* — with its data-quality note and its observed-change
disclaimer intact. No measurement still means no claim.

## Resuming this sprint

Everything needed is in PR #34 and in the API table above. What was never built:
the OAuth transaction and callback (including the token-exchange-succeeds /
DB-write-fails boundary, which is the genuinely hard part), connection
persistence and RLS, the adapter itself, and the UI.

It also needs manual setup that no code can do: a Google Cloud project with the
Search Console API enabled, an OAuth consent configuration, a Web Application
client with an exact registered redirect URI, and the resulting client
credentials plus a credential-sealing key in server-only environment
configuration.

One practical constraint worth knowing before resuming: the production origin is
a `*.vercel.app` subdomain, which can hold a **URL-prefix** property but not a
domain property — domain properties need DNS control over `vercel.app`. If no
such property exists, `no_matching_property` is the honest outcome and not a
failure.
