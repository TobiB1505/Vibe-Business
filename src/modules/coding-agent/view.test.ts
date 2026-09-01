import { describe, expect, it } from "vitest";
import {
  EXECUTION_ADMISSION_LABELS,
  EXECUTION_REASON_LABELS,
} from "@/modules/execution-contract/view";
import {
  EXECUTION_ADMISSION_REFUSALS,
  EXECUTION_RESOLUTION_REASONS,
} from "@/modules/execution-contract/schema";
import {
  PREFLIGHT_REFUSAL_LABELS,
  preflightRefusalLabel,
  startRefusalLabel,
  startRefusalRecovery,
} from "./view";
import { DOGFOOD_STEP_REASONS } from "./start-refusal";

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

/**
 * A refused start says which gate stopped it.
 *
 * The production incident this exists to close: a founder pressed "Run with
 * Vibe", the fresh chain refused because the default branch had moved since
 * Vibe last read the repository, and the screen answered "This step is no
 * longer eligible — the page will show why above." The page could not: its own
 * render had resolved fine, which is why the button was there to press.
 */
describe("startRefusalLabel", () => {
  it.each(DOGFOOD_STEP_REASONS)("says something for %s on its own", (reason) => {
    const label = startRefusalLabel({ reason });

    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toContain("_");
  });

  it.each(EXECUTION_ADMISSION_REFUSALS)("prefers the admission answer for %s", (refusal) => {
    expect(
      startRefusalLabel({
        reason: "preflight_refused",
        preflight: "not_admissible",
        admission: { admissible: false, refusal },
      }),
    ).toBe(EXECUTION_ADMISSION_LABELS[refusal]);
  });

  it("names the moved branch — the refusal that produced the incident", () => {
    expect(
      startRefusalLabel({
        reason: "preflight_refused",
        preflight: "not_admissible",
        admission: { admissible: false, refusal: "repository_head_moved" },
      }),
    ).toBe("Your code has changed since Vibe last read it.");
  });

  /**
   * A preflight refusal that is *about the step* keeps its own sentence even
   * when admission also happens to be unhappy — "too sensitive to attempt" is
   * the more fundamental answer, and a re-read would not change it.
   */
  it("keeps a classification refusal over an admission one", () => {
    expect(
      startRefusalLabel({
        reason: "preflight_refused",
        preflight: "risk_too_high",
        admission: { admissible: false, refusal: "repository_head_moved" },
      }),
    ).toBe(PREFLIGHT_REFUSAL_LABELS.risk_too_high);
  });

  it.each(EXECUTION_RESOLUTION_REASONS)("explains a non-agentic step by its own reason (%s)", (reason) => {
    expect(startRefusalLabel({ reason: "not_agentic", resolutionReason: reason })).toBe(
      EXECUTION_REASON_LABELS[reason],
    );
  });

  it("never promises an explanation the page cannot give", () => {
    for (const reason of DOGFOOD_STEP_REASONS) {
      expect(startRefusalLabel({ reason })).not.toContain("above");
    }
  });
});

describe("startRefusalRecovery", () => {
  it.each(["repository_head_moved", "repository_snapshot_stale"] as const)(
    "offers a re-read for %s, and says who starts it",
    (refusal) => {
      const recovery = startRefusalRecovery({
        reason: "preflight_refused",
        preflight: "not_admissible",
        admission: { admissible: false, refusal },
      });

      expect(recovery?.kind).toBe("repository_read");
      expect(recovery?.note).toContain("never");
    },
  );

  it("offers one when Vibe has never read the code at all", () => {
    expect(startRefusalRecovery({ reason: "repository_snapshot_missing" })?.kind).toBe(
      "repository_read",
    );
  });

  /**
   * A paid scan offered against a permanent refusal is worse than offering
   * nothing: it spends the founder's Credits to arrive at the same wall.
   */
  it.each([
    { reason: "not_dogfood_eligible" },
    { reason: "preflight_refused", preflight: "risk_too_high" },
    { reason: "not_agentic", resolutionReason: "risk_class_prohibited" },
  ] as const)("offers nothing a re-read would not fix (%o)", (detail) => {
    expect(startRefusalRecovery(detail)).toBeNull();
  });
});
