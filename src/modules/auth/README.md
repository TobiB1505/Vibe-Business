# modules/auth

Vibe Business's own user authentication, via Supabase Auth ([ADR 0002](../../../docs/decisions/0002-supabase-postgres-and-auth.md)). Separate concern from GitHub repository access ([ADR 0003](../../../docs/decisions/0003-github-app-integration.md)) — this module never talks to GitHub.

Dashboard and Google Cloud configuration lives in [docs/setup/supabase-auth.md](../../../docs/setup/supabase-auth.md). This file is the code-side map.

## Ways in

Two, both landing on the same Supabase user:

- **Email + password** — `signInWithPassword` / `signUp`, unchanged since Sprint 1.
- **Google** — `signInWithOAuth`, added in the auth-persistence sprint.

Supabase links identities with the same email address automatically, so a person
who signed up with a password and later uses Google keeps the same `user.id` and
therefore the same projects, GitHub connection and audits. Vibe implements no
linking or merging logic — see the caveat about **Confirm email** in the setup
doc before enabling Google for real users.

## What exists

| File | Responsibility |
|---|---|
| `session.ts` | `getSession()` reads and *verifies* the current session; `requireSession()` is the authorization gate. |
| `actions.ts` | Every Server Action: sign in, sign up, Google hand-off, password reset request, password update, sign out. |
| `redirects.ts` | `sanitizeNextPath()` — the single open-redirect boundary. Also `internalRedirect()`. |
| `errors.ts` | Classifies provider errors and maps them to copy. Nothing raw ever reaches a screen. |
| `throttle.ts` | Per-account sign-in throttling (VB-010). One `SECURITY DEFINER` function holds all the state; a success clears only the caller's own verified identity. Fails open. |

Routes and screens:

| Path | Purpose |
|---|---|
| `src/app/login/` | Sign in — Google, then email + password. Redirects away if already signed in. |
| `src/app/signup/` | Account creation. |
| `src/app/forgot-password/` | Requests a reset link. Also where dead reset links land. |
| `src/app/reset-password/` | Sets the new password. Requires the recovery session. |
| `src/app/auth/callback/` | OAuth PKCE code exchange. |
| `src/app/auth/confirm/` | Emailed links: signup confirmation, email change, recovery. |
| `src/lib/supabase/proxy.ts` | Session refresh + the first-line `/app` guard. |
| `src/app/app/layout.tsx` | `requireSession()` — the actual gate for every page under `/app`. |

## Session persistence

Cookies, via `@supabase/ssr`. Vibe stores no token of its own — no
`localStorage`, no parallel session cookie, no custom refresh logic. Cookies
default to a 400-day `maxAge`, so closing the browser does not sign anyone out;
the access token is refreshed by the proxy on every matched request.

Three things keep that working, and each has a test that fails loudly if it
stops:

1. The proxy calls `getClaims()` with nothing between it and
   `createServerClient()`.
2. Every response the proxy emits — including redirects — carries the refreshed
   cookies. A redirect that drops them rotates a refresh token into the void and
   ends the session permanently.
3. Every response carrying `Set-Cookie` also carries the cache headers
   `@supabase/ssr` supplies with it. Vibe runs behind a CDN; a cached auth
   response is one user handed another user's session.

## Authorization

`requireSession()` is the boundary. The proxy's `/app` redirect is UX — it stops
a signed-out visitor from ever rendering a frame of the workspace — but it is
not what makes `/app` safe. Layouts do not wrap sibling Route Handlers or Server
Actions, so each of those calls `requireSession()` itself; the GitHub connect
routes and every project action already do.

`getSession()` uses `getClaims()`, which verifies the JWT signature. `getUser()`
would be equally safe but costs an Auth-server round trip per call.
`getSession()` from the Supabase SDK is **never** acceptable in server code: it
decodes the cookie without verifying it, and the cookie is attacker-writable.

## Redirects

One function decides every post-auth destination: `sanitizeNextPath()`. It is an
allowlist — a value must prove it is an internal `/app` path, and anything that
cannot falls back to `/app`. Email login, the OAuth callback and the proxy guard
all route through it, so there is one place to get right rather than three.

Route Handlers emit **relative** `Location` headers, which structurally cannot
point at another origin. The proxy cannot: Next's proxy layer parses that header
as an absolute URL and throws on a bare path, so it builds redirects from
`request.nextUrl` — Next's own resolved URL, not a client-supplied header.

## Errors

`errors.ts` classifies first and renders from a fixed table. Two reasons:
Supabase messages sometimes echo the submitted input, and "no user with this
email" versus "wrong password" is an account-enumeration oracle. Logs get the
classification plus the provider's own code and status — never the message, the
credentials, a token, or an authorization code.

Password reset reports success regardless of whether the address exists. That
neutrality *is* the anti-enumeration measure; only rate limiting and an
unreachable server are surfaced, because neither says anything about the
address.

## Email links use token_hash, OAuth uses PKCE

Deliberately different, for one reason: PKCE's code verifier lives in a cookie
belonging to the browser that started the flow.

- **OAuth** is one continuous navigation, so it is always the same browser. PKCE
  is correct and is what `/auth/callback` uses.
- **Email links** get requested on a laptop and opened on a phone. PKCE fails
  there for users who did nothing wrong, so `/auth/confirm` uses `token_hash` +
  `verifyOtp`, which carries everything it needs in the link.

This requires the Supabase email templates to be changed; see the setup doc.

## Migration history

Approaches tried and abandoned, in order:

1. **Magic link + PKCE `exchangeCodeForSession(code)`** (`/auth/callback`, Sprint 0). The production root cause of sign-ins failing with `/login?error=auth`: PKCE requires a code-verifier cookie from the browser that *initiated* the sign-in, which isn't present when a magic link is opened in a different browser or device — extremely common with email links. Removed.
2. **Magic link + `token_hash` + `verifyOtp`** (`/auth/confirm`) — the standard fix for problem #1. Implemented, then abandoned before shipping in favor of password auth, specifically because of Supabase's development email rate limits making *any* email-based flow unreliable for repeated local and E2E testing. Removed at the time.
3. **Email + password only** (Sprint 1). What shipped, and still the default way in.

The auth-persistence sprint brought approach #2 back — but only for the leg it is
actually right for. Email links are the case PKCE handles badly and `token_hash`
handles well; OAuth is the reverse. Both now exist side by side because they
solve different problems, not because one replaced the other.
