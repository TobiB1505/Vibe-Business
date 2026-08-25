import { describe, expect, it } from "vitest";
import type { FounderInputRequest } from "./schema";
import { resolveFounderInputResponse } from "./resolve";

const request: FounderInputRequest = {
  id: "request-1",
  projectId: "project-1",
  actionPlanId: "plan-1",
  actionPlanStepKey: "choose-model",
  executionInterruptId: null,
  origin: "planner",
  kind: "decision",
  subjectKey: "monetization.pricing_model",
  question: "Which pricing model should the product use?",
  whyNeeded: "The implementation needs one confirmed model.",
  responseType: "single_select",
  recommendation: {
    id: "subscription",
    label: "Simple subscription",
    value: "Use a monthly subscription model.",
    explanation: "It is the simplest supported launch path.",
  },
  alternatives: [
    {
      id: "freemium",
      label: "Freemium",
      value: "Use a freemium pricing model.",
      explanation: null,
    },
  ],
  allowCustom: true,
  contextHash: "a".repeat(64),
  status: "open",
  createdAt: "2026-08-25T00:00:00.000Z",
  resolvedAt: null,
};

describe("resolveFounderInputResponse", () => {
  it("turns acceptance of Vibe's recommendation into its durable value", () => {
    expect(resolveFounderInputResponse(request, { source: "recommendation" })).toEqual({
      source: "recommendation",
      selectedOptionId: "subscription",
      rawAnswer: null,
      resolvedStatement: "Use a monthly subscription model.",
    });
  });

  it("uses an alternative selected from the persisted request", () => {
    expect(
      resolveFounderInputResponse(request, {
        source: "option",
        selectedOptionId: "freemium",
      }),
    ).toMatchObject({
      source: "option",
      selectedOptionId: "freemium",
      resolvedStatement: "Use a freemium pricing model.",
    });
  });

  it("preserves custom text while deriving a trimmed downstream statement", () => {
    expect(
      resolveFounderInputResponse(request, {
        source: "custom",
        rawAnswer: "  Give users a 14-day trial, then charge EUR 29/month.  ",
      }),
    ).toEqual({
      source: "custom",
      selectedOptionId: null,
      rawAnswer: "  Give users a 14-day trial, then charge EUR 29/month.  ",
      resolvedStatement: "Give users a 14-day trial, then charge EUR 29/month.",
    });
  });

  it("rejects client-invented options and a custom answer when custom is disabled", () => {
    expect(
      resolveFounderInputResponse(request, { source: "option", selectedOptionId: "invented" }),
    ).toBeNull();
    expect(
      resolveFounderInputResponse(
        { ...request, allowCustom: false },
        { source: "custom", rawAnswer: "Something else" },
      ),
    ).toBeNull();
  });
});
