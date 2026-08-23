import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env/env";
import { withJwtClockSkewRetry } from "@/lib/supabase/clock-skew";

/**
 * Supabase client for Server Components, Route Handlers, and Server Actions.
 * Reads/writes the auth session via request cookies. Never import this from
 * a Client Component — `next/headers` already prevents that at build time.
 */
export async function createClient() {
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
       */
      global: { fetch: withJwtClockSkewRetry() },
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
