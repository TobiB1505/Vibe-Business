# Supabase Auth setup

Everything in this file is configuration that lives **outside** the repository —
in the Supabase dashboard and in Google Cloud. The code is complete without it,
but Google sign-in and emailed links do not work until these are set.

Nothing here is a secret. Project refs and callback URLs are public by
construction; the Google client secret is named but never written down, and it
belongs in Supabase's provider configuration, not in Vibe's environment.

## The project

| | |
|---|---|
| Supabase project | `Vibe-Business` |
| Project ref | `dcbwlctscooefwnivxzv` |
| Region | `eu-north-1` |
| Production URL | Whatever `NEXT_PUBLIC_APP_URL` is set to in Vercel's Production environment (see [environment.md](../deployment/environment.md)) — no longer a fixed `*.vercel.app` value. |

The ref is the hostname of `NEXT_PUBLIC_SUPABASE_URL`
(`https://dcbwlctscooefwnivxzv.supabase.co`). If you ever need it and are not
sure, read it from there — never guess it.

## How the session works

`@supabase/ssr` keeps the session in cookies, not in `localStorage`. Vibe stores
no tokens of its own and implements no refresh logic.

```
browser ──► src/proxy.ts ──► src/lib/supabase/proxy.ts
                             · getClaims() — verifies the JWT signature
                             · writes refreshed cookies onto the response
                             · applies the Cache-Control headers that come
                               with them (see "Why the cache headers matter")
                             · redirects /app/** when signed out
                                    │
                                    ▼
                             Server Components / Actions
                             · src/lib/supabase/server.ts reads the cookies
                             · requireSession() is the authorization boundary
```

Two rules that are easy to break by accident:

- **Never use `getSession()` in server code.** It decodes the cookie without
  verifying the signature, and the cookie is attacker-writable. `getClaims()`
  verifies against the project's published keys; `getUser()` asks the Auth
  server. Either is safe. `getSession()` is not.
- **Never run code between `createServerClient()` and `getClaims()`** in the
  proxy. The symptom of getting this wrong is users being randomly signed out,
  which only reproduces near token expiry and is miserable to debug.

### Why the cache headers matter

When `@supabase/ssr` refreshes a token it calls `setAll(cookies, headers)`. The
second argument carries `Cache-Control: private, no-cache, no-store,
must-revalidate, max-age=0`, `Expires: 0` and `Pragma: no-cache`.

Applying them is not cosmetic. Vibe runs behind Vercel's edge cache, and a
cached response carrying somebody's `Set-Cookie` hands one user another user's
session. `src/lib/supabase/proxy.ts` applies them on every response it emits,
including redirects. Do not remove that.

## Supabase dashboard

### Authentication → Sign In / Providers

**Email** — enabled.

- **Confirm email**: see [Confirm email and account linking](#confirm-email-and-account-linking)
  below before changing this. It interacts with Google sign-in in a way that can
  cost someone their password login.

**Google** — enable, then paste the Client ID and Client Secret from Google
Cloud (next section). The provider page shows a **Callback URL**; that is the
URL Google needs, and it is *not* one of Vibe's routes.

### Authentication → Passwords

- **Minimum password length**: **8**, matching `MINIMUM_PASSWORD_LENGTH` in
  `src/modules/auth/actions.ts` (VB-037). Vibe refuses anything shorter on both
  the sign-up and the reset path before Supabase is asked, so this setting is a
  second, independent refusal rather than the only one — which is the right
  relationship between an application rule and a provider setting. Supabase's
  own default is 6.
- **Leaked password protection**: **on**. It checks candidate passwords against
  HaveIBeenPwned. Off, this is the one remaining `WARN` in
  `get_advisors --type security`.

### Authentication → URL Configuration

- **Site URL**: the production custom domain (e.g. `https://vibebusiness.de`)
  — this is the value `NEXT_PUBLIC_APP_URL` is set to in Vercel's Production
  environment (see [environment.md](../deployment/environment.md)).
- **Redirect URLs** — the allow list for `redirectTo`. Add exactly:
  - `http://localhost:3000/auth/callback`
  - `http://localhost:3000/auth/confirm`
  - `https://vibebusiness.de/auth/callback`
  - `https://vibebusiness.de/auth/confirm`

**Migrating from a `*.vercel.app` domain to a custom one**: add the new domain's
two entries above; do not remove the old `*.vercel.app` ones until you have
confirmed nothing still depends on them (an in-flight email link, a bookmarked
preview used for dogfooding). A stale entry left on the list is a dormant risk,
not an active one — Supabase only ever sends a session to a URL something
actually requested a redirect to.

Preview deployments get a fresh hostname per deployment, so they are not on this
list. Add a specific preview URL when you deliberately want to test auth on one;
do not add a wildcard covering every preview, since anything matching the
pattern becomes a legal place to send a freshly authenticated user.

### Authentication → Email Templates

**This change is required for password reset and email confirmation to work.**

Supabase's default templates send `{{ .ConfirmationURL }}`, which uses the PKCE
code exchange. PKCE stores its code verifier in a cookie belonging to the
browser that *started* the flow — and email links get opened on a phone after
being requested on a laptop. This repository has already shipped that bug once
and diagnosed it as the production cause of sign-ins failing; see
[src/modules/auth/README.md](../../src/modules/auth/README.md).

`/auth/confirm` uses `token_hash` + `verifyOtp` instead, which is self-contained
and works from any browser. Update these templates:

| Template | Change `{{ .ConfirmationURL }}` to |
|---|---|
| Confirm signup | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup` |
| Reset password | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` |
| Change email address | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change` |
| Invite user | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` |

Until these are changed, links keep using the old flow and `/auth/confirm` never
receives them.

## Google Cloud

### The two redirect levels — do not mix them up

This is the single most common way to lose an afternoon.

```
1. Google Cloud "Authorized redirect URI"
   https://dcbwlctscooefwnivxzv.supabase.co/auth/v1/callback
   Owned by Supabase. Where Google returns after consent.
   Vibe never sees this URL.

2. Supabase "redirectTo" / Redirect URLs
   https://vibebusiness.de/auth/callback
   Owned by Vibe. Where Supabase returns after it has the tokens.
   This is src/app/auth/callback/route.ts.
```

Putting Vibe's `/auth/callback` into Google Cloud, or Supabase's
`/auth/v1/callback` into `redirectTo`, both produce a sign-in that fails at the
last step with nothing useful in the logs.

### Steps

1. [Google Cloud Console](https://console.cloud.google.com/) → select or create
   a project.
2. **APIs & Services → OAuth consent screen** → configure. External user type.
   Fill in app name, support email, and the developer contact.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
4. Application type: **Web application**.
5. **Authorized redirect URIs** — add exactly one entry:
   `https://dcbwlctscooefwnivxzv.supabase.co/auth/v1/callback`
6. Create, then copy the **Client ID** and **Client Secret** into Supabase's
   Google provider configuration.

**Authorized JavaScript origins**: leave empty. The server-side authorization
code flow Vibe uses does not need them, and adding origins speculatively widens
the client for no benefit.

### While the consent screen is in Testing

Only accounts listed under **Test users** can sign in. Everyone else gets
"Access blocked". Add the accounts you plan to dogfood with, or publish the
consent screen.

## Confirm email and account linking

Supabase links identities **automatically**: when someone signs in with Google
using an email address that already has an account, the Google identity is
attached to that existing user. Same `user.id`, so projects, GitHub connections,
audits, action plans and everything else stay attached. Vibe implements none of
this and must not — see [ADR 0002](../decisions/0002-supabase-postgres-and-auth.md)
and rule 14 of the working agreement.

There is one consequence worth understanding before enabling Google in
production. From Supabase's identity-linking documentation:

> To prevent [pre-account-takeover attacks], when a new identity can be linked
> to an existing user, Supabase Auth will remove any other unconfirmed
> identities linked to an existing user.

With **Confirm email off**, accounts created through `/signup` have an
*unconfirmed* email identity. If such a user later signs in with Google using
the same address, that unconfirmed email identity can be removed — and their
password sign-in stops working. Their data is untouched; their second way in is
not.

**This has not been verified against the live project** — doing so requires
creating a real account and a real Google sign-in, which this sprint did not do.
Before turning Google on for real users, either:

- turn **Confirm email on**, so email identities are confirmed and the removal
  rule does not apply (the templates above already support this); or
- verify the behaviour deliberately with a throwaway account and record what
  actually happened.

Do not resolve a linking conflict by editing `auth.users` or `auth.identities`
by hand, and never merge two accounts in application code.

## Environment variables

This sprint adds **none**. Auth uses the two that already exist:

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local`, Vercel | Public by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local`, Vercel | Public by design |

The Google **Client Secret lives in Supabase's provider configuration**, not in
Vibe's environment and never in the browser. There is deliberately no
`NEXT_PUBLIC_GOOGLE_*` anything.

Callback URLs are derived per-request from the incoming `Host`, so localhost,
previews and production all work without a site-URL variable to keep in sync.
That header is client-controllable in principle, but the value only leaves as
Supabase's `redirectTo`, and Supabase rejects any `redirectTo` outside the allow
list above — so a spoofed host produces a rejected sign-in, not a redirect to an
attacker.

## Local development

```
NEXT_PUBLIC_SUPABASE_URL=https://dcbwlctscooefwnivxzv.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from Project Settings → API>
```

Then `http://localhost:3000/auth/callback` and `/auth/confirm` must be on the
Redirect URLs list, as above.

Without these variables the app still builds and runs: `getSession()` treats an
unconfigured project as signed out and logs loudly, so `/login` renders instead
of the whole site 500ing. Nobody can sign in, which is the honest outcome.
