import { describe, expect, it } from "vitest";
import { deriveNovaFocus, type NovaFocusFacts } from "../focus";
import { buildNovaHomeView } from "../home-view";
import { buildConversationPayload, MAX_CONTEXT_CHARS } from "./context";
import type { BusinessBrainView } from "../../projects/business-brain-view";

/**
 * What the model may see, and what it may therefore say.
 *
 * Three properties, and each is a security property rather than a shaping one.
 * **The pack is assembled by Vibe**, so the model has no say in what it reads
 * (rule 41). **The numeric allowlist is the pack's own numerals**, so a figure
 * in a reply either came from here or was invented. And **the artifacts and
 * actions offered are what this project actually has**, so a model cannot point
 * at a screen that is empty or propose a control the server would refuse.
 */

const NO_FACTS: NovaFocusFacts = {
  sourceDisconnected: false,
  failedOperations: { agent: false, scan: false, audit: false },
  stalledOperations: { agent: false, scan: false, audit: false },
  changes: [],
  questions: [],
  moves: [],
  plannedMoveId: null,
  executableStep: null,
  planOffered: false,
  auditOutdated: false,
  repositoryReadOutdated: false,
  workspaceChoiceRequired: false,
  working: null,
};

function home(facts: Partial<NovaFocusFacts> = {}) {
  return buildNovaHomeView(deriveNovaFocus({ ...NO_FACTS, ...facts }));
}

function build(overrides: Partial<Parameters<typeof buildConversationPayload>[0]> = {}) {
  return buildConversationPayload({
    question: "why is conversion the blocker?",
    productName: "Payflow",
    founderGoal: "First paying customers",
    home: home(),
    audit: null,
    understanding: null,
    turns: [],
    ...overrides,
  });
}

const AUDIT = {
  overall: {
    score: 62,
    state: "fair",
    stateLabel: "Fair",
    summary: "Pricing is the thing standing between this product and revenue.",
    scoredLenses: 7,
    eligibleLenses: 9,
    insufficientCoverageReason: null,
  },
  nodes: [
    {
      id: "revenue",
      label: "Revenue",
      score: 41,
      health: "weak",
      healthLabel: "Weak",
      priority: "critical",
      priorityLabel: "Critical",
      ring: "inner",
      angle: 0,
      blockerRank: 1,
    },
    {
      id: "retention",
      label: "Retention",
      score: null,
      health: "unknown",
      healthLabel: "Not enough to say",
      priority: "unclear",
      priorityLabel: "Unclear",
      ring: "outer",
      angle: 90,
      blockerRank: null,
    },
  ],
  relationships: [],
  primaryPriority: {
    headline: "Your code takes payments and your site offers no way to pay",
    whyItMatters: "Visitors reach the signup form without knowing the price.",
    lensIds: ["revenue"],
  },
  priorities: [],
  additionalPriorityCount: 0,
} as unknown as BusinessBrainView;

describe("the pack Vibe assembles", () => {
  it("carries the question, the product and the goal", () => {
    const payload = build();

    expect(payload.question).toBe("why is conversion the blocker?");
    expect(payload.productName).toBe("Payflow");
    expect(payload.founderGoal).toBe("First paying customers");
  });

  it("carries the business reading as the screens state it", () => {
    const payload = build({ audit: AUDIT });

    const reading = payload.sections.find((section) => section.title === "Business reading");
    expect(reading?.facts.map((entry) => entry.label)).toContain("biggest blocker");
    expect(reading?.facts.find((entry) => entry.label === "overall")?.value).toContain("62");
  });

  /**
   * Rule 44, carried one layer further than it was written for. A lens the
   * evidence could not support is `null`, and `null` is never zero — so it
   * reaches the model as the words it reaches a founder as, rather than as a
   * number it could reason about.
   */
  it("says a lens was not scored rather than sending a zero", () => {
    const payload = build({ audit: AUDIT });

    const retention = payload.sections
      .flatMap((section) => section.facts)
      .find((entry) => entry.label === "Retention");

    expect(retention?.value).toContain("not scored");
    expect(retention?.value).not.toContain("0");
  });

  it("carries the ranking's own sentences, not a second ranking", () => {
    const payload = build({ home: home({ auditOutdated: true }) });

    const waiting = payload.sections.find((section) => section.title === "What is waiting on you");
    expect(waiting?.facts[0]?.value).toBe(home({ auditOutdated: true }).primary.message);
  });

  it("bounds the turns it carries", () => {
    const turns = Array.from({ length: 30 }, (_, index) => ({
      author: "founder" as const,
      text: `turn ${index}`,
    }));

    expect(build({ turns }).recentTurns.length).toBeLessThanOrEqual(6);
    // From the end: a pronoun reaches backwards, not forwards.
    expect(build({ turns }).recentTurns.at(-1)?.text).toBe("turn 29");
  });

  it("stays inside its own budget", () => {
    const payload = build({ audit: AUDIT });

    const size = payload.sections.reduce(
      (total, section) =>
        total + section.facts.reduce((inner, entry) => inner + entry.value.length, 0),
      0,
    );

    expect(size).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  });
});

describe("what the reply may contain", () => {
  /**
   * Derived rather than curated, so "a numeral in the pack" and "a numeral the
   * reply may contain" are the same statement. A hand-written list drifts, and
   * it drifts towards refusing true figures — which is how a validator gets
   * switched off.
   */
  it("allows exactly the numerals the pack carries", () => {
    const payload = build({ audit: AUDIT });

    expect(payload.allowedNumericFacts).toContain("62");
    expect(payload.allowedNumericFacts).toContain("41");
    expect(payload.allowedNumericFacts).not.toContain("99");
  });

  it("allows nothing at all when the pack carries no figures", () => {
    expect(build().allowedNumericFacts).toEqual([]);
  });
});

describe("what the model may point at", () => {
  it("offers only artifacts this project has", () => {
    const payload = build({ home: home({ auditOutdated: true }) });

    expect(payload.availableArtifacts).toEqual([{ kind: "business_health", ref: null }]);
  });

  it("offers a change by its own id", () => {
    const payload = build({
      home: home({
        changes: [
          {
            preparedChangeId: "change_7",
            stage: "review_required",
            headline: "Two files changed",
            createdAt: "2026-09-11T09:00:00.000Z",
          },
        ],
      }),
    });

    expect(payload.availableArtifacts).toContainEqual({
      kind: "prepared_change",
      ref: "change_7",
    });
  });

  it("offers nothing on a settled project", () => {
    const payload = build();

    expect(payload.availableArtifacts).toEqual([]);
    expect(payload.availableActions).toEqual([]);
  });

  /**
   * The dead end `home-view.ts` records reaching twice: a control offered in a
   * state where pressing it would be refused. The catalogue has eighteen ids
   * and this project is offering one.
   */
  it("offers only the controls the ranking is currently offering", () => {
    const payload = build({ home: home({ auditOutdated: true }) });

    expect(payload.availableActions.map((action) => action.actionId)).toEqual([
      "nova.refresh_audit",
    ]);
    expect(payload.availableActions[0].label).toBe("Run the audit again");
  });
});
