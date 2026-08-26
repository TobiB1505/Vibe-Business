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

describe("the subject key stays inside its bound (VB regression)", () => {
  /** `${order}-${changeKind}-${slug(title)}`, with the title slug capped at 48. */
  function stepKeyFor(order: number, changeKind: string, title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
    return `${order}-${changeKind}-${slug}`;
  }

  const SUBJECT_KEY_MAX = 96;

  it("keeps an ordinary product_change step answerable", () => {
    // This exact title produced a 98-character key, which failed validation and
    // made the run report missing_required_context — it failed instead of
    // asking the founder, on the commonest change kind, after they had paid.
    const stepKey = stepKeyFor(3, "product_change", "Add a clear pricing section to the marketing homepage");
    const requirement = runtimeFounderInputRequirement({
      stepKey,
      draft: { kind: "decision", question: "Which plan should the page lead with?", options: ["Starter", "Pro"] },
    });

    expect(requirement).not.toBeNull();
    expect(requirement!.subjectKey.length).toBeLessThanOrEqual(SUBJECT_KEY_MAX);
  });

  it("holds for the longest step key the planner can emit", () => {
    const stepKey = stepKeyFor(9, "configuration_change", "x".repeat(80));
    const requirement = runtimeFounderInputRequirement({
      stepKey,
      draft: { kind: "input", question: "Which account identifier should Vibe use?", options: [] },
    });

    expect(requirement).not.toBeNull();
    expect(requirement!.subjectKey.length).toBeLessThanOrEqual(SUBJECT_KEY_MAX);
  });

  it("still separates two steps that share a truncated prefix", () => {
    // Truncation is only safe because the digest keys the full step key.
    const shared = "y".repeat(80);
    const a = runtimeFounderInputRequirement({
      stepKey: stepKeyFor(1, "product_change", shared),
      draft: { kind: "decision", question: "Same question, different step?", options: [] },
    });
    const b = runtimeFounderInputRequirement({
      stepKey: stepKeyFor(2, "product_change", shared),
      draft: { kind: "decision", question: "Same question, different step?", options: [] },
    });

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.subjectKey).not.toBe(b!.subjectKey);
  });
});

