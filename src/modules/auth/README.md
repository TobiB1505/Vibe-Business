# modules/auth

Vibe Business's own user authentication, via Supabase Auth ([ADR 0002](../../../docs/decisions/0002-supabase-postgres-and-auth.md)). Separate concern from GitHub repository access ([ADR 0003](../../../docs/decisions/0003-github-app-integration.md)) — this module never talks to GitHub.

## Sprint 0 decision: email magic link, not email+password

Magic link was chosen over email+password for the initial flow:

- No password storage/reset/strength-policy surface to build or secure for a first auth flow.
- Fewer moving parts: the whole flow is a Server Action (`actions.ts`) that calls `supabase.auth.signInWithOtp`, plus a Route Handler (`src/app/auth/callback/route.ts`) that exchanges the emailed code for a session. No browser Supabase client is required for this flow.
- Supabase Auth supports both equally well; magic link is the simpler, equally robust option for a first cut.

Email+password can be added later as an additional method if a concrete need arises — this is not a rejection of it, just the simpler starting point.

## What exists

- `session.ts` — `getSession()`: reads the current session server-side (Server Components, Route Handlers). `requireSession()`: the shared auth-gate helper — redirects to `/login` when signed out, otherwise returns the session.
- `actions.ts` — `signInWithMagicLink()`: Server Action that sends the sign-in email.
- `src/app/login/` — the sign-in screen.
- `src/app/auth/callback/route.ts` — exchanges the magic-link code for a session, then redirects to `/app`.
- `src/app/app/layout.tsx` — calls `requireSession()`, gating every page under `/app` (Sprint 1). Route Handlers and Server Actions under the same path do not inherit a layout's checks in Next.js — each of those calls `requireSession()` itself; see the GitHub connect routes and project actions.
