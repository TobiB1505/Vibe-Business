/**
 * The one place a raw auth failure becomes something a person reads.
 *
 * ## Why nothing raw reaches the screen
 *
 * Two separate reasons, and both matter.
 *
 * Security: Supabase error messages sometimes echo the input that caused
 * them, and the difference between "no user with this email" and "wrong
 * password" is an account-enumeration oracle. Classifying first and rendering
 * from a fixed table means the screen cannot accidentally start distinguishing
 * cases we decided not to distinguish.
 *
 * Product: `AuthApiError: invalid_grant (400)` tells a founder nothing they
 * can act on. Every message here names what happened and what to do next.
 *
 * The classification is deliberately separate from the copy: server logs get
 * the machine-readable reason, the browser gets the sentence, and the two
 * never have to be kept in sync by hand.
 */

/** What went wrong, in terms the application decides — never the provider's. */
export type AuthFailure =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "user_already_exists"
  | "weak_password"
  | "rate_limited"
  | "network"
  | "oauth_cancelled"
  | "oauth_failed"
  | "expired_link"
  | "unknown";

/** The shape of the parts of a Supabase `AuthError` this module reads. */
type SupabaseishError = {
  code?: string | null;
  status?: number | null;
  name?: string | null;
  message?: string | null;
};

/**
 * Supabase error codes mapped to our vocabulary.
 *
 * Codes are used in preference to messages because messages are prose that
 * changes between releases, while `code` is API surface.
 *
 * A `Map` rather than an object literal, deliberately. `"constructor" in {}`
 * is `true`, so an object-literal lookup answers for every key on
 * `Object.prototype` and returns a function where a classification was
 * expected. That is reachable from a crafted URL on the OAuth callback below,
 * and it was: `?error=constructor` put `function Object() { [native code] }`
 * into a user-visible redirect. A Map has no prototype keys to inherit.
 */
const CODE_TO_FAILURE = new Map<string, AuthFailure>(Object.entries({
  invalid_credentials: "invalid_credentials",
  email_not_confirmed: "email_not_confirmed",
  phone_not_confirmed: "email_not_confirmed",
  user_already_exists: "user_already_exists",
  email_exists: "user_already_exists",
  weak_password: "weak_password",
  over_request_rate_limit: "rate_limited",
  over_email_send_rate_limit: "rate_limited",
  otp_expired: "expired_link",
  flow_state_expired: "expired_link",
  flow_state_not_found: "expired_link",
  bad_code_verifier: "expired_link",
  validation_failed: "invalid_credentials",
}));

/**
 * OAuth `error` values a provider can put on the callback URL.
 *
 * `access_denied` is overwhelmingly the user pressing Cancel on the consent
 * screen, so it gets its own non-alarming message rather than being folded
 * into a generic failure.
 */
const OAUTH_ERROR_TO_FAILURE = new Map<string, AuthFailure>(Object.entries({
  access_denied: "oauth_cancelled",
  user_cancelled: "oauth_cancelled",
  consent_required: "oauth_cancelled",
  server_error: "oauth_failed",
  temporarily_unavailable: "oauth_failed",
  invalid_request: "oauth_failed",
  unauthorized_client: "oauth_failed",
  invalid_scope: "oauth_failed",
}));

/** Classifies a Supabase auth error without ever reading its message as copy. */
export function classifyAuthError(error: unknown): AuthFailure {
  if (!error || typeof error !== "object") return "unknown";

  const candidate = error as SupabaseishError;

  const code = typeof candidate.code === "string" ? candidate.code : null;
  const mapped = code ? CODE_TO_FAILURE.get(code) : undefined;
  if (mapped) return mapped;

  // A fetch that never reached Supabase has no code. supabase-js surfaces it
  // as AuthRetryableFetchError, and a bare TypeError is what `fetch` throws
  // when DNS or the connection fails.
  const name = typeof candidate.name === "string" ? candidate.name : "";
  if (name === "AuthRetryableFetchError" || name === "TypeError") return "network";
  if (candidate.status === 0) return "network";

  // 5xx from the Auth server is not the user's problem and retrying is the
  // right advice, so it reads as a reachability problem.
  if (typeof candidate.status === "number" && candidate.status >= 500) return "network";

  if (candidate.status === 429) return "rate_limited";
  if (candidate.status === 400 && !code) return "invalid_credentials";

  return "unknown";
}

/** Classifies the `error` / `error_code` parameters on an OAuth callback URL. */
export function classifyOAuthCallbackError(
  error: string | null,
  errorCode?: string | null,
): AuthFailure {
  for (const value of [error, errorCode]) {
    if (typeof value !== "string") continue;
    const mapped = OAUTH_ERROR_TO_FAILURE.get(value);
    if (mapped) return mapped;
  }
  return error || errorCode ? "oauth_failed" : "unknown";
}

/**
 * The user-facing sentence for a classified failure.
 *
 * `invalid_credentials` says "email or password" on purpose: naming which one
 * was wrong would confirm whether an account exists for that address.
 */
const SIGN_IN_COPY: Record<AuthFailure, string> = {
  invalid_credentials: "Invalid email or password.",
  email_not_confirmed: "Please confirm your email before signing in.",
  // Deliberately says nothing about the address. "An account already exists
  // for this email" is a free account-enumeration oracle on a form that
  // accepts unauthenticated input, and Supabase itself obfuscates this case
  // rather than confirming it.
  user_already_exists: "We couldn't sign you in. Please try again.",
  // No number here on purpose (VB-037). This copy answers a refusal that came
  // from Supabase, whose minimum is a dashboard setting — so naming a length
  // would be this file guessing at somebody else's rule and being wrong the
  // moment it changes. The reset form states its own minimum, which it owns.
  weak_password: "Choose a longer password.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  network: "We couldn't reach the server. Please try again.",
  oauth_cancelled: "Google sign-in was cancelled.",
  oauth_failed: "We couldn't sign you in with Google. Please try again.",
  expired_link: "That link has expired or was already used. Request a new one.",
  unknown: "We couldn't sign you in. Please try again.",
};

/**
 * Sign-up needs different copy for the same classifications: "We couldn't
 * sign you in" is wrong on a screen where nobody was signing in.
 */
const SIGN_UP_OVERRIDES: Partial<Record<AuthFailure, string>> = {
  invalid_credentials: "Could not create an account with those details.",
  user_already_exists: "Could not create an account with those details.",
  unknown: "Could not create an account with those details.",
};

/** Password recovery is its own context — the user is not signing in yet. */
const RECOVERY_OVERRIDES: Partial<Record<AuthFailure, string>> = {
  invalid_credentials: "That reset link is no longer valid. Request a new one.",
  expired_link: "That reset link has expired or was already used. Request a new one.",
  unknown: "We couldn't reset your password. Please try again.",
};

export type AuthCopyContext = "sign_in" | "sign_up" | "recovery";

/** Maps a classified failure to the sentence shown for a given screen. */
export function authFailureMessage(
  failure: AuthFailure,
  context: AuthCopyContext = "sign_in",
): string {
  if (context === "sign_up") return SIGN_UP_OVERRIDES[failure] ?? SIGN_IN_COPY[failure];
  if (context === "recovery") return RECOVERY_OVERRIDES[failure] ?? SIGN_IN_COPY[failure];
  return SIGN_IN_COPY[failure];
}

/** Convenience for the common path: classify a Supabase error and render it. */
export function messageForAuthError(
  error: unknown,
  context: AuthCopyContext = "sign_in",
): string {
  return authFailureMessage(classifyAuthError(error), context);
}

/**
 * The failure classifications a callback route may pass through the URL.
 *
 * The callback redirects to a screen that has to say *something*, and the
 * only channel between them is a query parameter — which the user can edit.
 * Restricting it to this set means a tampered parameter can at worst select a
 * different one of our own sentences, never inject text of its own.
 */
const PASSABLE_FAILURES = new Set<AuthFailure>([
  "oauth_cancelled",
  "oauth_failed",
  "expired_link",
  "network",
  "unknown",
]);

/** Narrows an untrusted `?error=` parameter back to a known failure. */
export function parseFailureParam(value: string | null | undefined): AuthFailure {
  if (typeof value === "string" && PASSABLE_FAILURES.has(value as AuthFailure)) {
    return value as AuthFailure;
  }
  return "unknown";
}

/**
 * Logs an auth failure with enough to debug it and nothing that could leak.
 *
 * Explicitly excluded: the error's own message (which can echo the submitted
 * email), passwords, tokens, authorization codes and cookies. What is kept is
 * our classification plus the provider's own code and HTTP status, none of
 * which carry user input.
 */
export function logAuthFailure(
  context: string,
  error: unknown,
  /**
   * The classification to record, when the caller already has one.
   *
   * OAuth callback failures arrive as URL parameters rather than as Supabase
   * errors, so re-deriving the class from the error shape logs `unknown` for
   * a case we had in fact identified — which is exactly the log you do not
   * want at 3am.
   */
  knownFailure?: AuthFailure,
): void {
  const candidate = (error ?? {}) as SupabaseishError;
  console.error(`[auth.${context}]`, {
    failure: knownFailure ?? classifyAuthError(error),
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    status: typeof candidate.status === "number" ? candidate.status : undefined,
  });
}
