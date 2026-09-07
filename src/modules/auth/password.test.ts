import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MINIMUM_PASSWORD_LENGTH, PASSWORD_HINT, passwordTooShortMessage } from "./password";

/**
 * One password rule, in one number (UI-18).
 *
 * ## What this exists to catch
 *
 * The interface stated the rule correctly, checked it incorrectly, and
 * enforced it correctly — in that order, on one screen. The hint said "At
 * least 8 characters", the input said `minLength={6}`, and the server refused
 * anything under 8. A seven-character password therefore passed the browser,
 * was submitted, and came back rejected by the field the browser had just
 * approved.
 *
 * The cause was structural: `MINIMUM_PASSWORD_LENGTH` lived in `actions.ts`,
 * which is `"use server"` — every export must be an async function, so no
 * input could read it. Three inputs carried a literal instead.
 */

const FORMS = [
  "src/app/signup/signup-form.tsx",
  "src/app/reset-password/reset-password-form.tsx",
] as const;

describe("the password rule", () => {
  it("is the number the hint and the refusal are both built from", () => {
    expect(PASSWORD_HINT).toContain(String(MINIMUM_PASSWORD_LENGTH));
    expect(passwordTooShortMessage()).toContain(String(MINIMUM_PASSWORD_LENGTH));
  });

  it("is not defined a second time by the server actions", () => {
    const actions = readFileSync("src/modules/auth/actions.ts", "utf8");
    expect(actions, "the actions define their own minimum again").not.toMatch(
      /const MINIMUM_PASSWORD_LENGTH\s*=/,
    );
    expect(actions).toContain('from "@/modules/auth/password"');
  });

  it("is never written as a literal by a form that collects one", () => {
    for (const form of FORMS) {
      const source = readFileSync(form, "utf8");
      // The exact defect: a number in the attribute the browser checks.
      expect(source, `${form} hardcodes a minimum length`).not.toMatch(/minLength=\{\d/);
      expect(source).toContain("minLength={MINIMUM_PASSWORD_LENGTH}");
    }
  });

  it("is never written as a sentence by a form that states one", () => {
    for (const form of FORMS) {
      const source = readFileSync(form, "utf8");
      expect(source, `${form} writes the rule out by hand`).not.toMatch(/At least \d+ characters/);
      expect(source).toContain("hint={PASSWORD_HINT}");
    }
  });
});
