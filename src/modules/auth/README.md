# modules/auth

Vibe Business's own user authentication, via Supabase Auth ([ADR 0002](../../../docs/decisions/0002-supabase-postgres-and-auth.md)). Separate concern from GitHub repository access ([ADR 0003](../../../docs/decisions/0003-github-app-integration.md)) — this module never talks to GitHub.

## Current decision: email + password (development)

Email + password, via `supabase.auth.signInWithPassword` / `signUp` / `signOut`, is the current auth method — chosen over magic link specifically for **development and Sprint 1 E2E testing determinism**: Supabase's development email rate limits made repeated magic-link testing unreliable, and password auth needs no email delivery at all to sign in repeatedly.

This is an explicit development-time choice, not a final production/beta decision — **production/beta authentication policy will be revisited later** (e.g. whether magic link, password, or both should be user-facing, and whether email confirmation should be required). See "Migration history" below for what was tried before this.

### Flow

```
/login: email + password → signInWithPassword() Server Action
  → supabase.auth.signInWithPassword({ email, password })
  → success: redirect /app (session cookie written by the
    @supabase/ssr server client, src/lib/supabase/server.ts)
  → failure: generic "Invalid email or password." — never the raw
    Supabase error

/signup: email + password → signUp() Server Action
  → supabase.auth.signUp({ email, password })
  → if Supabase returns a session immediately (expected in dev — see
    below): redirect /app
  → if no session and no error (email confirmation is required):
    show "check your email to confirm" instead of crashing or
    redirecting somewhere broken — see Development setup

/app (any page): "Sign out" → signOut() Server Action
  → supabase.auth.signOut() → redirect /login
```

No custom session infrastructure: `@supabase/ssr`, `src/lib/supabase/server.ts`, `src/app/proxy.ts` (session refresh), and `src/app/app/layout.tsx` (`requireSession()` gate) are all unchanged by this — Supabase Auth issues the same session/`auth.uid()` regardless of which sign-in method produced it, so RLS policies are unaffected.

### Development setup (Supabase dashboard)

**Authentication → Providers → Email**:
- **Enable Email provider**: on.
- **Confirm email**: **off**, for development. With it off, `signUp()` returns a session immediately and the new account can sign in right away. If it's ever turned on, `signUp()` still behaves safely (see `needsConfirmation` in `actions.ts`) — but there is currently no route that completes an email confirmation link, since none exists in the development flow. Do not enable email confirmation without also deciding how confirmation links get handled — that's part of the "revisit later" production/beta policy, not implemented yet.

## What exists

- `session.ts` — `getSession()`: reads the current session server-side. `requireSession()`: the shared auth-gate helper — redirects to `/login` when signed out, otherwise returns the session.
- `actions.ts` — `signInWithPassword()`, `signUp()`, `signOut()` Server Actions. Passwords are never logged; only Supabase's own error `code`/`status` are logged on failure, never the raw error message (which can echo input) or the credentials themselves.
- `src/app/login/` — sign-in screen (email + password).
- `src/app/signup/` — minimal account-creation screen.
- `src/app/app/page.tsx` — includes the "Sign out" control (useful for repeatedly testing multiple auth states during development).
- `src/app/app/layout.tsx` — calls `requireSession()`, gating every page under `/app`. Route Handlers and Server Actions under the same path do not inherit a layout's checks in Next.js — each of those calls `requireSession()` itself; see the GitHub connect routes and project actions.

## Migration history

Two approaches were tried and abandoned before landing on email + password, in order:

1. **Magic link + PKCE `exchangeCodeForSession(code)`** (`/auth/callback`, Sprint 0). Turned out to be the production root cause of sign-ins failing with `/login?error=auth`: PKCE requires a code-verifier cookie from the browser that *initiated* the sign-in, which isn't present when a magic link is opened in a different browser/device/session than the one that requested it — extremely common with email links. Removed.
2. **Magic link + `token_hash` + `verifyOtp`** (`/auth/confirm`) — the standard fix for problem #1 (self-contained verification, no code-verifier cookie needed). Implemented, then abandoned before shipping in favor of password auth, specifically because of Supabase's development email rate limits making *any* email-based flow (magic link either way) unreliable for repeated local/E2E testing. Removed — no email-based sign-in route exists in the codebase now.

Both are gone from the codebase, not kept alongside password auth — no dead auth paths.
