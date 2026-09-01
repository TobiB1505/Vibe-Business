import { describe, expect, it } from "vitest";
import { surfaceEvidenceId } from "@/modules/business-audit/evidence-ids";
import { classifyExecutionRisk } from "./risk";
import { INTEGRATION_CATEGORY_BY_ID } from "@/modules/repository-intelligence/detectors/integrations";

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

/**
 * The families the parser used to walk past.
 *
 * A real Action Plan step — *"Wire the pricing page to a working Stripe
 * checkout and surface billing to signed-in users"*, step 4 of the plan
 * generated on 2026-09-01 — cited `repo.integration.stripe`,
 * `repo.routes.pages` and `auth.surface.billing_not_observed`. None of the
 * three matched `repo.surface.*` or `live.surface.*`, so the step that wires a
 * payment provider classified `moderate` and was eligible for an agent, while
 * `FINANCIAL_SURFACES` said Vibe does not touch payment architecture "at any
 * risk tolerance". The constant and the parser disagreed, silently.
 */
describe("payment meaning is read from every family that can carry it", () => {
  it("refuses the live step that wires a checkout", () => {
    expect(
      classifyExecutionRisk({
        changeKind: "product_change",
        evidenceIds: [
          "repo.integration.stripe",
          "repo.routes.pages",
          "auth.surface.billing_not_observed",
        ],
      }),
    ).toBe("prohibited");
  });

  it("reads a signed-in billing area the same either way it was observed", () => {
    const seen = classifyExecutionRisk({
      changeKind: "product_change",
      evidenceIds: ["auth.surface.billing"],
    });
    const notSeen = classifyExecutionRisk({
      changeKind: "product_change",
      evidenceIds: ["auth.surface.billing_not_observed"],
    });

    expect(seen).toBe("prohibited");
    // An equality, not two constants: the absence dialect must not be able to
    // regress on its own.
    expect(notSeen).toBe(seen);
  });

  /**
   * The drift guard, and the reason the category map is derived from the
   * detector catalogue rather than written twice: a payments provider added
   * there is refused here without anyone remembering this file exists.
   */
  it("classifies every integration the detector knows, by its own category", () => {
    for (const [id, category] of Object.entries(INTEGRATION_CATEGORY_BY_ID)) {
      const risk = classifyExecutionRisk({
        changeKind: "product_change",
        evidenceIds: [`repo.integration.${id}`],
      });

      if (category === "payments") expect(risk).toBe("prohibited");
      else if (category === "auth") expect(risk).toBe("high");
      else expect(risk).toBe("moderate");
    }
  });

  /**
   * Over-inclusion is the correct error, but only for the meaning being read.
   * `auth.` names where the Deep Scan was standing, not what the step changes:
   * escalating every signed-in surface would put every signed-in-product change
   * outside the V1 boundary, which is an ADR and not a longer constant.
   */
  it.each([
    "auth.surface.dashboard",
    "auth.surface.settings_not_observed",
    "auth.area.reached",
    "repo.routes.pages",
  ])("leaves %s where it was", (evidenceId) => {
    expect(classifyExecutionRisk({ changeKind: "product_change", evidenceIds: [evidenceId] })).toBe(
      "moderate",
    );
  });

  /** Consequence, not subject matter — the correction the first dogfood forced. */
  it("still escalates nothing that changes nothing", () => {
    expect(
      classifyExecutionRisk({
        changeKind: "decision",
        evidenceIds: ["repo.integration.stripe", "auth.surface.billing"],
      }),
    ).toBe("low");
  });
});
