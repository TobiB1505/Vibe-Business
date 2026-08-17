import { describe, expect, it, vi } from "vitest";
import {
  authFailureMessage,
  classifyAuthError,
  classifyOAuthCallbackError,
  logAuthFailure,
  messageForAuthError,
  parseFailureParam,
  type AuthFailure,
} from "./errors";

describe("classifyAuthError", () => {
  it.each([
    ["invalid_credentials", "invalid_credentials"],
    ["email_not_confirmed", "email_not_confirmed"],
    ["user_already_exists", "user_already_exists"],
    ["weak_password", "weak_password"],
    ["over_email_send_rate_limit", "rate_limited"],
    ["otp_expired", "expired_link"],
    ["bad_code_verifier", "expired_link"],
  ])("maps Supabase code %s to %s", (code, expected) => {
    expect(classifyAuthError({ code, status: 400 })).toBe(expected);
  });

  it("recognises a fetch that never reached Supabase", () => {
    expect(classifyAuthError({ name: "AuthRetryableFetchError", status: 0 })).toBe("network");
    expect(classifyAuthError(new TypeError("fetch failed"))).toBe("network");
    expect(classifyAuthError({ status: 0 })).toBe("network");
  });

  it("treats a 5xx from the auth server as a reachability problem", () => {
    expect(classifyAuthError({ status: 503 })).toBe("network");
  });

  it("treats 429 as rate limiting even without a code", () => {
    expect(classifyAuthError({ status: 429 })).toBe("rate_limited");
  });

  it("falls back to unknown rather than guessing", () => {
    expect(classifyAuthError(null)).toBe("unknown");
    expect(classifyAuthError(undefined)).toBe("unknown");
    expect(classifyAuthError("a string")).toBe("unknown");
    expect(classifyAuthError({ code: "something_new", status: 418 })).toBe("unknown");
  });
});

describe("classifyOAuthCallbackError", () => {
  it("reads a cancelled consent screen as cancellation", () => {
    expect(classifyOAuthCallbackError("access_denied")).toBe("oauth_cancelled");
    expect(classifyOAuthCallbackError(null, "user_cancelled")).toBe("oauth_cancelled");
  });

  it("reads provider trouble as a retryable OAuth failure", () => {
    expect(classifyOAuthCallbackError("server_error")).toBe("oauth_failed");
    expect(classifyOAuthCallbackError("temporarily_unavailable")).toBe("oauth_failed");
  });

  it("classifies an unrecognised provider error rather than trusting it", () => {
    expect(classifyOAuthCallbackError("brand_new_error_google_invented")).toBe("oauth_failed");
  });

  it("reports unknown when there was no error at all", () => {
    expect(classifyOAuthCallbackError(null, null)).toBe("unknown");
  });
});

describe("user-facing copy", () => {
  const ALL_FAILURES: AuthFailure[] = [
    "invalid_credentials",
    "email_not_confirmed",
    "user_already_exists",
    "weak_password",
    "rate_limited",
    "network",
    "oauth_cancelled",
    "oauth_failed",
    "expired_link",
    "unknown",
  ];

  it("has a sentence for every failure in every context", () => {
    for (const failure of ALL_FAILURES) {
      for (const context of ["sign_in", "sign_up", "recovery"] as const) {
        const message = authFailureMessage(failure, context);
        expect(message.length, `${failure}/${context}`).toBeGreaterThan(0);
        expect(message.endsWith("."), `${failure}/${context} should be a sentence`).toBe(true);
      }
    }
  });

  it("matches the copy the sprint specified", () => {
    expect(authFailureMessage("invalid_credentials")).toBe("Invalid email or password.");
    expect(authFailureMessage("email_not_confirmed")).toBe(
      "Please confirm your email before signing in.",
    );
    expect(authFailureMessage("network")).toBe(
      "We couldn't reach the server. Please try again.",
    );
    expect(authFailureMessage("oauth_cancelled")).toBe("Google sign-in was cancelled.");
    expect(authFailureMessage("unknown")).toBe("We couldn't sign you in. Please try again.");
  });

  /**
   * The property that matters more than any individual string: whatever
   * Supabase said, the user sees one of ours.
   */
  it("never returns provider text, however the error is shaped", () => {
    const hostileErrors = [
      { message: "User victim@example.com not found", code: "user_not_found", status: 400 },
      { message: "invalid_grant: code verifier ABC123", status: 400 },
      { message: "<script>alert(1)</script>", status: 500 },
      new Error("Internal: connection string postgres://user:pw@host"),
    ];

    for (const error of hostileErrors) {
      for (const context of ["sign_in", "sign_up", "recovery"] as const) {
        const message = messageForAuthError(error, context);
        expect(message).not.toContain("victim@example.com");
        expect(message).not.toContain("ABC123");
        expect(message).not.toContain("<script>");
        expect(message).not.toContain("postgres://");
      }
    }
  });

  it("does not say 'sign you in' on a screen where nobody is signing in", () => {
    expect(authFailureMessage("unknown", "sign_up")).toBe(
      "Could not create an account with those details.",
    );
    expect(authFailureMessage("unknown", "recovery")).toBe(
      "We couldn't reset your password. Please try again.",
    );
  });
});

describe("parseFailureParam", () => {
  it("accepts the classifications a callback is allowed to pass through", () => {
    expect(parseFailureParam("oauth_cancelled")).toBe("oauth_cancelled");
    expect(parseFailureParam("oauth_failed")).toBe("oauth_failed");
    expect(parseFailureParam("expired_link")).toBe("expired_link");
  });

  /**
   * The parameter is user-editable, so the worst a tampered value may do is
   * select a different one of our own sentences.
   */
  it("refuses anything outside that set", () => {
    for (const value of [
      "invalid_credentials",
      "<script>alert(1)</script>",
      "Your account was deleted, call this number",
      "",
      null,
      undefined,
      "__proto__",
    ]) {
      expect(parseFailureParam(value)).toBe("unknown");
    }
  });
});

describe("logAuthFailure", () => {
  it("logs the classification and provider code, never the message", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logAuthFailure("signin", {
      message: "Invalid login credentials for victim@example.com",
      code: "invalid_credentials",
      status: 400,
    });

    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("invalid_credentials");
    expect(logged).toContain("400");
    expect(logged).not.toContain("victim@example.com");
    consoleError.mockRestore();
  });

  it("survives being handed something that is not an error at all", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => logAuthFailure("signin", null)).not.toThrow();
    expect(() => logAuthFailure("signin", "boom")).not.toThrow();
    expect(() => logAuthFailure("signin", undefined)).not.toThrow();

    consoleError.mockRestore();
  });
});

describe("logAuthFailure with a known classification", () => {
  it("records the caller's classification instead of re-deriving a wrong one", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // An OAuth callback error is a URL parameter, not a Supabase error, so
    // classifying it from the error shape alone would yield "unknown".
    logAuthFailure("oauth_callback_provider", { code: "access_denied", status: 400 });
    expect(JSON.stringify(consoleError.mock.calls)).toContain('"unknown"');

    consoleError.mockClear();
    logAuthFailure(
      "oauth_callback_provider",
      { code: "access_denied", status: 400 },
      "oauth_cancelled",
    );
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("oauth_cancelled");
    expect(logged).not.toContain('"unknown"');

    consoleError.mockRestore();
  });
});

/**
 * Regression: both lookup tables were object literals, and `"constructor" in
 * {}` is `true`. A crafted `?error=constructor` on the OAuth callback returned
 * `Object` itself as the "classification", which was then stringified into a
 * user-visible redirect as `function Object() { [native code] }`. Verified
 * against a running production build before the fix.
 */
describe("prototype-chain keys are not classifications", () => {
  const PROTOTYPE_KEYS = [
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
    "__defineGetter__",
    "isPrototypeOf",
    "propertyIsEnumerable",
  ];

  it("never lets one through classifyOAuthCallbackError", () => {
    for (const key of PROTOTYPE_KEYS) {
      const failure = classifyOAuthCallbackError(key);
      expect(typeof failure, key).toBe("string");
      expect(failure, key).toBe("oauth_failed");
    }
  });

  it("never lets one through classifyAuthError", () => {
    for (const key of PROTOTYPE_KEYS) {
      const failure = classifyAuthError({ code: key, status: 400 });
      expect(typeof failure, key).toBe("string");
      expect(failure, key).toBe("unknown");
    }
  });

  it("still renders a real sentence for whatever comes back", () => {
    for (const key of PROTOTYPE_KEYS) {
      const message = authFailureMessage(classifyOAuthCallbackError(key));
      expect(message).not.toContain("native code");
      expect(message).not.toContain("[object");
      expect(message.endsWith(".")).toBe(true);
    }
  });
});
