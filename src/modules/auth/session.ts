import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loginPathWithNext } from "@/modules/auth/redirects";

export type Session = {
  userId: string;
  email: string | null;
};

/**
 * Reads the current Supabase session server-side. Returns null when signed
 * out, and null — never a throw — when the identity cannot be verified.
 *
 * ## Why getClaims() rather than getUser()
 *
 * Both are safe; neither trusts the cookie. `getUser()` asks the Auth server
 * on every single call, which on a page that checks auth in a layout and
 * again in three Server Actions is four network round trips. `getClaims()`
 * verifies the JWT signature against the project's published keys, which for
 * asymmetric signing keys happens locally and for symmetric ones falls back
 * to the same server call `getUser()` would have made. Same guarantee,
 * usually far cheaper.
 *
 * What must never replace either: `getSession()`, which decodes the cookie
 * without verifying its signature. The cookie is attacker-writable, so
 * routing on `getSession()` is routing on a claim the attacker made.
 */
export async function getSession(): Promise<Session | null> {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch (error) {
    // Supabase isn't configured. `/login` and `/signup` now ask about the
    // session in order to redirect visitors who already have one, so throwing
    // here would take down the very screens someone needs in order to notice
    // the problem. Nobody is signed in without configuration anyway — but a
    // deployment that reaches this line is broken, so it says so loudly
    // rather than quietly rendering a signed-out app.
    console.error("[auth.session] Supabase is not configured; treating as signed out.", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }

  let claims: Record<string, unknown> | null = null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error) return null;
    claims = (data?.claims as Record<string, unknown> | undefined) ?? null;
  } catch {
    // Verification is a network call in the symmetric-key case and a JWKS
    // fetch in the asymmetric one. Fail closed: an unverifiable caller is
    // treated as signed out rather than waved through.
    return null;
  }

  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  if (!userId) return null;

  const email = typeof claims?.email === "string" ? claims.email : null;

  return { userId, email };
}

/**
 * The shared auth gate. `/app` itself is protected by
 * src/app/app/layout.tsx, but layouts do not wrap sibling Route Handlers
 * or Server Actions under the same path — those must call this
 * explicitly. Redirects to /login when there is no session; never returns
 * null, so callers don't need their own null-check branch.
 *
 * `requestedPath` is the page the visitor was trying to reach. Pass it from
 * a page or layout so they come back to it after signing in; it is sanitized
 * before it becomes part of the login URL, so passing an untrusted value is
 * safe. Server Actions have no meaningful path to return to and omit it.
 */
export async function requireSession(requestedPath?: string): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect(loginPathWithNext(requestedPath));
  }
  return session;
}
