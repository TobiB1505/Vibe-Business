# Environment & Domain Architecture

How Vibe Business tells development, preview, and production apart, and
where each URL a deployment needs comes from. Written for the Production
Domain & Environment Migration sprint, which removed the last hardcoded
`*.vercel.app` values from the codebase.

## The principle

```
Code -> Environment Configuration -> Development / Preview / Production URL
```

The environment decides which URL is "this deployment's own"; the code never
guesses a domain and never bakes one in. This document is about **Vibe's own
URL** — the domain a visitor, a search engine, or Stripe reaches Vibe at.
It has nothing to do with a *connected project's* production URL (the
customer's own website, configured per-project in `/app/projects/[id]` and
used by Live Product Intelligence) — that is unrelated, per-customer data,
not deployment configuration.

## The three tiers

| Tier | How the origin is resolved | Configuration needed |
|---|---|---|
| **Development** | `http://localhost:3000`, the fallback when nothing else resolves | None |
| **Preview** | Vercel's own `VERCEL_URL` — a fresh, unique host per deployment | None — this is automatic |
| **Production** | `NEXT_PUBLIC_APP_URL`, set explicitly | Set once, in Vercel's Production environment variables |

Resolved by `src/lib/env/app-url.ts`'s `getAppUrl()`, in that priority order
(`NEXT_PUBLIC_APP_URL` first, then `VERCEL_URL`, then localhost) — see that
file's own doc comment for the full reasoning. `getAppEnvironment()` answers
the companion question, "which tier is this", primarily from Vercel's
`VERCEL_ENV`.

**Do not set a fixed "preview domain" variable.** A Preview deployment gets a
new, branch-specific URL from Vercel on every deployment; a variable copied
from one preview would be wrong for the next one. Reading `VERCEL_URL` is the
only version of "Preview" that stays correct without being reconfigured on
every branch — which is why Preview needs zero manual configuration at all.

## What actually reads `NEXT_PUBLIC_APP_URL` / `getAppUrl()`

| Consumer | File | What it builds |
|---|---|---|
| Sitemap | `src/app/sitemap.ts` | Every listed page's absolute URL |
| Robots | `src/app/robots.ts` | The `sitemap:` directive's URL |
| Root metadata | `src/app/layout.tsx` | `metadataBase`, for resolving any future relative Open Graph/alternate URL |
| Stripe Checkout / Customer Portal | `src/modules/billing/checkout.ts` | The return-URL fallback, only when `STRIPE_BILLING_RETURN_URL` is not explicitly set |
| Meta Pixel gate | `src/lib/analytics/meta-pixel.ts` | Not a URL — reads `getAppEnvironment()`, so the advertising tag ships on Production only ([ADR 0041](../decisions/0041-marketing-attribution-pixel.md)) |

## What deliberately does NOT read it

Two different reasons, worth telling apart:

**Already environment-agnostic by design, unrelated to this migration.**
Nothing here needed to change:

- **Auth redirects** (`src/modules/auth/actions.ts`'s `requestOrigin()`) — build
  the origin from the incoming request's `Host`/`X-Forwarded-Host` header, not
  from configuration. This is intentional: it is what lets localhost, every
  Preview deployment, and Production all work without a URL variable to keep
  in sync. Safety does not depend on trusting that header — Supabase rejects
  any `redirectTo` that is not on its own configured Redirect URLs allow list
  (see `docs/setup/supabase-auth.md`), so a spoofed host produces a rejected
  sign-in, not a redirect to an attacker.
- **Login/session redirects** (`src/modules/auth/redirects.ts`,
  `src/lib/supabase/proxy.ts`) — build relative paths or Next's own resolved
  `request.nextUrl`, never an absolute URL from configuration. A redirect that
  is only ever a path is structurally incapable of pointing at another origin.
- **GitHub App OAuth callback** — configured entirely in the GitHub App's own
  settings page (see `docs/setup/github-app.md`), not in code at all.

**A deliberately separate security boundary**, not merely unrelated:

- **`VIBE_AGENT_GATEWAY_ORIGIN`** (`src/modules/coding-agent/gateway-config.ts`)
  — the origin a Coding Agent's isolated Vercel Sandbox is told to send its
  Claude API traffic to, and — critically — the **entire egress allowlist**
  for that sandbox's network policy. `gateway-config.ts` documents in detail
  why this must stay explicit and independently configured: deriving it from
  `VERCEL_URL` would point a production execution at whatever deployment
  happened to be running the workflow (a preview, a branch, a rollback), which
  is simultaneously a wrong destination and a hole in the sandbox's network
  policy. It is **not** read from `NEXT_PUBLIC_APP_URL`, and a
  `gateway-config.test.ts` regression suite pins that the two never merge —
  setting `NEXT_PUBLIC_APP_URL` or `VERCEL_URL` has zero effect on what
  `readAgentGatewayConfig()` resolves.

  Set it to whichever deployment origin should actually receive gateway
  traffic — normally the Production domain, but it may legitimately differ
  (e.g. staying pinned to a specific Preview deployment while dogfooding the
  Coding Agent before rolling it out to Production). That is an operational
  decision made when setting the variable, not something this file or any
  code infers.

## Vercel environment variables

| Variable | Development | Preview | Production |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | unset | unset (auto via `VERCEL_URL`) | **`https://vibebusiness.de`** (the production custom domain) |
| `VIBE_AGENT_GATEWAY_ORIGIN` | unset (agent execution unavailable locally) | set only if deliberately dogfooding the Coding Agent on that Preview | your production custom domain, or a pinned dogfood Preview — see above |
| `VIBE_AGENT_GATEWAY_SECRET` | as needed for local dogfooding | as needed | required alongside the origin above |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | required | required | required |
| `STRIPE_BILLING_RETURN_URL` | unset (falls back to `getAppUrl()` + `/app/billing`) | unset | set explicitly, or leave unset to fall back to `NEXT_PUBLIC_APP_URL` + `/app/billing` |
| `PAID_OPERATIONS_DISABLED` | unset | unset | **unset** — set to exactly `1` only to stop paid work during an incident (VB-032) |

`VERCEL_URL`, `VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA` are injected
automatically by Vercel on every build — never set them yourself. The last is
what `/api/health` reports as `commit`.

### The paid-operations kill switch

`PAID_OPERATIONS_DISABLED=1` makes `createOperationRun` refuse every start that
spends a provider — inference, sandbox minutes, remote browser time, a branch
write — with a typed `paid_operations_disabled` reason and a message that says
nothing was started and nothing was charged.

It exists so stopping the spend is a dashboard toggle rather than a deploy. What
it deliberately does **not** do:

- **It does not cancel work already running.** An operation already paid for is
  money better spent than wasted.
- **It does not block a preview teardown.** Teardown *ends* a cost; refusing it
  during a spend incident would leave previews running and burning exactly the
  money the switch was thrown to save.
- **It does not block account erasure**, which is a person exercising a right.
- **It does not affect reads.** Every screen, audit and Move stays readable.

It applies to Vibe's own `system` starts as well as customer ones — a follow-on
operation the machinery creates for itself spends the same money.

Only the exact string `1` enables it. `PAID_OPERATIONS_DISABLED=false` is
**off**, deliberately: an operational lever read from a loose truthiness check
is one that a stray value turns on, and an incident is the worst possible time
to discover it.

### Liveness

`GET /api/health` returns `{ status, commit, environment }` and nothing else. It
is unauthenticated, excluded from the session proxy, and touches no database —
see the route's own docblock for why a DB ping is deliberately absent.

### Secrets Preview must not carry (VB-011)

Vibe runs on **one Supabase project**. There is no separate preview database, so
a Preview deployment holding a production credential is not a sandbox — it is
production with a different URL, reachable by anyone with the deployment link,
running unreviewed branch code.

These five must be scoped to **Production only** in Vercel:

| Variable | What a Preview holding it can do |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Bypass RLS and read or write any tenant's rows |
| `ANTHROPIC_API_KEY` | Spend real money on inference |
| `VIBE_AGENT_GATEWAY_SECRET` | Mint tokens the gateway accepts, against the production budget |
| `STRIPE_SECRET_KEY` (live) | Move real money |
| The dogfood project allowlist | Reach the internal cost ceiling from an unreviewed branch |

`VIBE_AGENT_GATEWAY_SECRET` appears in the table above as "as needed" for
Preview. That line is about *deliberately* dogfooding the Coding Agent on one
pinned Preview, which is a decision someone makes and then reverses. It is not
a licence for the variable to sit on every Preview by default.

**This is documentation, not verification.** Nothing in the repository can
observe Vercel's environment-variable scoping, and no tooling available to an
AI session lists it — so this section records the required state and does not
attest to the actual one. Checking it means opening the Vercel dashboard,
comparing the Preview and Production scopes for each row above, and removing
what should not be there. Until someone does that, VB-011 stays UNKNOWN rather
than closed, which is the status the launch-readiness audit gave it.

The structural fix behind all of this is a second Supabase project, or Supabase
branch databases, so that a Preview cannot reach production data even when it is
misconfigured. That is a bigger decision than an environment variable and has
not been taken.

## Real incident — the apex-vs-`www` redirect broke Stripe webhooks

Discovered 2026-08-20, on this exact production domain, worth recording
because it will bite the next domain too if the checklist below skips it.

Vercel let two hostnames exist for one project — `vibebusiness.de` and
`www.vibebusiness.de` — and one of them was configured to **308-redirect**
to the other rather than to serve the app directly. Stripe's webhook
endpoint was registered against the redirecting hostname. Stripe does not
follow redirects when delivering a webhook, so every `checkout.session.completed`
event failed with `308 ERR` in the Stripe dashboard — silently, from the
application's point of view, since the request never reached
`src/app/api/billing/stripe/webhook/route.ts` at all. `curl`/`fetch` against
the redirecting host shows exactly this:

```
POST https://vibebusiness.de/api/billing/stripe/webhook
-> 308 Permanent Redirect
   Location: https://www.vibebusiness.de/api/billing/stripe/webhook
```

**Fixed by making the apex domain (`vibebusiness.de`) canonical**: in Vercel
(Project Settings → Domains), `www.vibebusiness.de` now redirects to
`vibebusiness.de`, not the other way around — the conventional direction, and
the one that matches `NEXT_PUBLIC_APP_URL`. Any URL configured against a
custom domain (a Stripe webhook, a Supabase Redirect URL, a GitHub App
Callback URL, `NEXT_PUBLIC_APP_URL` itself) must point at whichever hostname
Vercel's Domains settings show as **not** redirecting — check that first,
every time, rather than assuming the "obvious" form (with or without `www`)
is the one that actually serves traffic.

## Migrating from a `*.vercel.app` domain to a custom one

1. Add the custom domain in Vercel (Project Settings → Domains). **Before
   configuring anything else against it**, confirm in that same Domains
   screen which hostname is canonical and which one redirects — see the
   incident above. Every step below must target the canonical one.
2. Set `NEXT_PUBLIC_APP_URL` to the canonical domain in Vercel's
   **Production** environment variables only. Preview and Development need
   no change.
3. Update Supabase's Site URL and add the new domain's `/auth/callback` and
   `/auth/confirm` Redirect URLs — see `docs/setup/supabase-auth.md`. Keep the
   old `*.vercel.app` entries until you have confirmed nothing still depends
   on them (an in-flight email link, a bookmarked preview).
4. If a production GitHub App exists, update its Homepage URL and Callback
   URL — see `docs/setup/github-app.md`.
5. If Stripe is configured, update the webhook endpoint URL in the Stripe
   Dashboard (Developers → Webhooks) to the canonical domain.
6. Decide `VIBE_AGENT_GATEWAY_ORIGIN` deliberately (see above) — it does not
   move automatically just because `NEXT_PUBLIC_APP_URL` did.
7. Redeploy Production. Verify: the deployed site's `/robots.txt` and
   `/sitemap.xml` name the new domain, sign-in and Google OAuth complete
   successfully, a Stripe test webhook event delivers with `200` (not
   `308`) in the Stripe Dashboard's Webhooks → Event deliveries view, and a
   Checkout session returns to the new domain.

## Local development

No `NEXT_PUBLIC_APP_URL` needed — everything falls back to
`http://localhost:3000` automatically. Auth already works against any host
because it is header-derived (see above); the only thing to configure locally
is `http://localhost:3000/auth/callback` and `/auth/confirm` on Supabase's
Redirect URLs list, per `docs/setup/supabase-auth.md`.
