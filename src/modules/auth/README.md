# modules/auth

Vibe Business's own user authentication, via Supabase Auth ([ADR 0002](../../../docs/decisions/0002-supabase-postgres-and-auth.md)). Separate concern from GitHub repository access ([ADR 0003](../../../docs/decisions/0003-github-app-integration.md)) — this module never talks to GitHub.

## Sprint 0 decision: email magic link, not email+password

Magic link was chosen over email+password for the initial flow:

- No password storage/reset/strength-policy surface to build or secure for a first auth flow.
- Fewer moving parts: the whole flow is a Server Action (`actions.ts`) that calls `supabase.auth.signInWithOtp`, plus a Route Handler (`src/app/auth/callback/route.ts`) that exchanges the emailed code for a session. No browser Supabase client is required for this flow.
- Supabase Auth supports both equally well; magic link is the simpler, equally robust option for a first cut.

Email+password can be added later as an additional method if a concrete need arises — this is not a rejection of it, just the simpler starting point.

## What exists

- `session.ts` — `getSession()`: reads the current session server-side (Server Components, Route Handlers).
- `actions.ts` — `signInWithMagicLink()`: Server Action that sends the sign-in email.
- `src/app/login/` — the sign-in screen.
- `src/app/auth/callback/route.ts` — exchanges the magic-link code for a session, then redirects to `/app`.

## What does not exist yet

`/app` does **not** enforce the session — it renders regardless of auth state. Gating `/app` behind a real session check is intentionally deferred past Sprint 0 (see the sprint document), so the shell stays viewable and testable without a configured Supabase project. `getSession()` exists and works; wiring it into a redirect/guard is future work.
