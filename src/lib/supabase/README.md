# lib/supabase

Supabase client helpers, per [ADR 0002](../../../docs/decisions/0002-supabase-postgres-and-auth.md).

- `server.ts` — client for Server Components / Route Handlers / Server Actions. Reads/writes the session via `next/headers` cookies.
- `client.ts` — client for Client Components. Not yet used by any Sprint 0 screen; kept as the documented entry point for future client-side usage.
- `middleware.ts` — `updateSession()`, called from the root `middleware.ts` to refresh the session cookie on every request.

No service-role client exists yet — Sprint 0 has no code path that needs to bypass Row Level Security. Add one only when a concrete feature requires it, per [CLAUDE.md](../../../CLAUDE.md) rule 15.
