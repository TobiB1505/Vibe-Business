import { describe, expect, it } from "vitest";
import { surfaceEvidenceId } from "@/modules/business-audit/evidence-ids";
import { classifyExecutionRisk } from "./risk";

/**
 * Risk classification, and the property `business-evidence.v4` must not break.
 *
 * `classifyExecutionRisk` had no test of its own. It decides whether Vibe will
 * touch a change at all — `prohibited` for financial surfaces, `high` for
 * authentication — so a silent change in what it matches is the most expensive
 * kind of regression this repository can produce.
 *
 * Sprint 0073 refused to rename the evidence ids precisely because of this
 * function: `payments` matched the financial list and `payments_missing` would
 * not have, so a payments change would have fallen from `prohibited` to
 * `moderate` with every test still green.
 */

const financial = (id: string) =>
  classifyExecutionRisk({ changeKind: "product_change", evidenceIds: [id] });

describe("polarity never changes the risk class", () => {
  /**
   * The invariant, stated as an equality rather than as two expectations.
   *
   * A step citing "there is no checkout" is a step that will build one, and
   * building payment architecture is exactly what `prohibited` exists to
   * refuse. Absence is not a softer fact here — in this direction it is the
   * more consequential one.
   */
  it.each([
    ["repo", "payments"],
    ["repo", "checkout_billing"],
    ["live", "checkout_billing"],
  ] as const)("%s.%s is prohibited whether present or absent", (namespace, surface) => {
    const present = financial(surfaceEvidenceId(namespace, surface, true));
    const absent = financial(surfaceEvidenceId(namespace, surface, false));

    expect(present).toBe("prohibited");
    expect(absent).toBe(present);
  });

  it.each([
    ["repo", "authentication"],
    ["live", "login"],
    ["live", "signup"],
  ] as const)("%s.%s is high whether present or absent", (namespace, surface) => {
    const present = financial(surfaceEvidenceId(namespace, surface, true));
    const absent = financial(surfaceEvidenceId(namespace, surface, false));

    expect(present).toBe("high");
    expect(absent).toBe(present);
  });

  /**
   * Guards the guard. If `surfaceEvidenceId` ever stopped distinguishing the
   * two, every assertion above would compare a value to itself and pass.
   */
  it("is comparing two genuinely different ids", () => {
    expect(surfaceEvidenceId("repo", "payments", true)).not.toBe(
      surfaceEvidenceId("repo", "payments", false),
    );
  });
});

describe("what risk is actually about", () => {
  /**
   * Consequence, not subject matter — the correction the first real dogfood
   * forced. Step 1 of the persisted plan was "lay out the access options for
   * staff", which cites `repo.surface.authentication` because that is what it
   * reasons about, and classifying it `high` described the topic rather than
   * the outcome.
   */
  it("does not escalate a step that changes nothing outside Vibe", () => {
    expect(
      classifyExecutionRisk({
        changeKind: "decision",
        evidenceIds: [surfaceEvidenceId("repo", "payments", false)],
      }),
    ).toBe("low");
  });

  it("ignores an id that names no surface", () => {
    expect(
      classifyExecutionRisk({ changeKind: "product_change", evidenceIds: ["live.seo.title"] }),
    ).not.toBe("prohibited");
  });
});
