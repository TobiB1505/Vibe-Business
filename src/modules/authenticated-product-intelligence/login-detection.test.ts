import { describe, expect, it } from "vitest";

import {
  CONSECUTIVE_SIGNED_IN_PROBES,
  detectSignedIn,
  isAuthPath,
  probePathFor,
  sanitizeSignInProbe,
  shouldStartUnprompted,
  signInProbeScript,
  type SignInProbe,
} from "./login-detection";

const ORIGIN = "https://app.example.com";

function probe(overrides: Partial<SignInProbe> = {}): SignInProbe {
  return {
    path: "/app",
    passwordFieldPresent: false,
    signOutAffordancePresent: false,
    accountAffordancePresent: false,
    hasAppShell: false,
    ...overrides,
  };
}

describe("detectSignedIn", () => {
  it("treats a sign-out affordance as proof", () => {
    expect(detectSignedIn(probe({ signOutAffordancePresent: true }))).toEqual({
      signedIn: true,
      reason: "sign_out_offered",
    });
  });

  it("accepts an application shell with an account affordance", () => {
    expect(detectSignedIn(probe({ hasAppShell: true, accountAffordancePresent: true }))).toEqual({
      signedIn: true,
      reason: "app_shell_and_account",
    });
  });

  it("refuses an application shell on its own", () => {
    // A marketing page has a nav too.
    expect(detectSignedIn(probe({ hasAppShell: true }))).toEqual({
      signedIn: false,
      reason: "no_signal",
    });
  });

  it("refuses while a password field is on screen, even beside a sign-out link", () => {
    // The costly mistake is starting early, so the counter-signal wins. This
    // reads a "change password" screen as not-signed-in, and that is the
    // direction the error is allowed to point.
    const verdict = detectSignedIn(
      probe({ passwordFieldPresent: true, signOutAffordancePresent: true, hasAppShell: true }),
    );
    expect(verdict).toEqual({ signedIn: false, reason: "password_field_present" });
  });

  it("refuses on an auth path however finished the page looks", () => {
    for (const path of ["/login", "/sign-up", "/auth/callback", "/verify/email", "/reset-password"]) {
      const verdict = detectSignedIn(
        probe({ path, signOutAffordancePresent: true, hasAppShell: true, accountAffordancePresent: true }),
      );
      expect(verdict).toEqual({ signedIn: false, reason: "on_auth_path" });
    }
  });

  it("refuses when the browser is not on the project's origin", () => {
    expect(detectSignedIn(probe({ path: null, signOutAffordancePresent: true }))).toEqual({
      signedIn: false,
      reason: "off_origin",
    });
  });
});

describe("isAuthPath", () => {
  it("covers the pages a founder passes through, not only the login form", () => {
    expect(isAuthPath("/auth/callback")).toBe(true);
    expect(isAuthPath("/account/mfa")).toBe(true);
    expect(isAuthPath("/forgot-password")).toBe(true);
  });

  it("does not swallow ordinary product paths", () => {
    for (const path of ["/app", "/app/projects", "/app/settings", "/app/billing", "/"]) {
      expect(isAuthPath(path)).toBe(false);
    }
  });
});

describe("probePathFor", () => {
  it("returns the path for a URL on the project's origin", () => {
    expect(probePathFor(`${ORIGIN}/app/projects?token=abc#x`, ORIGIN)).toBe("/app/projects");
  });

  it("returns null for an identity provider the founder is mid-flow on", () => {
    expect(probePathFor("https://accounts.google.com/o/oauth2/consent", ORIGIN)).toBeNull();
  });
});

describe("sanitizeSignInProbe", () => {
  it("accepts only literal booleans", () => {
    const sanitized = sanitizeSignInProbe(
      {
        // A hostile page returning a truthy non-boolean must not be able to
        // *clear* the one signal that holds the scan back.
        passwordFieldPresent: "no",
        signOutAffordancePresent: 1,
        accountAffordancePresent: {},
        hasAppShell: true,
      },
      "/app",
    );

    expect(sanitized).toEqual({
      path: "/app",
      passwordFieldPresent: false,
      signOutAffordancePresent: false,
      accountAffordancePresent: false,
      hasAppShell: true,
    });
  });

  it("has no field that could carry a credential", () => {
    const sanitized = sanitizeSignInProbe(
      { passwordFieldPresent: true, signOutAffordancePresent: false, accountAffordancePresent: false, hasAppShell: false },
      "/login",
    );

    expect(Object.values(sanitized).every((value) => typeof value === "boolean" || typeof value === "string")).toBe(true);
    expect(JSON.stringify(sanitized)).not.toMatch(/value|password=|secret/i);
  });
});

describe("signInProbeScript", () => {
  it("never reads a password field's value", () => {
    // The script is reviewed as source here, the same way `guard-program.ts`
    // asserts its own absence of interpolation. A change that returns the
    // element rather than a boolean is what this catches.
    const source = signInProbeScript.toString();
    // Quote style survives no transpiler, so the assertion is written around it.
    expect(source).toMatch(/querySelector\(["']input\[type=password\]["']\)\s*!==\s*null/);
    expect(source).not.toMatch(/\.value/);
  });
});

describe("shouldStartUnprompted", () => {
  it("needs consecutive readings, not just one", () => {
    expect(shouldStartUnprompted([true])).toBe(false);
    expect(shouldStartUnprompted([true, true])).toBe(true);
    expect(CONSECUTIVE_SIGNED_IN_PROBES).toBe(2);
  });

  it("does not count a positive that a negative has since interrupted", () => {
    // The shell-before-session-check window: one reading looks signed in, the
    // next is the bounce back to `/login`.
    expect(shouldStartUnprompted([true, false])).toBe(false);
    expect(shouldStartUnprompted([true, true, false])).toBe(false);
    expect(shouldStartUnprompted([true, false, true])).toBe(false);
  });

  it("starts once the run is genuinely stable", () => {
    expect(shouldStartUnprompted([false, true, true])).toBe(true);
  });
});
