# lib/supabase

Supabase client helpers, per [ADR 0002](../../../docs/decisions/0002-supabase-postgres-and-auth.md).

- `server.ts` — client for Server Components / Route Handlers / Server Actions. Reads/writes the session via `next/headers` cookies.
- `client.ts` — client for Client Components. Not yet used by any Sprint 0 screen; kept as the documented entry point for future client-side usage.
- `clock-skew.ts` — the `fetch` wrapper `server.ts` installs. Supabase Auth and PostgREST keep separate clocks, and PostgREST refuses a token whose `iat` is ahead of its own (`401 PGRST303`, "JWT issued at future"), so every read in the first second of a session could fail — sign in, error screen, reload, fine. The wrapper waits out the measured disagreement and replays the request. It retries nothing else.
- `proxy.ts` — `updateSession()`, called from [src/proxy.ts](../../proxy.ts) (the Next.js 16 Proxy file convention — formerly Middleware) to refresh the session cookie on every request. With a `src/` layout, Next.js 16.3.0 only picks up `proxy.ts` when it lives inside `src/`, next to `app/` — a plain repo-root `proxy.ts` is silently ignored (verified empirically; see [docs/sprints/0000-application-bootstrap.md](../../../docs/sprints/0000-application-bootstrap.md)).

- `service.ts` — the service-role client, for the two callers that have no session to act under: durable operation execution ([ADR 0013](../../../docs/decisions/0013-durable-operation-execution.md)) and the Stripe webhook ([ADR 0025](../../../docs/decisions/0025-stripe-payment-rail-and-credit-grants.md)). RLS does not apply to it, so every query it makes filters on ownership taken from persisted state — see [CLAUDE.md](../../../CLAUDE.md) rule 53.
