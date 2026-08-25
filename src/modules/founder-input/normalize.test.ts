import { describe, expect, it } from "vitest";
import { normalizeFounderInputRequirement } from "./normalize";

describe("normalizeFounderInputRequirement", () => {
  it("keeps a dynamic recommendation-first decision", () => {
    expect(
      normalizeFounderInputRequirement({
        kind: "decision",
        subjectKey: "launch.access_model",
        question: "How should people get access at launch?",
        whyNeeded: "The signup flow depends on this choice.",
        responseType: "single_select",
        recommendation: {
          id: "invite-only",
          label: "Invite-only",
          value: "Launch with invite-only access.",
          explanation: "It keeps the first cohort bounded.",
        },
        alternatives: [
          {
            id: "public",
            label: "Public",
            value: "Launch publicly.",
            explanation: null,
          },
        ],
        allowCustom: true,
      }),
    ).toMatchObject({ subjectKey: "launch.access_model", allowCustom: true });
  });

  it("rejects a select request with no selectable or custom path", () => {
    expect(
      normalizeFounderInputRequirement({
        kind: "decision",
        subjectKey: "launch.access_model",
        question: "How should people get access at launch?",
        whyNeeded: "The signup flow depends on this choice.",
        responseType: "single_select",
        recommendation: null,
        alternatives: [],
        allowCustom: false,
      }),
    ).toBeNull();
  });
});
