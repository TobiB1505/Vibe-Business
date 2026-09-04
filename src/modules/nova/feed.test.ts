import { describe, expect, it } from "vitest";

import { findCausalClaims } from "../business-measurement/causality";
import type { OperationView } from "../operations/view";
import { NOVA_ACTION_META, isOfferable } from "./actions";
import type { AgentEconomicPolicy } from "../coding-agent/authorization";
import { creditsToUnits } from "../credits/units";
import { buildNovaAuditEntry, buildNovaExecutionOffer, buildNovaFeed } from "./feed";
import type { NovaEntry } from "./feed";
import { FOCUS_CANDIDATE_KINDS, deriveNovaFocus, novaCandidateAction } from "./focus";
import type { FocusCandidate, NovaFocus, NovaFocusFacts } from "./focus";

/**
 * The feed's contract, and its language.
 *
 * Nova's sentences are values rather than JSX, so the rules the rest of the
 * product asserts by reading its own source are ordinary assertions here —
 * including the one that matters most on a surface like this: a feed that
 * narrates a founder's business is exactly where an invented cause would go
 * unnoticed.
 */

function quiet(): NovaFocusFacts {
  return {
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
}

function focusWith(overrides: Partial<NovaFocusFacts>): NovaFocus {
  return deriveNovaFocus({ ...quiet(), ...overrides });
}

function change(stage: "validation_failed" | "awaiting_approval" | "ready_to_merge" | "merged") {
  return [{ preparedChangeId: "change-1", stage, headline: "A change" }];
}

const RUNNING: OperationView = {
  operationId: "op-1",
  status: "running",
  stage: "running_agent",
  startedAt: "2026-09-03T10:00:00.000Z",
  completedAt: null,
  failureCode: null,
  resultId: null,
  shouldPoll: true,
  retryAllowed: false,
  stalled: false,
};

/** Every candidate, built directly, so the copy table can be swept. */
const EVERY_CANDIDATE: FocusCandidate[] = [
  { kind: "source_disconnected" },
  { kind: "agent_failed" },
  { kind: "scan_failed" },
  { kind: "audit_failed" },
  { kind: "agent_stalled" },
  { kind: "scan_stalled" },
  { kind: "audit_stalled" },
  { kind: "validation_failed", preparedChangeId: "c1", headline: "h" },
  { kind: "merge_blocked", preparedChangeId: "c1", headline: "h" },
  { kind: "review_change", preparedChangeId: "c1", headline: "h" },
  { kind: "merge_ready", preparedChangeId: "c1", headline: "h" },
  { kind: "outcome_pending", preparedChangeId: "c1", headline: "h" },
  { kind: "agent_question", founderInputRequestId: "r1", question: "Which?", stepOrder: 1 },
  { kind: "founder_input_required", founderInputRequestId: "r1", question: "Which?", stepOrder: 1 },
  { kind: "execution_offered", stepOrder: 1, stepTitle: "Show the price" },
  { kind: "plan_offered", move: { id: "m1", rank: 1, title: "A move" } },
  { kind: "next_move_available", move: { id: "m1", rank: 1, title: "A move" } },
  { kind: "repository_read_outdated" },
  { kind: "workspace_choice_required" },
  { kind: "audit_outdated" },
  { kind: "nothing_to_do" },
];

function feedFor(primary: FocusCandidate): NovaEntry[] {
  return buildNovaFeed({
    primary,
    secondary: [],
    working: null,
    nextAction: novaCandidateAction(primary.kind),
  });
}

describe("what a feed is made of", () => {
  it("leads with a sentence about the primary candidate", () => {
    const entries = buildNovaFeed(focusWith({ changes: change("validation_failed") }));

    expect(entries[0]).toMatchObject({ kind: "nova.message", emphasis: "primary" });
  });

  it("offers the primary's control and nothing else's", () => {
    const entries = buildNovaFeed(
      focusWith({ changes: change("validation_failed"), auditOutdated: true }),
    );
    const choices = entries.filter((entry) => entry.kind === "nova.choice");

    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ options: [{ actionId: "nova.validate_again" }] });
  });

  it("keeps a second true thing visible, without a control", () => {
    const entries = buildNovaFeed(
      focusWith({ changes: change("validation_failed"), auditOutdated: true }),
    );
    const asides = entries.filter(
      (entry) => entry.kind === "nova.message" && entry.emphasis === "aside",
    );

    expect(asides).toHaveLength(1);
    expect(asides[0]).toMatchObject({ text: expect.stringContaining("audit") });
  });

  it("shows what is running as progress, not as something to decide", () => {
    const entries = buildNovaFeed(focusWith({ working: RUNNING }));
    const progress = entries.filter((entry) => entry.kind === "nova.progress");

    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ operation: RUNNING });
    expect(entries.some((entry) => entry.kind === "nova.choice")).toBe(false);
  });

  it("renders a question as a question rather than as a choice", () => {
    const entries = buildNovaFeed(
      focusWith({
        questions: [
          {
            founderInputRequestId: "req-1",
            question: "Which pricing model?",
            origin: "planner",
            stepOrder: 1,
          },
        ],
      }),
    );

    expect(entries.some((entry) => entry.kind === "nova.choice")).toBe(false);
    expect(entries.find((entry) => entry.kind === "nova.founder_question")).toMatchObject({
      founderInputRequestId: "req-1",
      question: "Which pricing model?",
      actionId: "nova.answer_plan_question",
    });
  });

  it("gives every entry an id that is stable and unique", () => {
    const entries = buildNovaFeed(
      focusWith({
        changes: [
          { preparedChangeId: "change-a", stage: "validation_failed", headline: "h" },
          { preparedChangeId: "change-b", stage: "awaiting_approval", headline: "h" },
        ],
        auditOutdated: true,
        working: RUNNING,
      }),
    );
    const ids = entries.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("says something even when there is nothing to do", () => {
    const entries = buildNovaFeed(focusWith({}));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "nova.message" });
  });
});

describe("what a control may be offered for", () => {
  it("never offers a control with nothing behind it", () => {
    for (const candidate of EVERY_CANDIDATE) {
      const actionId = novaCandidateAction(candidate.kind);
      if (actionId !== null && isOfferable(actionId)) continue;

      const offered = feedFor(candidate).filter((entry) => entry.kind === "nova.choice");
      expect(offered, candidate.kind).toEqual([]);
    }
  });

  /**
   * Offered since Stage 4 merged and brought `chooseWorkspaceRootAction` to
   * HEAD. It rendered a sentence and no button while the action lived only on
   * a branch; the sweep above is what kept that honest, and it is unchanged.
   */
  it("offers the workspace choice now that its action exists", () => {
    const entries = feedFor({ kind: "workspace_choice_required" });

    expect(entries.map((entry) => entry.kind)).toEqual(["nova.message", "nova.choice"]);
  });

  it("offers nothing at all when there is nothing to do", () => {
    expect(feedFor({ kind: "nothing_to_do" }).map((entry) => entry.kind)).toEqual(["nova.message"]);
  });

  it("carries the catalog's label, price and consequence, not its own", () => {
    const entries = feedFor({ kind: "plan_offered", move: { id: "m1", rank: 1, title: "A move" } });
    const choice = entries.find((entry) => entry.kind === "nova.choice");

    expect(choice).toMatchObject({
      options: [
        {
          actionId: "nova.plan_move",
          label: NOVA_ACTION_META["nova.plan_move"].label,
          price: "action_plan",
          consequential: true,
        },
      ],
    });
  });

  it("binds each control to the thing it acts on", () => {
    const merge = feedFor({ kind: "merge_ready", preparedChangeId: "change-9", headline: "h" });
    const move = feedFor({ kind: "plan_offered", move: { id: "move-9", rank: 1, title: "t" } });
    const step = feedFor({ kind: "execution_offered", stepOrder: 4, stepTitle: "t" });

    expect(merge.find((entry) => entry.kind === "nova.choice")).toMatchObject({
      options: [{ subject: { kind: "prepared_change", preparedChangeId: "change-9" } }],
    });
    expect(move.find((entry) => entry.kind === "nova.choice")).toMatchObject({
      options: [{ subject: { kind: "move", opportunityId: "move-9" } }],
    });
    expect(step.find((entry) => entry.kind === "nova.choice")).toMatchObject({
      options: [{ subject: { kind: "plan_step", stepOrder: 4 } }],
    });
  });
});

describe("what Nova's sentences may say", () => {
  const everyMessage = EVERY_CANDIDATE.flatMap((candidate) =>
    feedFor(candidate)
      .filter((entry) => entry.kind === "nova.message")
      .map((entry) => ({ kind: candidate.kind, text: entry.text })),
  );

  it("has a sentence for every candidate", () => {
    expect(everyMessage).toHaveLength(FOCUS_CANDIDATE_KINDS.length);
    for (const { kind, text } of everyMessage) {
      expect(text.length, kind).toBeGreaterThan(10);
    }
  });

  /**
   * Nova reports what other modules established. A cause is a claim about why
   * something happened, and no module here produced one — so a sentence
   * asserting one would be Nova's own invention, on the surface a founder
   * trusts most. This is the same detector `command-center-ui.test.ts` runs
   * over the Command Center's copy.
   */
  it("claims no causes", () => {
    /*
     * The detector proved live first. A sweep asserting `[]` over every
     * sentence passes just as cleanly when the detector is broken as when the
     * copy is clean, and the difference between those two is the whole value
     * of the test.
     */
    expect(findCausalClaims("This change caused conversions to rise.")).not.toEqual([]);

    for (const { kind, text } of everyMessage) {
      expect(findCausalClaims(text), `${kind}: ${text}`).toEqual([]);
    }
  });

  it("promises no deploy, ship, publish, release or pull request", () => {
    for (const { kind, text } of everyMessage) {
      expect(text, kind).not.toMatch(
        /\b(pull request|deploy|deployed|ship|shipped|publish|published|release|released|go live|is live)\b/i,
      );
    }
  });

  /** Nothing Vibe checked is thereby safe or correct (rules 66, 74). */
  it("calls nothing safe, correct, working or finished", () => {
    for (const { kind, text } of everyMessage) {
      expect(text, kind).not.toMatch(
        /\b(safe|safely|correct|guaranteed|bug-free|production ready|works now|it works)\b/i,
      );
    }
  });

  /**
   * A figure in a sentence is a second copy of something the interface renders
   * from state, and the two drift. The same rule the voice model is held to.
   */
  it("carries no figures", () => {
    for (const { kind, text } of everyMessage) {
      expect(text, kind).not.toMatch(/\d/);
    }
  });

  it("uses none of Vibe's internal vocabulary", () => {
    for (const { kind, text } of everyMessage) {
      expect(text, kind).not.toMatch(
        /\b(snapshot|snapshots|operation|operations|resolver|workflow|profile|intelligence)\b/i,
      );
    }
  });

  /**
   * `merged` means one sentence: the default branch points at the approved
   * commit (rule 74). The outcome message is the one most tempted to say more,
   * because a founder reading it wants to know whether it worked.
   */
  it("does not say a merged change did anything", () => {
    const merged = everyMessage.find((entry) => entry.kind === "outcome_pending");

    expect(merged?.text).toBeDefined();
    expect(merged?.text).not.toMatch(/\b(improved|working|succeeded|fixed|better)\b/i);
  });
});

describe("the audit as one entry", () => {
  const view = {
    overall: {
      score: 68,
      state: "partial" as const,
      stateLabel: "Taking shape",
      summary: "Solid product, weakest on the commercial side",
      scoredLenses: 7,
      eligibleLenses: 9,
    },
    nodes: [],
    relationships: [],
    primaryPriority: {
      headline: "Pricing clarity",
      whyItMatters: "The annual plan's price is not stated before signup",
    },
    additionalPriorityCount: 2,
    recentChanges: [],
    recentChangesUnavailableReason: null,
    sourceCount: 3,
    signalCount: 12,
    lastScanAt: null,
    usedSignedInEvidence: false,
  } as unknown as Parameters<typeof buildNovaAuditEntry>[0];

  it("takes every reading from the view model rather than re-deciding one", () => {
    const entry = buildNovaAuditEntry(view, { strengths: [] });

    expect(entry).toMatchObject({
      kind: "nova.audit",
      score: 68,
      stateLabel: "Taking shape",
      summary: "Solid product, weakest on the commercial side",
      priority: { headline: "Pricing clarity" },
      additionalPriorityCount: 2,
    });
  });

  /**
   * Rule 44: an unassessable audit is not a bad one. A `null` score travels as
   * null so the component can render "not enough evidence" — collapsing it to
   * zero here would make a missing measurement look like a failing grade, on
   * the surface a founder trusts most.
   */
  it("carries an unscored audit as unscored, never as zero", () => {
    const unscored = { ...view, overall: { ...view.overall, score: null } };
    const entry = buildNovaAuditEntry(
      unscored as unknown as Parameters<typeof buildNovaAuditEntry>[0],
      { strengths: [] },
    );

    expect(entry.score).toBeNull();
  });

  it("counts the remaining priorities rather than listing them", () => {
    const entry = buildNovaAuditEntry(view, { strengths: [] });

    expect(entry.additionalPriorityCount).toBe(2);
    expect(Object.keys(entry)).not.toContain("priorities");
  });

  it("reads its strengths through the one helper that knows the rules", () => {
    const entry = buildNovaAuditEntry(view, {
      strengths: [
        { headline: "", whyItMatters: null },
        { headline: "Offer is clear", whyItMatters: null },
      ],
    });

    expect(entry.strengths.map((strength) => strength.headline)).toEqual(["Offer is clear"]);
  });

  it("says nothing about a priority the audit did not name", () => {
    const none = { ...view, primaryPriority: null };
    const entry = buildNovaAuditEntry(
      none as unknown as Parameters<typeof buildNovaAuditEntry>[0],
      { strengths: [] },
    );

    expect(entry.priority).toBeNull();
  });
});

describe("the offer to build a step", () => {
  const budget = { maxCredits: creditsToUnits(200) } as AgentEconomicPolicy["budget"];
  const economics: AgentEconomicPolicy = {
    budget,
    nonProduction: false,
    disclosure: "",
  };

  function offer(overrides: Partial<Parameters<typeof buildNovaExecutionOffer>[0]> = {}) {
    return buildNovaExecutionOffer({
      stepOrder: 3,
      stepTitle: "Show the annual price",
      memberCount: 1,
      pricingClass: "standard",
      economics,
      ...overrides,
    });
  }

  /**
   * §L's invariant for this slice, and the reason the ceiling is handed in
   * rather than recomputed: this has to be the number the run reserves, not a
   * second calculation that agrees with it today.
   */
  it("shows the ceiling the economics resolved, and no other figure", () => {
    expect(offer()?.maxCredits).toBe(economics.budget.maxCredits);
  });

  it("offers nothing when the economics do not resolve", () => {
    expect(offer({ economics: null })).toBeNull();
  });

  it("binds the control to the step it would build", () => {
    expect(offer()?.option).toMatchObject({
      actionId: "nova.start_agent",
      subject: { kind: "plan_step", stepOrder: 3 },
    });
  });

  /** A run pushes a branch and spends. It asks again before it does either. */
  it("keeps the confirmation the catalog requires", () => {
    expect(offer()?.option.requiresConfirmation).toBe(true);
    expect(offer()?.option.confirmationNote).toBe(
      NOVA_ACTION_META["nova.start_agent"].confirmationNote,
    );
  });

  /**
   * §18 asks for a marker that is stated rather than derived: the dogfood
   * policy prices differently, and a screen that inferred it from the ceiling
   * would be guessing.
   */
  it("carries the non-production marker rather than inferring it", () => {
    expect(offer()?.nonProduction).toBe(false);
    expect(offer({ economics: { ...economics, nonProduction: true } })?.nonProduction).toBe(true);
  });

  /** A chain delivers several steps for one ceiling, and says how many. */
  it("says how many steps one run would deliver", () => {
    expect(offer({ memberCount: 3 })?.memberCount).toBe(3);
  });
});
