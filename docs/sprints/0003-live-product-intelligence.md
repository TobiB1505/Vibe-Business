# Sprint 3 — Live Product Intelligence

Status: Implemented. Migration deployed via the linked Supabase CLI workflow; dogfooded against the real Vibe Business deployment.
Branch: `feat/sprint-3-live-product-intelligence`

## Goal

Give a project a second, independent evidence source alongside Sprint 2's Repository Intelligence:

```
Repository intelligence  →  what the code contains
Live product intelligence →  what the customer actually sees
```

A user configures a production URL; Vibe Business safely inspects the public website and produces a versioned, deterministic `LiveProductIntelligenceSnapshot`. **No AI is involved anywhere in this path.**

## Context

[PRODUCT.md §6](../../PRODUCT.md#6-core-user-flow) step 3 makes the production URL an explicit input to the Core Loop, and [ARCHITECTURE.md §3.3](../../ARCHITECTURE.md#33-live-product-analysis-layer) had it as an open decision ("scope of live analysis for V0.1"). This sprint closes that decision: **static HTTP/HTML inspection of public pages only**, bounded by explicit budgets.

The two intelligence sources stay separate on purpose (§24). Merging them into one blob would destroy the most interesting signal the future Business Audit can use — that the code contains a pricing route the live site does not actually serve, or vice versa.

## Architecture

Deterministic pipeline, each stage a pure function over plain data except the network adapter:

```
SafeUrlValidator  (url.ts)          normalize + policy
   → SafeFetcher  (net/safe-fetch)  SSRF gate + pinned request + redirect control
   → SiteDiscovery(crawler.ts)      same-origin BFS under budgets
   → HtmlParser   (html.ts)         bounded tag scanning, never execution
   → PageClassifier (classifier.ts) product surfaces with evidence
   → SignalAggregator (signals.ts)  SEO + conversion signals
   → SnapshotBuilder (analyzer.ts)  versioned snapshot
   → store.ts / service.ts          persistence, reuse, audit
```

`DnsResolver` and `HttpTransport` are ports (`net/ports.ts`) with Node adapters (`net/node-dns.ts`, `net/node-transport.ts`). Everything above the adapters is tested with in-memory doubles, so **CI never touches the network**.

## SSRF threat model

Recorded in full as [ADR 0010](../decisions/0010-safe-outbound-http-inspection.md). Summary:

The user controls the destination of a server-side request, and the server can reach networks the user cannot (cloud metadata, private ranges, internal services). Every request — initial and every redirect hop independently — passes:

1. **URL policy** — HTTPS only, no credentials, no internal hostname shapes.
2. **DNS resolution** — via the OS resolver, so `/etc/hosts` is visible to validation.
3. **Address gate** — *every* resolved address must be publicly routable. Blocks loopback, private, link-local, unique-local, CGNAT, multicast, reserved, documentation ranges and cloud metadata, across IPv4/IPv6 including IPv4-mapped (`::ffff:127.0.0.1`) and NAT64 forms. Unparseable ⇒ unsafe.
4. **Pinned connection** — connect to the address that just passed, with `Host`/SNI still carrying the hostname. This is the DNS-rebinding defence: there is no second lookup to poison.

Alternate encodings (`0177.0.0.1`, `2130706433`, `127.1`, hex) are rejected by refusing to parse them rather than by trying to decode them. A hostname resolving to both public and private addresses is rejected outright, not filtered.

Redirects are followed manually under an explicit hop limit; automatic redirect following is never used, because it would issue a request to a destination that was never validated.

## Safe fetching policy

- Explicit user agent: `VibeBusinessBot/1.0 (+https://github.com/TobiB1505/Vibe-Business; live product inspection)`.
- Bounded concurrency (2), reduced to 1 when robots declares a `Crawl-delay` (honoured up to a 2s cap; no background retries).
- Only `text/html`, `text/plain` (robots) and XML (sitemap) are processed. Images, PDFs, archives, media and executables are rejected unread.
- Byte limits are enforced **while the response streams**, not after buffering. A declared `Content-Length` over budget is refused before a byte is read.
- `429` is honoured as rate limiting and degrades the crawl rather than failing it. `Retry-After` is parsed and reported; no retry loop is built.
- Never authenticates, submits forms, executes JavaScript, or calls APIs found in page content.

## Crawl budgets

Centrally defined in `budgets.ts`:

| Budget | Value |
|---|---|
| Max pages | 12 |
| Max links considered per page | 80 |
| Max bytes per page | 1 MB |
| Max total bytes | 6 MB |
| Max redirects per request | 3 |
| Max crawl depth | 2 |
| Per-request timeout | 6 s |
| Max total duration | 20 s |
| Concurrency | 2 |
| Max sitemap URLs | 100 |

Reaching a budget is never an error. It marks the snapshot `partial` with machine-readable reasons (`page_budget_reached`, `byte_budget_reached`, `crawl_depth_reached`, `link_budget_reached`, `sitemap_budget_reached`, `timeout`, `rate_limited`, `robots_disallowed`, `fetch_failed`) and returns everything already learned.

The frontier is **priority-ordered** so a 12-page budget is spent on pricing, signup, login, checkout and contact before the ninth blog post. Ordering is deterministic.

## Data minimization

Never persisted: raw HTML, page source, JavaScript, stylesheets, full body text, cookies, or query strings.

Persisted: derived facts plus short labels as evidence (titles, headings, CTA text, capped in length), and **origin + pathname only** — never a URL with a query string, because that is where tokens, email addresses and tracking identifiers live (§22).

Query handling is aggressive by design: the crawl identity of a page is `origin + normalized pathname`, with the query excluded entirely. This makes query explosion structurally impossible (a thousand `?utm_*` variants of `/blog` collapse to one target) at the documented cost of not analysing query-differentiated pages separately.

Form handling reads **structure only** — input *types*, counts, and the submit label. Field names, values, placeholders and hidden inputs are never read. Two tests assert that passwords, emails and CSRF tokens present in fixture markup do not appear anywhere in the serialized output.

## Detection model

**Product surfaces** (§16) — homepage, pricing, login, signup, dashboard/app, checkout/billing, onboarding, contact, docs/help, blog/content, privacy, terms. Detected from four independent signal sources: URL path, page title, headings, and form structure. A page fetched and classified is `high` confidence; a surface only ever seen as a link the site exposes is `medium`.

Strictly descriptive. "Pricing surface not detected" is a fact. Qualitative judgement belongs to the later Business Audit.

**CTAs** (§17) — a rule table of `{ category, patterns }` rather than hard-coded English comparisons, with German patterns included from the start to prove the model extends. Categories: trial, signup, get_started, purchase, subscribe, demo, contact, login. Precision over recall: a label must match a known action phrase, so ordinary navigation does not become a wall of false CTAs. The primary CTA prefers body over navigation, then category priority.

**Forms** (§18) — login-like, signup-like, contact-like, newsletter-like, search-like, unknown. Two password fields ⇒ signup; one ⇒ login unless the submit label says otherwise.

**SEO foundations** (§20) — presence facts only: title, meta description, canonical, language, viewport, Open Graph, structured data, robots meta, robots.txt, sitemap. **No scores, no recommendations.**

**Conversion** (§21) — primary CTA candidate, signup/pricing/contact CTA presence, form count and classifications, conversion-path links. No quality judgement.

## Snapshot model

`LiveProductIntelligenceSnapshot`, `schemaVersion: live-product-intelligence.v1`, `analyzerVersion: live-product-analyzer-v1`. Contains `source`, `crawl`, `siteMetadata`, `pages`, `productSurfaces`, `seoSignals`, `conversionSignals`, `metrics`, `completeness`, `warnings`.

Lifecycle: `pending → analyzing → completed | failed`. A failed run never carries a `result`, so it cannot displace the latest successful snapshot.

**Reuse** (§27): a live site has no commit SHA, so recency is the only honest key. A completed snapshot is reused when the origin and analyzer version are unchanged and it completed within a **24-hour freshness window**, unless the user explicitly refreshes. The UI says "analysed within the last 24 hours" — never "the website has not changed".

**Concurrency** (§28): a partial unique index on `(project_id, analyzer_version) where status in ('pending','analyzing')` turns a double-clicked Inspect into a unique-constraint violation reported as `already_running`. No queue, worker, or lock service.

## User flow

1. Project page shows **Production website — Not configured** with an `Add production URL` form.
2. Saving normalizes and validates the URL (HTTPS, no credentials, no query/fragment, no internal hostnames) and emits `project.production_url.updated`.
3. **Inspect live product** runs the analysis synchronously within budget.
4. The summary renders site metadata, product surfaces, conversion signals, SEO foundations, pages inspected, notes and completeness — evidence expandable, no raw JSON.
5. A **Project context** section shows Repository intelligence / Live product intelligence / Business analysis status side by side.

## Database

Migration `20260810004500_live_product_intelligence.sql`:

- `projects.production_url` — nullable text with a check constraint enforcing `https://`, length bounds, and no embedded credentials.
- `live_product_intelligence_snapshots` — separate table (§24), RLS enabled with 4 policies scoped through `projects.user_id`, 4 indexes (latest lookup, reuse lookup, in-flight guard, primary key), typed failure codes only, `set_updated_at` trigger.

No raw-HTML table, no screenshots, no vector/embedding tables.

## Supabase migration deployment

Deployed via the linked CLI workflow from [0002a](0002a-supabase-cli-workflow.md) — no manual SQL Editor use:

1. `pnpm db:status` — confirmed exactly one pending migration (`20260810004500`); the Sprint 1/2 migrations already aligned.
2. `pnpm db:push` — applied it to the linked project `dcbwlctscooefwnivxzv` (Vibe-Business).
3. `pnpm db:status` — local and remote histories aligned across all three migrations.
4. `pnpm db:lint` — **no schema errors found**.
5. Verified: 7 tables, RLS enabled on all 7, `production_url` column present, 4 policies and 4 indexes on the new table.

`db push` printed a `failed to cache migrations catalog: failed to run docker` warning. That is the CLI trying to build a *local* catalog cache and finding no Docker daemon; it does not affect the remote push, which reported success and was independently verified by `db:status` and direct schema queries.

## Dogfood test (§40)

Ran against the real deployment `https://vibe-business-fawn.vercel.app/`. Honest results:

| Measure | Result |
|---|---|
| Pages inspected | 3 (`/`, `/login`, `/signup`) |
| Bytes fetched | 27,264 |
| Requests | 3 |
| Duration | ~830 ms |
| Completeness | complete |

**Surfaces detected:** homepage (high, `url_path`), login (high — `url_path`, heading "Sign in", `form_structure: password field present`), signup (high — `url_path`, heading "Create account", `form_structure: registration form`).

**Not detected:** pricing, dashboard_app, checkout_billing, onboarding, contact, docs_help, blog_content, privacy, terms. All correct — none of those exist on the current deployment. **No pricing, payments, analytics, or SEO signals were manufactured.**

**Conversion:** primary CTA `Create account` (signup, high). Also found `Get started` (get_started) on `/` and `Sign in` (login). Two forms, both correctly classified: `login_like` on `/login` and `signup_like` on `/signup`, each `[email, password]`. Signup CTA present; pricing and contact CTA absent — correct.

**SEO foundations:** title ✓, meta description ✓, language ✓, viewport ✓; canonical —, Open Graph —, structured data —, robots meta —, robots.txt —, sitemap —. All verified accurate against the live site.

### Bug found and fixed

The first run reported `completeness: partial` with reason `crawl_depth_reached` even though all 3 existing pages were fetched. Cause: the depth check ran **before** the dedup check, so a link from `/signup` back to the already-visited `/login` tripped the depth counter despite nothing being missed. A complete crawl was being reported as incomplete.

Fixed by moving the dedup check ahead of the depth check in `crawler.ts`, with a regression test (`reports a fully crawled site as complete even when pages link back to each other`). Re-ran the dogfood: `completeness: complete`, reasons `[]`.

### Known false negative (not a detector bug)

`/app` exists and returns `307 → /login` — exactly the protected-surface case in §19 — but `dashboard_app` was **not** detected. Cause is discovery, not classification: no public page links to `/app`, so the crawler never reaches it. The classifier does handle this correctly when the page is reached (proven by `records a protected dashboard redirecting to login as evidence for both` and the equivalent crawler test).

Deliberately **not** "fixed" by probing well-known unlinked paths — that would be speculative crawling of URLs a site never advertised, which is outside this sprint's scope and beyond what a same-origin link crawl should do. Recorded as a limitation and an open question instead.

## Known limitations

- **Client-rendered content is invisible.** Static HTML only; a site that renders its entire body in JavaScript yields little. No headless browser is introduced (§37). Detecting and reporting this condition is a candidate for a future sprint.
- **Unlinked routes are never discovered** (see the `/app` finding above).
- **Query-differentiated pages are not analysed separately** — a deliberate consequence of pathname-based crawl identity.
- **Sitemap indexes are read one level deep only**; nested index networks are not followed.
- **Synchronous execution.** The 20 s budget must fit inside the hosting function's timeout. Vercel's default `maxDuration` is 10 s on Hobby / 15 s on Pro. The typical crawl finishes in ~1 s, and budgets degrade gracefully, but a large slow site could be cut off by the platform before our own timeout. **Reported rather than silently worked around** (§28) — see Open questions.
- **No localhost/dev target**, by deliberate policy (ADR 0010).
- **HTTPS only** — an HTTP-only site cannot be inspected.

## Acceptance criteria

All 33 criteria in the sprint brief are met. Specifically: production URL storage and normalization; SSRF defence with DNS and private-network checks; independently revalidated redirects; same-origin crawl; explicit budgets; HTML never executed; no browser dependency; no raw HTML persisted; product surfaces, CTA, form and SEO signals with evidence; versioned snapshot under RLS; repository intelligence untouched and separate; audit events; duplicate-run control; no AI dependency; SSRF and crawl tests passing; full quality gate green; `db:status` aligned; `db:lint` clean; secret scan clean; dogfood attempted honestly.

## Validation

- `pnpm lint` — pass
- `pnpm typecheck` — pass
- `pnpm test` — **556 tests across 35 files**, all passing (257 in this module)
- `pnpm build` — pass
- `pnpm db:status` — aligned · `pnpm db:lint` — no schema errors
- Real dogfood against `https://vibe-business-fawn.vercel.app/` — see above

## Non-goals (explicitly not implemented)

AI Business Audit · Business Readiness Score · recommendations · opportunities · screenshots/visual analysis · browser automation · authenticated crawling · JS execution · repository execution · code generation · branch creation · repository writes · PR generation · previews · Stripe/payments/credits · SEO recommendations · ads · analytics infrastructure · queues/workers · webhook lifecycle · teams.

Sprint 3 ends at: *a versioned deterministic intelligence snapshot exists for the public live product.*

## Open questions

- **Vercel `maxDuration`.** Should the project page's segment declare a higher `maxDuration`, or should live analysis eventually move behind the deferred background-job decision ([ARCHITECTURE.md §7](../../ARCHITECTURE.md#7-deferred--open-decisions) item 10)? Not decided here.
- **Client-rendered sites.** If static HTML proves insufficient for a meaningful share of real targets, a rendering strategy needs its own ADR — it is a significant expansion of the outbound attack surface, not a detector tweak.
- **Unlinked well-known routes.** Whether bounded probing of a small set (`/pricing`, `/app`, `/login`) is acceptable behaviour for a self-identified bot is a product/ethics decision, not a technical one.
