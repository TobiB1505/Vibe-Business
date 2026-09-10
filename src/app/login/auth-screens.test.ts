import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * What the four public auth screens must keep (UI-19, UI-20).
 *
 * These are source assertions about composition. The behaviour they protect is
 * checked in the browser — `e2e/auth.spec.ts` — and this file exists for the
 * regressions a rendered page cannot show: a component reintroduced by an
 * import, a brand mark recoloured, an error wired back to the wrong element.
 */

/** The code, without the prose about it — a docblock naming a forbidden thing is not the thing. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const FORMS = [
  "src/app/login/login-form.tsx",
  "src/app/signup/signup-form.tsx",
  "src/app/forgot-password/forgot-password-form.tsx",
  "src/app/reset-password/reset-password-form.tsx",
] as const;

describe("the auth forms report a failure to the form", () => {
  /**
   * The error used to be a `Field` error on *password*, so "Enter your email
   * and password" and "We couldn't reach the server" both rendered under one
   * of the two fields they were not about — telling a reader the other was
   * fine.
   */
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

describe("both identity providers are offered, unconditionally", () => {
  const row = readFileSync("src/app/login/provider-row.tsx", "utf8");

  /**
   * UI-19 gated GitHub on `VIBE_GITHUB_AUTH` while the Supabase provider was
   * not enabled. It is enabled, and Vibe runs on one Supabase project — so
   * there is no deployment where the offer differs, and no flag to keep in
   * step with a dashboard.
   */
  it("asks no environment variable whether to render a provider", () => {
    for (const path of ["src/app/login/provider-row.tsx", ...FORMS]) {
      const source = code(path);
      expect(source, `${path} reads the flag again`).not.toContain("VIBE_GITHUB_AUTH");
      expect(source, `${path} reads the flag again`).not.toContain("githubAuthEnabled");
    }
  });

  it("renders each provider in its own form", () => {
    // Sharing one form lets the email field's `required` validation block a
    // provider button — a browser behaviour nobody would guess from the code.
    expect(row.match(/<form action=/g)?.length).toBe(2);
  });
});

describe("the providers' marks", () => {
  const marks = readFileSync("src/components/brand/provider-marks.tsx", "utf8");

  /**
   * A brand mark is reproduced, not restyled. Google publishes a four-colour
   * "G" and asks that it be shown unmodified; folding it into `currentColor`
   * to match the token vocabulary would make it a different mark.
   */
  it("keeps Google's four published colours", () => {
    for (const colour of ["#4285F4", "#34A853", "#FBBC05", "#EA4335"]) {
      expect(marks, `the Google mark lost ${colour}`).toContain(colour);
    }
  });

  it("hides both marks from the accessibility tree", () => {
    // The button already names the provider. A mark with a name of its own
    // makes a screen reader say "Google" twice.
    expect(marks.match(/aria-hidden/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
