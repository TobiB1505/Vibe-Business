import { describe, expect, it } from "vitest";
import {
  executionSpecAlreadyResolvedFounderInput,
  runtimeFounderInputRequirement,
} from "./runtime";

describe("runtimeFounderInputRequirement", () => {
  it("creates a stable semantic identity without hard-coded business rules", () => {
    const first = runtimeFounderInputRequirement({
      stepKey: "launch-page",
      draft: {
        kind: "decision",
        question: "  Which launch audience should we use?  ",
        options: ["Invite only", "Public"],
      },
    });
    const replay = runtimeFounderInputRequirement({
      stepKey: "launch-page",
      draft: {
        kind: "decision",
        question: "Which   launch audience should we use?",
        options: ["Invite only", "Public"],
      },
    });

    expect(first).not.toBeNull();
    expect(first?.subjectKey).toBe(replay?.subjectKey);
    expect(first).toMatchObject({
      kind: "decision",
      question: "Which launch audience should we use?",
      responseType: "single_select",
      recommendation: null,
      allowCustom: true,
    });
    expect(first?.alternatives.map((option) => option.value)).toEqual(["Invite only", "Public"]);
  });

  it("recognizes the same resolved subject in an immutable execution spec", () => {
    const requirement = runtimeFounderInputRequirement({
      stepKey: "build-launch-page",
      draft: {
        kind: "decision",
        question: "Which launch audience should this change target?",
        options: ["Existing customers", "Invite-only beta"],
      },
    });
    expect(requirement).not.toBeNull();
    if (!requirement) return;

    expect(
      executionSpecAlreadyResolvedFounderInput(
        [{ key: `decision:${requirement.subjectKey}` }],
        requirement,
      ),
    ).toBe(true);
    expect(
      executionSpecAlreadyResolvedFounderInput(
        [{ key: `input:${requirement.subjectKey}` }],
        requirement,
      ),
    ).toBe(false);
  });

  it("keeps factual founder input distinct and uses text when no choices exist", () => {
    expect(
      runtimeFounderInputRequirement({
        stepKey: "configure-domain",
        draft: {
          kind: "input",
          question: "Which verified domain should be connected?",
          options: [],
        },
      }),
    ).toMatchObject({
      kind: "input",
      responseType: "text",
      recommendation: null,
      alternatives: [],
      allowCustom: true,
    });
  });

  it("rejects an empty runtime question", () => {
    expect(
      runtimeFounderInputRequirement({
        stepKey: "step-1",
        draft: { kind: "decision", question: "   ", options: [] },
      }),
    ).toBeNull();
  });
});
