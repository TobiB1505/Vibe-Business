import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env/env";

/**
 * Refreshes the Supabase auth session cookie on every matched request.
 * Required by the @supabase/ssr cookie-based session model so that
 * Server Components always see an up-to-date session. Does not gate
 * any route in Sprint 0 — see src/modules/auth/README.md.
 *
 * Runs on every matched request (see the `matcher` in src/proxy.ts), so it
 * must not hard-crash the whole app when Supabase isn't configured yet —
 * that would break every page, not just Supabase-touching ones. Passes the
 * request through unchanged in that case; getPublicEnv() still throws its
 * normal descriptive error wherever a Supabase client is actually used
 * (Server Actions, Route Handlers).
 */
export async function updateSession(request: NextRequest) {
  let env;
  try {
    env = getPublicEnv();
  } catch {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getUser();

  return supabaseResponse;
}
