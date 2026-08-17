import { type NextRequest, type NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  classifyOAuthCallbackError,
  logAuthFailure,
  type AuthFailure,
} from "@/modules/auth/errors";
import { internalRedirect, sanitizeNextPath } from "@/modules/auth/redirects";

/**
 * Vibe's own OAuth callback — the *second* of the two redirect legs, and the
 * one people mix up with the first.
 *
 * ```
 * /login  --  signInWithGoogle()
 *         ->  accounts.google.com                     (Google consent)
 *         ->  https://<project-ref>.supabase.co/auth/v1/callback
 *                                                     (leg 1: Google Cloud's
 *                                                      Authorized redirect URI.
 *                                                      Supabase owns it. Vibe
 *                                                      never sees it.)
 *         ->  https://<vibe-domain>/auth/callback     (leg 2: THIS route.
 *                                                      Supabase's `redirectTo`,
 *                                                      allow-listed under Auth
 *                                                      -> URL Configuration.)
 *         ->  /app or the requested `next`
 * ```
 *
 * Putting this route's URL into Google Cloud, or Supabase's provider callback
 * into `redirectTo`, both produce a login that fails at the last step with
 * nothing useful in the logs. They are different URLs owned by different
 * systems.
 *
 * ## Why PKCE is right here and wrong for email links
 *
 * The code verifier lives in a cookie belonging to the browser that started
 * the flow. In OAuth that is guaranteed to be the same browser that comes
 * back, because the whole journey is one navigation. Emailed links are the
 * opposite — people open them on their phone after requesting them on a
 * laptop — which is why `/auth/confirm` uses a self-contained `token_hash`
 * instead. This repository has already paid for that lesson once; see
 * src/modules/auth/README.md.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const next = sanitizeNextPath(searchParams.get("next"));
  const providerError = searchParams.get("error");
  const providerErrorCode = searchParams.get("error_code");
  const code = searchParams.get("code");

  // The provider refused or the user pressed Cancel. Supabase forwards its
  // `error` verbatim; we translate it and never render it.
  if (providerError || providerErrorCode) {
    const failure = classifyOAuthCallbackError(providerError, providerErrorCode);
    logAuthFailure(
      "oauth_callback_provider",
      { code: providerErrorCode ?? providerError, status: 400 },
      failure,
    );
    return failureRedirect(next, failure);
  }

  if (!code) {
    // A callback with neither a code nor an error is not a flow we started —
    // a bare visit to the URL, a truncated link, or a scanner.
    return failureRedirect(next, "oauth_failed");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Wrong or missing code verifier, a replayed code, an expired flow state.
    // Never logged with the code itself — an authorization code is a
    // credential right up until it is spent.
    logAuthFailure("oauth_callback_exchange", error);
    return failureRedirect(next, "oauth_failed");
  }

  return internalRedirect(next);
}

/**
 * Sends the visitor back to the login screen with a classification, never a
 * provider message.
 *
 * `next` is preserved so a failed Google attempt does not also lose the page
 * they were originally trying to reach — retrying with email should still
 * land them there.
 */
function failureRedirect(next: string, failure: AuthFailure): NextResponse {
  const params = new URLSearchParams({ error: failure });
  if (next !== "/app") params.set("next", next);
  return internalRedirect(`/login?${params.toString()}`);
}
