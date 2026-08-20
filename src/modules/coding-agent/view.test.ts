import { describe, expect, it } from "vitest";
import { EXECUTION_ADMISSION_LABELS } from "@/modules/execution-contract/view";
import { EXECUTION_ADMISSION_REFUSALS } from "@/modules/execution-contract/schema";
import { PREFLIGHT_REFUSAL_LABELS, preflightRefusalLabel } from "./view";

/**
 * What the dogfood surface tells a founder when it refuses.
 *
 * `not_admissible` is one preflight refusal standing in for nine admission
 * answers. Rendering its generic label for all of them produced a screen that
 * said "your code changed since Vibe last looked" when the real reason was
 * that no Agent price exists — wrong, and nothing a founder could act on.
 */

describe("preflightRefusalLabel", () => {
  it.each(EXECUTION_ADMISSION_REFUSALS)("says what %s actually means", (refusal) => {
    expect(preflightRefusalLabel("not_admissible", { admissible: false, refusal })).toBe(
      EXECUTION_ADMISSION_LABELS[refusal],
    );
  });

  /** The case from the real dogfood: main moved past the analyzed snapshot. */
  it("names a moved repository rather than an unspecified staleness", () => {
    const label = preflightRefusalLabel("not_admissible", {
      admissible: false,
      refusal: "repository_head_moved",
    });

    expect(label).toBe("Your code has changed since Vibe last read it.");
  });

  /** And the case the generic sentence got most wrong. */
  it("does not blame the customer's code when the truth is that nothing is priced", () => {
    const label = preflightRefusalLabel("not_admissible", {
      admissible: false,
      refusal: "agentic_pricing_not_configured",
    });

    expect(label).not.toMatch(/your code/i);
    expect(label).toBe(EXECUTION_ADMISSION_LABELS.agentic_pricing_not_configured);
  });

  it("keeps every other refusal's own copy — admission has nothing to say about them", () => {
    for (const refusal of Object.keys(PREFLIGHT_REFUSAL_LABELS) as (keyof typeof PREFLIGHT_REFUSAL_LABELS)[]) {
      if (refusal === "not_admissible") continue;
      expect(
        preflightRefusalLabel(refusal, { admissible: false, refusal: "repository_head_moved" }),
      ).toBe(PREFLIGHT_REFUSAL_LABELS[refusal]);
    }
  });

  /**
   * An admissible resolution alongside `not_admissible` is a contradiction the
   * types permit and nothing produces. Falling back to the generic label is the
   * safe answer: it says less, and it says nothing untrue.
   */
  it("falls back to the generic label when admission reports no refusal", () => {
    expect(preflightRefusalLabel("not_admissible", { admissible: true })).toBe(
      PREFLIGHT_REFUSAL_LABELS.not_admissible,
    );
  });
});
