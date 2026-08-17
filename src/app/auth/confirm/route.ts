import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, type NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAuthFailure, type AuthFailure } from "@/modules/auth/errors";
import { internalRedirect, sanitizeNextPath } from "@/modules/auth/redirects";

/**
 * The endpoint every emailed auth link lands on: signup confirmation, email
 * change, and password recovery.
 *
 * ## Why `token_hash` + verifyOtp rather than the PKCE code exchange
 *
 * Because email links get opened in a different browser than the one that
 * asked for them — requested on a laptop, opened on a phone. PKCE stores its
 * code verifier in a cookie belonging to the requesting browser, so the
 * exchange fails for exactly the users who did nothing wrong. This repository
 * shipped that bug once already and diagnosed it as the production cause of
 * `/login?error=auth`; see src/modules/auth/README.md.
 *
 * `verifyOtp` carries everything it needs in the link itself, so it works from
 * any browser, on any device, once.
 *
 * ## Requires an email template change
 *
 * Supabase's default templates send `{{ .ConfirmationURL }}`, which uses the
 * PKCE leg. The templates must point here with a token hash instead — see
 * docs/setup/supabase-auth.md. Until they do, links keep using the old flow
 * and this route simply never receives them.
 */

/** Email OTP types this route is willing to verify. */
const ACCEPTED_TYPES = new Set<EmailOtpType>([
  "signup",
  "email",
  "email_change",
  "recovery",
  "invite",
  "magiclink",
]);

function parseOtpType(raw: string | null): EmailOtpType | null {
  if (raw && ACCEPTED_TYPES.has(raw as EmailOtpType)) return raw as EmailOtpType;
  return null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const tokenHash = searchParams.get("token_hash");
  const type = parseOtpType(searchParams.get("type"));
  const requestedNext = sanitizeNextPath(searchParams.get("next"));

  // Supabase can also bounce here with an error instead of a token, e.g. when
  // the link had already expired before it was even followed.
  if (searchParams.get("error") || searchParams.get("error_code")) {
    return failureRedirect("expired_link", type);
  }

  if (!tokenHash || !type) {
    return failureRedirect("expired_link", type);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    // Expired, already used, or tampered with. All three are the same thing
    // to the person holding the link: get a new one.
    logAuthFailure("email_link_verify", error);
    return failureRedirect("expired_link", type);
  }

  // A recovery link's job is finished the moment it produces a session — the
  // next step is choosing a new password, not landing in the workspace.
  const destination = type === "recovery" ? "/reset-password" : requestedNext;

  // The destination is a fresh path rather than the incoming URL with
  // parameters stripped, so the one-time token cannot survive into the
  // address bar, the browser history, or a referrer header.
  return internalRedirect(destination);
}

function failureRedirect(failure: AuthFailure, type: EmailOtpType | null): NextResponse {
  // A dead recovery link belongs on the screen that can issue a new one;
  // everything else belongs on the login screen.
  const path = type === "recovery" ? "/forgot-password" : "/login";
  return internalRedirect(`${path}?error=${encodeURIComponent(failure)}`);
}
