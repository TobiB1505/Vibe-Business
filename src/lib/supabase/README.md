# lib/supabase

Supabase client helpers, per [ADR 0002](../../../docs/decisions/0002-supabase-postgres-and-auth.md).

- `server.ts` — client for Server Components / Route Handlers / Server Actions. Reads/writes the session via `next/headers` cookies.
- `client.ts` — client for Client Components. Not yet used by any Sprint 0 screen; kept as the documented entry point for future client-side usage.
- `proxy.ts` — `updateSession()`, called from [src/proxy.ts](../../proxy.ts) (the Next.js 16 Proxy file convention — formerly Middleware) to refresh the session cookie on every request. With a `src/` layout, Next.js 16.3.0 only picks up `proxy.ts` when it lives inside `src/`, next to `app/` — a plain repo-root `proxy.ts` is silently ignored (verified empirically; see [docs/sprints/0000-application-bootstrap.md](../../../docs/sprints/0000-application-bootstrap.md)).

No service-role client exists yet — Sprint 0 has no code path that needs to bypass Row Level Security. Add one only when a concrete feature requires it, per [CLAUDE.md](../../../CLAUDE.md) rule 15.
