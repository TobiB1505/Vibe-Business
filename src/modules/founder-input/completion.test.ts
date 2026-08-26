import { describe, expect, it } from "vitest";
import { fakePlanStep } from "@/modules/execution-contract/test-support";
import { completedStepsFromFounderResolutions } from "./completion";

describe("founder-owned Action Plan completion", () => {
  it("completes only the step whose semantic requirement has active evidence", () => {
    const pricing = fakePlanStep({
      id: "1-pricing",
      order: 1,
      actor: "founder_decision",
      changeKind: "decision",
      founderInputRequirement: {
        kind: "decision",
        subjectKey: "monetization.pricing_model",
        question: "Which pricing model should the product use?",
        whyNeeded: "The implementation depends on the commercial model.",
        responseType: "single_select",
        recommendation: null,
        alternatives: [],
        allowCustom: true,
      },
    });
    const price = fakePlanStep({ id: "2-price", order: 2, dependsOn: [1] });

    const completed = completedStepsFromFounderResolutions([pricing, price], [
      {
        id: "resolution-1",
        kind: "decision",
        subjectKey: "monetization.pricing_model",
        resolvedStatement: "Use a monthly subscription.",
        supersededAt: null,
      },
      {
        id: "resolution-old",
        kind: "decision",
        subjectKey: "monetization.initial_price",
        resolvedStatement: "Charge 19 EUR.",
        supersededAt: "2026-08-25T12:00:00.000Z",
      },
    ]);

    expect([...completed]).toEqual([1]);
  });

  it("never turns founder context into completion evidence for agent work", () => {
    const agentStep = fakePlanStep({
      id: "2-build-pricing",
      order: 2,
      actor: "vibe",
      changeKind: "product_change",
      founderInputRequirement: null,
    });

    const completed = completedStepsFromFounderResolutions([agentStep], [
      {
        id: "resolution-1",
        kind: "decision",
        subjectKey: "monetization.pricing_model",
        resolvedStatement: "Use a monthly subscription.",
        supersededAt: null,
      },
    ]);

    expect([...completed]).toEqual([]);
  });
});
