import { describe, expect, it } from "vitest";
import type { ActionPlanBlockReason } from "./service";
import type { ExecutionResolutionReason } from "@/modules/execution-contract/schema";
import {
  EXECUTION_SUPPORT,
  type ActionPlanStep,
  type ExecutionSupport,
} from "./schema";
import {
  RESPONSIBILITY_HEADLINES,
  RESPONSIBILITY_SUBLABELS,
  buildActionPlanBlockNotice,
  founderQuestionCta,
  planEvidenceSummary,
  planExpectedChange,
  planFounderDemands,
  planMetaSummary,
  stepDependencyTitles,
  stepDisplayState,
  stepSequenceStatus,
  stepResponsibility,
  attestationPrompt,
} from "./view";

/**
 * The Action Plan presentation layer (ACTION PLANNER UI-1).
 *
 * Pure functions only, tested without a DOM or a database — the same
 * standard `opportunities/view.ts` is held to. What these tests exist to pin
 * down: every block reason has a way out, and step display state is computed
 * from `firstActionableOrder` and `dependsOn` rather than from array
 * position.
 */

const ALL_BLOCK_REASONS: ActionPlanBlockReason[] = [
  "audit_missing",
  "audit_stale",
  "move_missing",
  "move_stale",
  "product_profile_missing",
  "planner_source_unresolved",
];

function step(overrides: Partial<ActionPlanStep> = {}): ActionPlanStep {
  return {
    id: "step-1",
    order: 1,
    title: "Do the thing",
    description: "A description.",
    purpose: "A purpose.",
    actor: "vibe",
    changeKind: "analysis",
    completionCriteria: "It is done.",
    dependsOn: [],
    evidenceIds: [],
    executionSupport: "vibe_prepares",
    capability: null,
    requiresApproval: false,
    ...overrides,
    founderInputRequirement: overrides.founderInputRequirement ?? null,
  };
}

describe("buildActionPlanBlockNotice", () => {
  it("returns null for no block", () => {
    expect(buildActionPlanBlockNotice(null)).toBeNull();
  });

  /**
   * Mirrors the rule `buildOpportunityBlockNotice` is tested against: a
   * blocked state is never a dead end, so every reason must resolve to a
   * concrete action and somewhere to send the founder.
   */
  it("gives every reason an action label and a target", () => {
    for (const reason of ALL_BLOCK_REASONS) {
      const notice = buildActionPlanBlockNotice(reason);
      expect(notice).not.toBeNull();
      expect(notice!.reason).toBe(reason);
      expect(notice!.actionLabel.length).toBeGreaterThan(0);
      expect(["business_audit", "product_understanding", "next_moves"]).toContain(
        notice!.target,
      );
    }
  });

  it("routes the audit reasons at the business audit, not next moves", () => {
    expect(buildActionPlanBlockNotice("audit_missing")!.target).toBe("business_audit");
    expect(buildActionPlanBlockNotice("audit_stale")!.target).toBe("business_audit");
  });

  it("routes every Move-shaped reason back at next moves", () => {
    expect(buildActionPlanBlockNotice("move_missing")!.target).toBe("next_moves");
    expect(buildActionPlanBlockNotice("move_stale")!.target).toBe("next_moves");
    // The Move itself may be current — what failed is its link to a
    // conclusion — but the remedy is the same regeneration.
    expect(buildActionPlanBlockNotice("planner_source_unresolved")!.target).toBe("next_moves");
  });
});

describe("stepDisplayState", () => {
  it("marks the step firstActionableStep actually returned, not steps[0]", () => {
    const decision = step({ order: 1, dependsOn: [] });
    const laterStep = step({ order: 2, dependsOn: [1] });

    // firstActionableStep picked order 2 — impossible unless 1 were already
    // done, but the display state must still trust the server's answer
    // rather than re-deriving "first" as array position.
    expect(stepDisplayState(decision, 2)).not.toBe("start_here");
    expect(stepDisplayState(laterStep, 2)).toBe("start_here");
  });

  it("marks a zero-dependency step that is not the chosen one as also_ready", () => {
    const first = step({ order: 1, dependsOn: [] });
    const second = step({ order: 2, dependsOn: [] });

    expect(stepDisplayState(first, 1)).toBe("start_here");
    expect(stepDisplayState(second, 1)).toBe("also_ready");
  });

  it("marks a step with an open prerequisite as waiting", () => {
    const blocked = step({ order: 3, dependsOn: [1] });
    expect(stepDisplayState(blocked, 1)).toBe("waiting_on_steps");
  });

  it("marks a completed step as done regardless of dependencies or order", () => {
    const finished = step({ order: 1, dependsOn: [] });
    expect(stepDisplayState(finished, null, new Set([1]))).toBe("done");
  });

  it("never crowns a step start_here when nothing is actionable", () => {
    const anyStep = step({ order: 1, dependsOn: [] });
    expect(stepDisplayState(anyStep, null)).not.toBe("start_here");
  });
});

describe("stepDependencyTitles", () => {
  it("resolves prerequisite orders to their titles, in dependsOn order", () => {
    const decision = step({ order: 1, title: "Choose a segment" });
    const research = step({ order: 2, title: "Interview five customers" });
    const dependent = step({ order: 3, dependsOn: [1, 2] });

    expect(stepDependencyTitles(dependent, [decision, research, dependent])).toEqual([
      "Choose a segment",
      "Interview five customers",
    ]);
  });

  it("drops a dangling reference rather than rendering an empty title", () => {
    const dependent = step({ order: 2, dependsOn: [1] });
    expect(stepDependencyTitles(dependent, [dependent])).toEqual([]);
  });

  it("returns an empty list for a step with no prerequisites", () => {
    const first = step({ order: 1, dependsOn: [] });
    expect(stepDependencyTitles(first, [first])).toEqual([]);
  });
});

/**
 * ACTION PLANNER UI-1.1 — density pass helpers.
 *
 * `RESPONSIBILITY_HEADLINES` is the one place a step's actor/executionSupport
 * pairing becomes the single scannable statement the collapsed row shows —
 * so every value the enum can take must resolve to real, non-empty copy, and
 * `not_yet_supported` must never read as if something is happening
 * automatically.
 */
describe("RESPONSIBILITY_HEADLINES", () => {
  it("gives every ExecutionSupport value a non-empty headline", () => {
    for (const value of EXECUTION_SUPPORT) {
      expect(RESPONSIBILITY_HEADLINES[value].length).toBeGreaterThan(0);
    }
  });

  it("never lets 'not yet supported' read as automatic", () => {
    const headline = RESPONSIBILITY_HEADLINES.not_yet_supported.toLowerCase();
    expect(headline).not.toContain("automat");
    expect(RESPONSIBILITY_SUBLABELS.not_yet_supported).toBe("Not automated yet");
  });

  it("reserves the sublabel for the one value that needs disambiguating", () => {
    for (const value of EXECUTION_SUPPORT) {
      if (value === "not_yet_supported") continue;
      expect(RESPONSIBILITY_SUBLABELS[value]).toBeUndefined();
    }
  });
});

describe("stepSequenceStatus", () => {
  it("reads Ready now for the current entry point", () => {
    const current = step({ order: 1, dependsOn: [] });
    expect(stepSequenceStatus(current, [current], "start_here")).toEqual({
      label: "Ready now",
      state: "ready",
    });
  });

  it("reads Ready now for an also-ready step, same as Start Here", () => {
    const first = step({ order: 1, dependsOn: [] });
    const second = step({ order: 2, dependsOn: [] });
    expect(stepSequenceStatus(second, [first, second], "also_ready").label).toBe("Ready now");
  });

  it("does not call a validated agent change Done (ADR 0054, rule 66)", () => {
    // A `vibe` step completes on validation evidence alone: the change sits on
    // an isolated branch, unapproved and unmerged. ADR 0054 says the evidence
    // "does not mean approved, merged, deployed, live, safe", and rule 66
    // forbids rendering it as any of those. "Done" was exactly that rendering.
    const agentStep = step({ order: 1, actor: "vibe" });
    const status = stepSequenceStatus(agentStep, [agentStep], "done");

    expect(status.label).not.toBe("Done");
    expect(status.label).toBe("Ready to review");
    expect(status.state).toBe("done");
  });

  it.each(["founder_decision", "founder_input", "founder_action"] as const)(
    "still reads Done for a completed %s step, where it is true",
    (actor) => {
      const founderStep = step({ order: 1, actor });
      expect(stepSequenceStatus(founderStep, [founderStep], "done").label).toBe("Done");
    },
  );

  it("names the single prerequisite by title, not just its order", () => {
    const decision = step({ order: 1, title: "Choose a segment" });
    const dependent = step({ order: 2, dependsOn: [1] });
    const status = stepSequenceStatus(dependent, [decision, dependent], "waiting_on_steps");

    expect(status.state).toBe("waiting");
    expect(status.label).toBe("Waiting for step 1: Choose a segment");
  });

  it("summarizes rather than lists every prerequisite when there is more than one", () => {
    const a = step({ order: 1, title: "A" });
    const b = step({ order: 2, title: "B" });
    const dependent = step({ order: 3, dependsOn: [1, 2] });
    const status = stepSequenceStatus(dependent, [a, b, dependent], "waiting_on_steps");

    expect(status.label).toBe("Waiting for 2 earlier steps");
  });

  it("lands in the done state regardless of its dependencies", () => {
    // The default factory builds a `vibe` step, whose completed label is
    // deliberately not "Done" — see the ADR 0054 case above. What this pins is
    // that a completed step stops advertising its prerequisites either way.
    const finished = step({ order: 1, dependsOn: [2] });
    const earlier = step({ order: 2 });
    const status = stepSequenceStatus(finished, [earlier, finished], "done");

    expect(status.state).toBe("done");
    expect(status.label).not.toMatch(/^Waiting/);
  });
});

describe("planMetaSummary", () => {
  it("counts steps and pluralizes correctly", () => {
    expect(planMetaSummary([step({ order: 1 })])).toBe("1 step");
    expect(planMetaSummary([step({ order: 1 }), step({ order: 2 })])).toBe("2 steps");
  });

  it("adds a founder-decision count only when one exists, pluralized", () => {
    const noDecision = [step({ order: 1, actor: "vibe" })];
    expect(planMetaSummary(noDecision)).toBe("1 step");

    const oneDecision = [step({ order: 1, actor: "founder_decision" }), step({ order: 2 })];
    expect(planMetaSummary(oneDecision)).toBe("2 steps · 1 founder decision");

    const twoDecisions = [
      step({ order: 1, actor: "founder_decision" }),
      step({ order: 2, actor: "founder_decision" }),
      step({ order: 3 }),
    ];
    expect(planMetaSummary(twoDecisions)).toBe("3 steps · 2 founder decisions");
  });
});

/**
 * What the plan's panel says beside its steps (ACTION PLAN UI-2).
 *
 * One rule under all of it: the panel may restate the plan, never extend it.
 * So the tests that matter most here are the negative ones — a plan that
 * changes nothing claims no surface, a plan that needs nothing lists no demand,
 * and no function in this group ever produces a count of files or a duration.
 */

describe("planExpectedChange", () => {
  it("names the surfaces the cited evidence implies", () => {
    const surfaces = planExpectedChange([
      step({
        order: 1,
        changeKind: "product_change",
        evidenceIds: ["live.surface.pricing", "live.surface_absent.checkout_billing"],
      }),
    ]);

    expect(surfaces.map((surface) => surface.id)).toEqual(["pricing_page", "checkout_billing"]);
    expect(surfaces.map((surface) => surface.label)).toEqual([
      "Pricing page",
      "Checkout / billing",
    ]);
  });

  it("claims nothing for a plan that changes nothing", () => {
    expect(
      planExpectedChange([
        step({ order: 1, changeKind: "decision", evidenceIds: ["live.surface.pricing"] }),
        step({ order: 2, changeKind: "measurement", evidenceIds: ["live.surface.pricing"] }),
      ]),
    ).toEqual([]);
  });

  it("names a surface once however many steps cite it, in step order", () => {
    const surfaces = planExpectedChange([
      step({ order: 2, changeKind: "product_change", evidenceIds: ["live.surface.contact"] }),
      step({ order: 1, changeKind: "product_change", evidenceIds: ["live.surface.pricing"] }),
      step({ order: 3, changeKind: "product_change", evidenceIds: ["live.surface.pricing"] }),
    ]);

    expect(surfaces.map((surface) => surface.id)).toEqual(["pricing_page", "contact"]);
  });

  it("ignores an id no rule recognises rather than guessing a surface", () => {
    expect(
      planExpectedChange([
        step({ order: 1, changeKind: "product_change", evidenceIds: ["something.unknown"] }),
      ]),
    ).toEqual([]);
  });
});

describe("planFounderDemands", () => {
  const steps = [
    step({ id: "a", order: 1, executionSupport: "founder_decides", title: "Pick a price" }),
    step({ id: "b", order: 2, executionSupport: "vibe_prepares", title: "Build the page" }),
    step({ id: "c", order: 3, executionSupport: "founder_acts", title: "Tell your list" }),
  ];

  it("lists only what the founder still owes", () => {
    expect(planFounderDemands(steps, [])).toEqual(["Pick a price", "Tell your list"]);
  });

  it("stops asking for a step the plan has already recorded as complete", () => {
    expect(planFounderDemands(steps, [1])).toEqual(["Tell your list"]);
  });

  it("is empty when nothing is outstanding", () => {
    expect(planFounderDemands(steps, [1, 3])).toEqual([]);
  });

  it("never counts Vibe's own work as something the founder owes", () => {
    for (const support of EXECUTION_SUPPORT) {
      const demands = planFounderDemands([step({ order: 1, executionSupport: support })], []);
      const isFounders = support.startsWith("founder_");

      expect(demands.length).toBe(isFounders ? 1 : 0);
    }
  });
});

describe("founderQuestionCta", () => {
  it("offers nothing when no request is open", () => {
    expect(founderQuestionCta(0)).toBeNull();
    expect(founderQuestionCta(-1)).toBeNull();
  });

  it("counts the open requests, in singular and plural", () => {
    expect(founderQuestionCta(1)).toBe("Answer question");
    expect(founderQuestionCta(2)).toBe("Answer 2 questions");
  });
});

describe("planEvidenceSummary", () => {
  it("counts the ids the plan cites, not the pack it came from", () => {
    const summary = planEvidenceSummary([
      step({ id: "a", order: 1, evidenceIds: ["live.surface.pricing", "repo.surface.payments"] }),
      step({ id: "b", order: 2, evidenceIds: ["live.surface.pricing"] }),
    ]);

    expect(summary.signals).toBe(2);
    expect(summary.sources).toBeGreaterThan(0);
  });

  it("reports an uncited plan as zero rather than as a failure", () => {
    expect(planEvidenceSummary([step({ order: 1, evidenceIds: [] })])).toEqual({
      signals: 0,
      sources: 0,
    });
  });
});

/**
 * Which layer the plan screen believes about "can Vibe do this".
 *
 * There are three answers, and this screen used to render the weakest.
 * `executionSupport` is derived from the deterministic capability registry —
 * one entry — so a `vibe` + `product_change` step with no registry match is
 * stored `not_yet_supported` and read as "Not automated yet", while
 * `resolveStepExecution` classifies the same step `agentic` and the Agent
 * workspace offers to run it. Both sentences were true of the same step at the
 * same time, in the same product.
 */
describe("stepResponsibility", () => {
  const agentic = { intrinsicMode: "agentic", reason: "agentic_v1_eligible" } as const;

  /** A resolution that refused, and said why. */
  const refused = (reason: ExecutionResolutionReason) =>
    ({ intrinsicMode: "unsupported", reason }) as const;

  function step(executionSupport: ExecutionSupport) {
    return { executionSupport };
  }

  it("says an agent-buildable step could be built", () => {
    const responsibility = stepResponsibility(step("not_yet_supported"), agentic);

    expect(responsibility.headline).toBe("Vibe could build this");
    expect(responsibility.sublabel).toBe(
      "This is the kind of change Vibe could build for you.",
    );
  });

  /**
   * "Could build" is a capability statement and must never harden into a claim
   * that something is running — the reason `EXECUTION_MODE_LABELS` was written
   * before any screen rendered it.
   */
  it("promises nothing is already happening", () => {
    const { headline, sublabel } = stepResponsibility(step("not_yet_supported"), agentic);

    for (const text of [headline, sublabel ?? ""]) {
      expect(text.toLowerCase()).not.toContain("automatically");
      expect(text.toLowerCase()).not.toContain("running");
      expect(text.toLowerCase()).not.toContain("now");
    }
  });

  it("keeps today's answer when the route resolved nothing", () => {
    expect(stepResponsibility(step("not_yet_supported"), null)).toEqual({
      headline: "Vibe's work",
      sublabel: "Not automated yet",
    });
  });

  it("keeps today's answer when the refusal is about the step, not the repository", () => {
    // The row prints "Waiting for step N" from `stepSequenceStatus` right
    // below, so saying it again here would say one thing twice.
    const unchanged = { headline: "Vibe's work", sublabel: "Not automated yet" };
    const notYet = step("not_yet_supported");

    expect(stepResponsibility(notYet, refused("dependency_unsatisfied"))).toEqual(unchanged);
    expect(stepResponsibility(notYet, refused("risk_class_prohibited"))).toEqual(unchanged);
  });

  /**
   * The half of this screen's own argument that was never applied.
   *
   * The resolver is asked here because the stored classification knows only the
   * deterministic registry. When it answers *yes*, the row says so. When it
   * answered **no** it also said why — and that was thrown away, so a founder
   * one analyzer version behind read the same four words as one asking for
   * something Vibe genuinely cannot do.
   */
  it.each([
    ["repository_analysis_outdated", "predates this check"],
    ["no_lockfile", "no lockfile beside your app"],
    ["no_build_script", "no build script"],
    ["no_node_project", "no package.json"],
    ["workspace_choice_required", "more than one app"],
    ["package_manager_unsupported", "Yarn 3 or later"],
  ] as const)("names the repository fact behind %s", (reason, fragment) => {
    const responsibility = stepResponsibility(step("not_yet_supported"), refused(reason));

    expect(responsibility.headline).toBe("Vibe's work");
    expect(responsibility.sublabel).toContain(fragment);
  });

  /**
   * The refusal class the repository argument left out, found by a founder.
   *
   * A `vibe` step whose change kind is not `product_change` has no executor by
   * construction. "Not automated yet" reads as a feature Vibe has not shipped,
   * so the founder waits for it — and waits forever, because nothing was ever
   * coming. Both reasons say the true thing instead: this is not a change to
   * the product, so there is nothing to build.
   */
  it.each([
    ["no_executor_for_vibe_work", "own thinking work"],
    ["change_kind_not_executable", "nothing for Vibe to build"],
  ] as const)("names why there is no executor for %s", (reason, fragment) => {
    const responsibility = stepResponsibility(step("not_yet_supported"), refused(reason));

    expect(responsibility.headline).toBe("Vibe's work");
    expect(responsibility.sublabel).toContain(fragment);
    expect(responsibility.sublabel).not.toBe("Not automated yet");
  });

  it("never says a stale analysis is work Vibe has not automated", () => {
    // The sentence this replaces was not merely vague here, it was false: the
    // work is automated, and one free scan is the whole of what stands in the
    // way.
    expect(
      stepResponsibility(step("not_yet_supported"), refused("repository_analysis_outdated"))
        .sublabel,
    ).not.toBe("Not automated yet");
  });

  /**
   * A step waiting on an earlier one is still a step the agent could build.
   * The row prints its own "Waiting for step N" line from `stepSequenceStatus`
   * immediately below — two facts, neither contradicting the other.
   */
  it("reads a blocked-but-buildable step as buildable", () => {
    expect(stepResponsibility(step("not_yet_supported"), agentic).headline).toBe(
      "Vibe could build this",
    );
  });

  /** The deterministic path's meaning does not move. */
  it.each([
    ["vibe_executes_now", "Vibe can do this"],
    ["vibe_prepares", "Vibe can prepare this"],
    ["founder_decides", "Needs your decision"],
    ["founder_acts", "You'll need to do this"],
  ] as const)("leaves %s alone whatever the resolver says", (support, headline) => {
    expect(stepResponsibility(step(support), agentic)).toEqual({
      headline,
      sublabel: null,
    });
  });
});

/**
 * One control, two sentences — and they must not be swapped.
 *
 * A founder told "Your action" about a step the plan attributes to Vibe would
 * be right to think the product had changed its mind about who does what. And
 * a confirmation must never read as a claim that Vibe did the work: it says
 * the step's own completion criterion is true, which is all it has ever said.
 */
describe("attestationPrompt", () => {
  it("keeps real-world work reading as the founder's own", () => {
    const prompt = attestationPrompt({ actor: "founder_action" });

    expect(prompt.pill).toBe("Your action");
    expect(prompt.lead).toBeNull();
  });

  it("says Vibe cannot run it, and does not claim Vibe did", () => {
    const prompt = attestationPrompt({ actor: "vibe" });

    expect(prompt.pill).not.toBe("Your action");
    expect(prompt.lead).toContain("isn't a change to your product");
    expect(prompt.footnote).toContain("does not claim Vibe did the work");
  });
});
