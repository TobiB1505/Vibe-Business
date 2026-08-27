"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { recordAuthAttempt, throttleMessage } from "@/modules/auth/throttle";
import {
  authFailureMessage,
  classifyAuthError,
  logAuthFailure,
  messageForAuthError,
} from "@/modules/auth/errors";
import { DEFAULT_POST_AUTH_PATH, sanitizeNextPath } from "@/modules/auth/redirects";

function parseCredentials(formData: FormData): { email: string; password: string } | null {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || !email.includes("@")) return null;
  if (typeof password !== "string" || password.length === 0) return null;
  return { email, password };
}

/** The `next` field every auth form carries, reduced to a safe internal path. */
function requestedDestination(formData: FormData): string {
  const raw = formData.get("next");
  return sanitizeNextPath(typeof raw === "string" ? raw : null);
}

/**
 * The origin this request arrived on, for building absolute callback URLs.
 *
 * Derived from headers rather than configuration so localhost, every preview
 * deployment and production all work without another environment variable to
 * forget. `Host` is client-controllable in principle — but the value only
 * ever leaves here as Supabase's `redirectTo`, and Supabase refuses any
 * `redirectTo` that isn't on its own Redirect URLs allow list. A spoofed host
 * therefore produces a rejected sign-in, not a redirect to an attacker.
 */
async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const forwardedHost = headerList.get("x-forwarded-host");
  const host = forwardedHost ?? headerList.get("host") ?? "localhost:3000";
  const protocol =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export type SignInResult = { ok: false; error: string };

/**
 * Email + password sign-in.
 *
 * Returns only a failure shape: success never returns, because it redirects.
 * The redirect happens after Supabase has confirmed the credentials and the
 * session cookie has been written, so there is no window where the browser
 * has navigated but the session has not landed.
 */
export async function signInWithPassword(
  _prevState: SignInResult | null,
  formData: FormData,
): Promise<SignInResult> {
  const credentials = parseCredentials(formData);
  const destination = requestedDestination(formData);

  if (!credentials) {
    return { ok: false, error: "Enter your email and password." };
  }

  const supabase = await createClient();

  // VB-010, and the order is the whole point: a throttled account is refused
  // *before* the password reaches the auth provider. Recording the outcome
  // afterwards and reporting it would leave every attempt still being made,
  // which bounds nothing.
  const gate = await recordAuthAttempt({ identifier: credentials.email, succeeded: null });
  if (!gate.allowed) {
    return { ok: false, error: throttleMessage(gate.retryAfterSeconds) };
  }

  const { error } = await supabase.auth.signInWithPassword(credentials);

  // A success clears the window; a failure spends one of its allowance. The
  // throttle brings its own privileged client (ADR 0060) — the cookie-scoped
  // one above cannot reach the function at all any more.
  const throttle = await recordAuthAttempt({ identifier: credentials.email, succeeded: !error });

  if (error) {
    logAuthFailure("signin", error);
    return {
      ok: false,
      // Once the account is throttled, whether this password was also wrong is
      // not information worth handing back.
      error: throttle.allowed
        ? messageForAuthError(error, "sign_in")
        : throttleMessage(throttle.retryAfterSeconds),
    };
  }

  redirect(destination);
}

export type SignUpResult =
  | { ok: true; needsConfirmation: boolean }
  | { ok: false; error: string };

/**
 * Account creation.
 *
 * Supabase returns a session immediately when "Confirm email" is off, and no
 * session and no error when it is on. Both are success; only the second needs
 * the user to go and check their inbox, and `emailRedirectTo` is what makes
 * that link come back to a route that can complete it.
 */
export async function signUp(
  _prevState: SignUpResult | null,
  formData: FormData,
): Promise<SignUpResult> {
  const credentials = parseCredentials(formData);
  const destination = requestedDestination(formData);

  if (!credentials) {
    return { ok: false, error: "Enter your email and password." };
  }

  const origin = await requestOrigin();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...credentials,
    options: {
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(destination)}`,
    },
  });

  if (error) {
    logAuthFailure("signup", error);
    return { ok: false, error: messageForAuthError(error, "sign_up") };
  }

  if (data.session) {
    redirect(destination);
  }

  return { ok: true, needsConfirmation: true };
}

export type OAuthStartResult = { ok: false; error: string };

/**
 * Starts Google sign-in.
 *
 * Runs server-side so the PKCE code verifier is written as an HTTP cookie by
 * the same `@supabase/ssr` client that will later read it in
 * `/auth/callback`. `skipBrowserRedirect` is set because there is no browser
 * here to redirect — we take the URL Supabase computes and issue the
 * navigation ourselves.
 *
 * Vibe builds no part of the Google URL itself. Doing so would mean owning
 * scope strings, state and PKCE parameters that Supabase already owns, and
 * two implementations of an OAuth flow is one more than anyone should
 * maintain.
 */
export async function signInWithGoogle(
  _prevState: OAuthStartResult | null,
  formData: FormData,
): Promise<OAuthStartResult> {
  const destination = requestedDestination(formData);
  const origin = await requestOrigin();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(destination)}`,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) {
    logAuthFailure("oauth_start_google", error);
    return { ok: false, error: authFailureMessage("oauth_failed", "sign_in") };
  }

  redirect(data.url);
}

export type PasswordResetRequestResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Sends a password reset link.
 *
 * ## Why this reports success even when it failed
 *
 * Because the alternative tells an attacker which email addresses have
 * accounts. "No user with this email" and "Check your inbox" are different
 * answers to "does tobi@example.com bank here", and the screen must not be
 * able to answer that question — so the only failure surfaced is one that
 * says nothing about the address: a malformed input, or our own inability to
 * reach Supabase at all.
 *
 * The real outcome is still logged server-side, classified, without the
 * address.
 */
export async function requestPasswordReset(
  _prevState: PasswordResetRequestResult | null,
  formData: FormData,
): Promise<PasswordResetRequestResult> {
  const email = formData.get("email");
  if (typeof email !== "string" || !email.includes("@")) {
    return { ok: false, error: "Enter the email address you signed up with." };
  }

  const origin = await requestOrigin();
  const supabase = await createClient();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=%2Fapp&flow=recovery`,
  });

  if (error) {
    logAuthFailure("password_reset_request", error);

    // Rate limiting and unreachability are properties of *us*, not of whether
    // the address exists, so they are safe — and useful — to surface.
    const failure = classifyAuthError(error);
    if (failure === "network" || failure === "rate_limited") {
      return { ok: false, error: authFailureMessage(failure, "recovery") };
    }
  }

  return { ok: true };
}

export type PasswordUpdateResult =
  | { ok: false; error: string };

/**
 * Sets a new password for the user in the current recovery session.
 *
 * There is no token parameter here on purpose. `/auth/confirm` has already
 * turned the emailed one-time token into a real session, so this is an
 * ordinary authenticated operation — which also means a stranger with the
 * URL but no session cannot reach it.
 */
export async function updatePassword(
  _prevState: PasswordUpdateResult | null,
  formData: FormData,
): Promise<PasswordUpdateResult> {
  const password = formData.get("password");
  const confirmation = formData.get("password_confirmation");

  if (typeof password !== "string" || password.length < 6) {
    return { ok: false, error: "Choose a password with at least 6 characters." };
  }
  if (typeof confirmation === "string" && confirmation !== password) {
    return { ok: false, error: "Both passwords need to match." };
  }

  const supabase = await createClient();

  // Without a session there is nothing to update — which is what a stale or
  // already-used recovery link looks like by the time it reaches this action.
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) {
    return {
      ok: false,
      error: authFailureMessage("expired_link", "recovery"),
    };
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    logAuthFailure("password_update", error);
    return { ok: false, error: messageForAuthError(error, "recovery") };
  }

  redirect(DEFAULT_POST_AUTH_PATH);
}

/**
 * Ends the session.
 *
 * `scope: "global"` revokes the refresh token server-side rather than only
 * dropping this browser's cookie, so a copy of the session that leaked
 * elsewhere stops working too. Failure is logged but not surfaced: there is
 * no useful thing for someone pressing "Sign out" to do about it, and the
 * cookie clearing happens either way.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "global" });

  if (error) {
    logAuthFailure("signout", error);
  }

  redirect("/login");
}
