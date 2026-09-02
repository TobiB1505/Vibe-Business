import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env/env";
import { SUPABASE_REQUEST_TIMEOUT_MS, withBoundedFetch } from "@/lib/net/bounded-fetch";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";
import { loginPathWithNext, sanitizeNextPath } from "@/modules/auth/redirects";

/**
 * Refreshes the Supabase auth session on every matched request, and decides
 * the cheap half of the auth routing.
 *
 * Required by the `@supabase/ssr` cookie-based session model: Server
 * Components cannot write cookies, so without a proxy refreshing them the
 * access token expires and users get signed out mid-session.
 *
 * Runs on every matched request (see the `matcher` in src/proxy.ts), so it
 * must not hard-crash the whole app when Supabase isn't configured yet —
 * that would break every page, not just Supabase-touching ones. Passes the
 * request through unchanged in that case; getPublicEnv() still throws its
 * normal descriptive error wherever a Supabase client is actually used
 * (Server Actions, Route Handlers).
 *
 * ## This is not the security boundary
 *
 * The redirects below exist so a signed-out visitor never renders a frame of
 * `/app`, and so a signed-in visitor never sees a pointless login form. They
 * are UX, and they are the *first* check, not the only one. Authorization is
 * `requireSession()` in `src/app/app/layout.tsx` and in every Server Action
 * and Route Handler that touches user data — see src/modules/auth/session.ts.
 * A proxy alone would be the wrong place to trust: matchers change, edge
 * cases slip through them, and Server Actions do not go through page routing
 * at all.
 */

/** Paths whose *pages* require a session. Kept in sync with the app router. */
const PROTECTED_PREFIX = "/app";

/**
 * Auth screens a signed-in visitor has no reason to see.
 *
 * `/forgot-password` is deliberately absent: someone who is signed in and
 * wants a reset link is making a reasonable request, and bouncing them to
 * `/app` would be the app second-guessing them.
 *
 * `/reset-password` is deliberately absent for a stronger reason — the
 * recovery link signs the user in *in order to* let them set a new password.
 * Redirecting authenticated visitors away from it would break the reset flow
 * at its final step, every time.
 */
const AUTH_ONLY_PATHS = ["/login", "/signup"];

function isProtectedPath(pathname: string): boolean {
  return pathname === PROTECTED_PREFIX || pathname.startsWith(`${PROTECTED_PREFIX}/`);
}

function isAuthOnlyPath(pathname: string): boolean {
  return AUTH_ONLY_PATHS.includes(pathname);
}

export async function updateSession(request: NextRequest) {
  let env;
  try {
    env = getPublicEnv();
  } catch {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      /**
       * The last Supabase client without a deadline had it (PERF-016).
       *
       * `server.ts` and `service.ts` both bound their requests at
       * `SUPABASE_REQUEST_TIMEOUT_MS`; this one did not, and it is the one on
       * the critical path of every matched request in the product. A hung
       * auth socket held a function open with a blank page behind it until the
       * platform's own 300-second ceiling — the failure mode `bounded-fetch`
       * exists to prevent, in the place it costs most.
       *
       * The same 15 seconds, deliberately, rather than something tighter. The
       * `getClaims()` call below fails open, so a deadline short enough to
       * trip on a slow-but-working verification would sign people out — and
       * nothing about a verification that takes longer than fifteen seconds
       * was going to render a page anyway.
       *
       * Without the clock-skew retry `server.ts` installs: that absorbs a
       * first-second failure at the moment a session is created, which is a
       * different request from this one, and adding a retry inside the
       * deadline of every page request is not a bound anybody asked for.
       */
      global: { fetch: withBoundedFetch({ timeoutMs: SUPABASE_REQUEST_TIMEOUT_MS }) },
      cookieOptions: AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
          // `headers` carries Cache-Control / Expires / Pragma from
          // @supabase/ssr. Applying them is not optional: a token refresh
          // writes Set-Cookie onto this response, and Vibe runs behind
          // Vercel's edge cache. A cached response carrying someone's
          // Set-Cookie is one user handed another user's session. Dropping
          // this argument is the single most expensive mistake available in
          // this file.
          Object.entries(headers).forEach(([key, value]) => {
            supabaseResponse.headers.set(key, value);
          });
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims(). Anything that
  // touches cookies in between changes what the refresh sees, and the symptom
  // is users being randomly logged out — which is miserable to debug because
  // it only reproduces once a token is close to expiry.
  //
  // getClaims() verifies the JWT signature rather than trusting the cookie,
  // so its answer is safe to route on. getSession() is not: it decodes
  // without verifying, and the cookie it decodes is attacker-writable.
  let claims: { sub?: string } | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    claims = data?.claims ?? null;
  } catch {
    // Verification needs the Auth server (symmetric signing keys) or its JWKS
    // (asymmetric). Both are network calls, and a blip must not 500 the whole
    // site. Treat it as "not proven signed in" and fall through: protected
    // pages still refuse, because requireSession() runs its own check and
    // fails closed.
    claims = null;
  }

  const signedIn = Boolean(claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && isProtectedPath(pathname)) {
    return redirectPreservingCookies(
      request,
      supabaseResponse,
      loginPathWithNext(`${pathname}${search}`),
    );
  }

  if (signedIn && isAuthOnlyPath(pathname)) {
    const requested = request.nextUrl.searchParams.get("next");
    return redirectPreservingCookies(request, supabaseResponse, sanitizeNextPath(requested));
  }

  // IMPORTANT: `supabaseResponse` is returned as-is. Building a fresh
  // response here without copying the cookies over would let the browser and
  // the server disagree about the current token, which terminates the session
  // early. `redirectPreservingCookies` is the only other exit, and it copies.
  return supabaseResponse;
}

/**
 * Redirects while carrying over everything the session refresh just wrote.
 *
 * A redirect built from scratch drops the refreshed `Set-Cookie` headers, so
 * the browser keeps the old token and the next request has to refresh again —
 * and once a refresh token has been rotated and its replacement dropped, the
 * session is gone for good. The cache headers come along for the same reason
 * they were set in the first place.
 */
function redirectPreservingCookies(
  request: NextRequest,
  carrying: NextResponse,
  destinationPath: string,
): NextResponse {
  // Absolute, unlike the Route Handlers' relative redirects: Next's proxy
  // layer parses this `Location` as a URL and throws ERR_INVALID_URL on a
  // bare path, which turns every guarded request into a 500. `nextUrl` is
  // Next's own resolved request URL, not a client-supplied header, so
  // building on it does not reintroduce host spoofing.
  const url = request.nextUrl.clone();
  const [pathname, queryString] = destinationPath.split("?");
  url.pathname = pathname;
  url.search = queryString ? `?${queryString}` : "";

  const redirectResponse = NextResponse.redirect(url);

  carrying.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });

  // Only the cache directives are copied, not every header. A
  // `NextResponse.next()` response also carries Next.js's own internal
  // routing headers, and replaying those onto a redirect is undefined
  // behaviour rather than a nice-to-have.
  for (const header of CACHE_HEADERS_TO_CARRY) {
    const value = carrying.headers.get(header);
    if (value !== null) redirectResponse.headers.set(header, value);
  }

  return redirectResponse;
}

/**
 * The headers `@supabase/ssr` sets alongside a token refresh. Named
 * explicitly so a redirect carries the "do not cache this" instruction that
 * the response it replaces was carrying.
 */
const CACHE_HEADERS_TO_CARRY = ["cache-control", "expires", "pragma"] as const;
