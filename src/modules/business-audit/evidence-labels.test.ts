import { describe, expect, it } from "vitest";
import { describeEvidenceId } from "./evidence-labels";

/**
 * "Why?" resolution (Sprint 6 §12).
 *
 * The rule that matters: a citation must never read as the opposite of what it
 * says. `auth.surface.billing_not_observed` is a statement that billing was not
 * seen, and rendering it as "Billing detected" would turn a limitation into a
 * finding.
 */

describe("describeEvidenceId", () => {
  it("resolves an authenticated surface to its product name", () => {
    expect(describeEvidenceId("auth.surface.dashboard")).toEqual({
      source: "Authenticated product",
      detail: "Dashboard detected",
    });
  });

  it("preserves the polarity of an unobserved surface", () => {
    expect(describeEvidenceId("auth.surface.billing_not_observed")).toEqual({
      source: "Authenticated product",
      detail: "Billing not observed",
    });
  });

  it("describes an action control as present, never as working", () => {
    const { detail } = describeEvidenceId("auth.action.run_business_audit");
    expect(detail).toBe("Action control present: Run business audit");
  });

  it("labels the other three sources", () => {
    expect(describeEvidenceId("repo.integration.github").source).toBe("Repository");
    expect(describeEvidenceId("live.surface.pricing").source).toBe("Public website");
    expect(describeEvidenceId("business.primary_goal").source).toBe("Business context");
  });

  it("degrades readably rather than guessing at an unknown id", () => {
    expect(describeEvidenceId("auth.something.new_thing")).toEqual({
      source: "Authenticated product",
      detail: "Something new thing",
    });
    expect(describeEvidenceId("mystery")).toEqual({ source: "Evidence", detail: "Mystery" });
  });
});
