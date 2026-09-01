import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env/env";
import { SUPABASE_REQUEST_TIMEOUT_MS, withBoundedFetch } from "@/lib/net/bounded-fetch";
import { withJwtClockSkewRetry } from "@/lib/supabase/clock-skew";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

/**
 * Supabase client for Server Components, Route Handlers, and Server Actions.
 * Reads/writes the auth session via request cookies. Never import this from
 * a Client Component — `next/headers` already prevents that at build time.
 *
 * ## One client per request (PERF-013)
 *
 * Every caller used to construct its own. That is invisible where it happens
 * and expensive where it accumulates: a project route resolves ownership in
 * its layout and again in the page — deliberately, because an App Router
 * layout does not gate the routes beneath it — so the same project row was
 * read twice per navigation, three times on the Agent route. The read models
 * that already memoize with `cache()` could not help, because `cache()` is
 * keyed on its arguments and the client *is* an argument: two clients meant
 * two cache entries for the same question.
 *
 * ## Why `cache()` here, when this repository turned it down elsewhere
 *
 * `business-audit/service.ts` rejected `cache()` for the evidence pack and was
 * right to: there the duplication was inside one render, the value could be
 * passed explicitly, and passing it is checkable by counting reads. None of
 * that holds here. A layout and a page render independently, so there is no
 * call site that could hand the client from one to the other — memoizing per
 * request is not the easier fix, it is the only one.
 *
 * ## Why it is safe
 *
 * Within one request the cookies do not change, so neither does the session
 * this client acts under; the ownership checks are unaffected, because each
 * route still performs its own — they simply stop paying for a second
 * connection to ask the same question. Outside a render `cache()` passes
 * straight through, so nothing is shared between requests. And durable
 * execution never reaches this function at all: a workflow step has no session
 * and uses `createServiceClient`.
 *
 * ## What is not proved
 *
 * No test covers the memoization, and none can: `cache()` only memoizes inside
 * a React request scope, and this repository's test environment is Node. What
 * would show it is the read count in production — one `projects` row per
 * project navigation instead of two — which is visible in Supabase's edge logs
 * without instrumenting anything.
 */
export const createClient = cache(createRequestClient);

async function createRequestClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      /**
       * Every request this client makes goes through the clock-skew retry.
       * It is installed here rather than at a call site because the failure it
       * absorbs belongs to the session's first second, not to any one query —
       * see src/lib/supabase/clock-skew.ts.
       *
       * The deadline wraps it rather than the other way round (VB-031), so the
       * bound covers the whole sequence including the skew retry's own wait.
       * Inverted, a clock-skew retry could restart the clock indefinitely and
       * the timeout would bound nothing.
       */
      global: {
        fetch: withBoundedFetch(
          { timeoutMs: SUPABASE_REQUEST_TIMEOUT_MS },
          withJwtClockSkewRetry(),
        ),
      },
      cookieOptions: AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        /**
         * The second argument is the cache headers @supabase/ssr wants on any
         * response that carries a refreshed token. They are intentionally not
         * applied here: this client runs where there is no response object to
         * set headers on. `src/lib/supabase/proxy.ts` applies them on every
         * matched request, which is the response that actually reaches a CDN.
         */
        setAll(cookiesToSet, _headers) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component during render, where cookies
            // cannot be written. Safe to ignore: src/proxy.ts refreshes the
            // session on every request (see src/lib/supabase/proxy.ts).
          }
        },
      },
    },
  );
}
