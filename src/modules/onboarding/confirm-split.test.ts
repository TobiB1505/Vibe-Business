import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * That confirming what Vibe understood starts nothing (§O.3, rule 60).
 *
 * ## Why this is a source contract
 *
 * The claim is about what a function *does not* do, and the thing it must not
 * do is start a paid operation. A behavioural test would have to run the
 * action, which needs a session, a Supabase client and a workflow executor —
 * and would then prove the absence of a call by observing that a fake was not
 * invoked, which is exactly as strong as reading that the call is not there
 * and considerably more machinery.
 *
 * What the source can say precisely: which function bodies contain
 * `startBusinessAuditOperation`, and which do not.
 */

const ACTIONS = readFileSync(
  join(process.cwd(), "src/app/app/onboarding/[projectId]/actions.ts"),
  "utf8",
);

/** One exported function's body, from its signature to the next export. */
function bodyOf(name: string): string {
  const start = ACTIONS.indexOf(`export async function ${name}(`);
  expect(start, `${name} is exported`).toBeGreaterThan(-1);

  const next = ACTIONS.indexOf("\nexport ", start + 1);
  return ACTIONS.slice(start, next === -1 ? undefined : next);
}

describe("confirming is not auditing", () => {
  it.each(["confirmProductAction", "correctProductAction"])("%s starts no audit", (name) => {
    const body = bodyOf(name);

    expect(body).not.toContain("startBusinessAuditOperation");
    expect(body).not.toContain("startFirstAudit");
  });

  /**
   * And starts nothing else either. `startProductScanOperation` and
   * `startOpportunityOperation` are both imported into this file, so "no
   * audit" alone would leave two other paid-or-durable starts available to a
   * future edit that read the name of this test and stopped there.
   */
  it.each(["confirmProductAction", "correctProductAction"])(
    "%s starts no operation of any kind",
    (name) => {
      const body = bodyOf(name);

      for (const start of [
        "startProductScanOperation",
        "startOpportunityOperation",
        "VercelWorkflowExecutor",
      ]) {
        expect(body, `${name} calls ${start}`).not.toContain(start);
      }
    },
  );

  it("writes the confirmation, which is the whole of its job", () => {
    expect(bodyOf("confirmProductAction")).toContain("confirmProfile(");
    expect(bodyOf("correctProductAction")).toContain("saveCorrections(");
    expect(bodyOf("correctProductAction")).toContain("confirmProfile(");
  });
});

describe("the bundled pair composes rather than copies", () => {
  /**
   * One implementation of "this profile is confirmed". Two would drift — and
   * the drift would be silent, because both paths end on the same screen.
   */
  it("starts the audit by calling the confirmation, not by repeating it", () => {
    const bundled = bodyOf("confirmProductAndStartAuditAction");

    expect(bundled).toContain("confirmProductAction(");
    expect(bundled).toContain("startFirstAudit(");
    expect(bundled).not.toContain("confirmProfile(");
    expect(bundled).not.toContain("markOnboardingMilestone(");
  });

  it("corrects by calling the correction, not by repeating it", () => {
    const bundled = bodyOf("correctProductAndStartAuditAction");

    expect(bundled).toContain("correctProductAction(");
    expect(bundled).toContain("startFirstAudit(");
    expect(bundled).not.toContain("saveCorrections(");
    expect(bundled).not.toContain("sanitizeCorrections(");
  });

  /**
   * A failed confirmation must not be followed by an audit. The bundled
   * action's whole risk is that it does two things: if the first did not
   * happen, the second is a paid operation on a profile nobody confirmed.
   */
  it.each(["confirmProductAndStartAuditAction", "correctProductAndStartAuditAction"])(
    "%s does not start the audit when the confirmation failed",
    (name) => {
      const body = bodyOf(name);

      expect(body).toMatch(/if \((confirmed|corrected) && !\1\.ok\) return \1;/);
    },
  );
});
