import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GITHUB_AUTH_ENV, githubAuthEnabled } from "./providers";

/**
 * GitHub sign-in is prepared, and off until it is configured (UI-19).
 *
 * ## What this exists to catch
 *
 * A "Continue with GitHub" button that fails because a provider is disabled in
 * a dashboard nobody on the screen can reach. Enabling it is two steps in one
 * order — the Supabase provider first, this flag second — and a button that
 * ships ahead of either is worse than no button.
 */
describe("the GitHub provider flag", () => {
  it("is off unless the deployment says otherwise", () => {
    expect(githubAuthEnabled({})).toBe(false);
    expect(githubAuthEnabled({ [GITHUB_AUTH_ENV]: "" })).toBe(false);
    expect(githubAuthEnabled({ [GITHUB_AUTH_ENV]: "true" })).toBe(false);
    expect(githubAuthEnabled({ [GITHUB_AUTH_ENV]: "0" })).toBe(false);
  });

  it("is on for exactly one value", () => {
    expect(githubAuthEnabled({ [GITHUB_AUTH_ENV]: "1" })).toBe(true);
    expect(githubAuthEnabled({ [GITHUB_AUTH_ENV]: " 1 " })).toBe(true);
  });

  /**
   * CLAUDE.md rule 78 forbids gating a capability on an environment variable
   * *nothing documents*. Both halves matter, and this is the half a test can
   * check.
   */
  it("is written down where a deployment is configured", () => {
    const doc = readFileSync("docs/deployment/environment.md", "utf8");
    expect(doc, "the flag is undocumented").toContain(GITHUB_AUTH_ENV);
  });

  it("is what the screens ask before offering the button", () => {
    for (const page of ["src/app/login/page.tsx", "src/app/signup/page.tsx"]) {
      expect(readFileSync(page, "utf8"), `${page} does not gate the offer`).toContain(
        "githubAuthEnabled()",
      );
    }
  });
});

describe("the auth forms report a failure to the form", () => {
  /**
   * The error used to be a `Field` error on *password*, so "Enter your email
   * and password" and "We couldn't reach the server" both rendered under one
   * of the two fields they were not about — telling a reader the other was
   * fine.
   */
  const FORMS = [
    "src/app/login/login-form.tsx",
    "src/app/signup/signup-form.tsx",
    "src/app/forgot-password/forgot-password-form.tsx",
    "src/app/reset-password/reset-password-form.tsx",
  ] as const;

  it("uses FormError rather than hanging the message on a field", () => {
    for (const form of FORMS) {
      const source = readFileSync(form, "utf8");
      expect(source, `${form} does not report to the form`).toContain("<FormError");
      expect(source, `${form} hangs a form error on a field again`).not.toMatch(
        /<Field[^>]*\berror=\{/,
      );
    }
  });

  it("keeps the form on the ground, with no card around it", () => {
    for (const form of FORMS) {
      expect(readFileSync(form, "utf8"), `${form} is back in a card`).not.toContain("VibeCard");
    }
  });
});
