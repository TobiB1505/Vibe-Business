import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type { FounderInputRequest } from "@/modules/founder-input/schema";
import type { ActionPlanReadiness, ActionPlanView } from "@/modules/action-plans/service";
import { firstActionableStep, planProgress } from "@/modules/action-plans/sequence";
import type { StoredActionPlan } from "@/modules/action-plans/store";
import type { OperationView } from "@/modules/operations/view";
import { stepResponsibility, type StepResponsibility } from "@/modules/action-plans/view";

/**
 * Action Plan panel fixtures (ACTION PLANNER UI-1).
 *
 * Same reasoning as `scenarios.ts`: the panel is handed the exact shape the
 * real page assembles from `getActionPlanReadiness` / `getLatestActionPlan` /
 * `getActiveActionPlanOperation`, so the browser suite exercises the real
 * component rather than a stand-in, and cannot tell a fixture from
 * production. No AI call is made to produce any of this — it is written by
 * hand from the domain's own types, which is what keeps this suite free
 * (Rule 60 applies to test fixtures too: nothing here spends anything).
 */

const MOVE_TITLE = "Make your product findable in search";

function readiness(overrides: Partial<ActionPlanReadiness> = {}): ActionPlanReadiness {
  return {
    ready: true,
    blockedReason: null,
    auditId: "audit_e2e",
    opportunityId: "move_e2e",
    isDefaultMove: true,
    conclusionKey: "blocker-1",
    conclusionLineage: "direct",
    unresolvedSourceReason: null,
    ...overrides,
  };
}

function planStep(overrides: Partial<ActionPlanStep>): ActionPlanStep {
  return {
    id: "step",
    order: 1,
    title: "Step",
    description: "Description.",
    purpose: "Purpose.",
    actor: "vibe",
    changeKind: "analysis",
    completionCriteria: "Done when this is true.",
    dependsOn: [],
    evidenceIds: [],
    executionSupport: "vibe_prepares",
    capability: null,
    requiresApproval: false,
    ...overrides,
    founderInputRequirement: overrides.founderInputRequirement ?? null,
  };
}

/**
 * One step per `StepActor` / `ExecutionSupport` pairing this plan reasonably
 * produces, plus a dependency chain so "Start Here" and the waiting-state
 * badge both have something real to point at.
 *
 * Order 1 ("Draft the search-facing copy") deliberately depends on order 2
 * ("Decide which segment") rather than the other way around — narratively
 * backwards on purpose. It is the one arrangement that makes
 * `firstActionableStep` genuinely diverge from `steps[0]`: with the natural
 * ordering (decide, then draft), the array's first element and the domain's
 * actionable step are the same step, and a screen that quietly defaulted to
 * `steps[0]` would still pass. Here they disagree, so only a screen that
 * actually reads the server-derived first actionable step gets it right.
 */
const STEPS: ActionPlanStep[] = [
  planStep({
    id: "step-draft-copy",
    order: 1,
    title: "Draft the search-facing copy for that segment",
    description: "Vibe writes page titles and descriptions aimed at what that segment searches for.",
    purpose: "Search engines and visitors both need language that matches how people actually search.",
    actor: "vibe",
    changeKind: "analysis",
    completionCriteria: "A drafted set of titles and descriptions exists.",
    dependsOn: [2],
    executionSupport: "vibe_prepares",
  }),
  planStep({
    id: "step-decide-segment",
    order: 2,
    title: "Decide which segment to target first",
    description: "Choose the one customer segment this move is aimed at.",
    purpose: "Every later step depends on knowing who this is for.",
    actor: "founder_decision",
    changeKind: "decision",
    completionCriteria: "You have named one segment.",
    executionSupport: "founder_decides",
    founderInputRequirement: {
      kind: "decision",
      subjectKey: "audience.first_customer_segment",
      question: "Which customer segment should the business pursue first?",
      whyNeeded: "The search-facing copy depends on one confirmed audience.",
      responseType: "single_select",
      recommendation: {
        id: "independent-founders",
        label: "Independent founders",
        value: "Prioritize independent founders as the first customer segment.",
        explanation: "The current product evidence supports this segment most directly.",
      },
      alternatives: [
        {
          id: "small-product-teams",
          label: "Small product teams",
          value: "Prioritize small product teams as the first customer segment.",
          explanation: null,
        },
      ],
      allowCustom: true,
    },
  }),
  planStep({
    id: "step-seo-foundations",
    order: 3,
    title: "Publish the missing robots.txt and sitemap",
    description: "Vibe generates a robots.txt and sitemap so search engines can find and index the product.",
    purpose: "Search engines cannot index pages they are never told about.",
    actor: "vibe",
    changeKind: "product_change",
    completionCriteria: "robots.txt and sitemap.xml are both reachable.",
    dependsOn: [1],
    evidenceIds: ["live.seo.robots_txt_missing", "live.seo.sitemap_missing"],
    executionSupport: "vibe_executes_now",
    capability: "nextjs_seo_foundations_v2",
    requiresApproval: true,
  }),
  planStep({
    id: "step-submit-search-console",
    order: 4,
    title: "Submit the sitemap to Search Console",
    description: "Register the sitemap with Google Search Console once it is live.",
    purpose: "Registering the sitemap directly speeds up how quickly pages get indexed.",
    actor: "founder_action",
    changeKind: "external_setup",
    completionCriteria: "The sitemap shows as submitted in Search Console.",
    dependsOn: [3],
    executionSupport: "founder_acts",
  }),
  planStep({
    id: "step-wait-indexing",
    order: 5,
    title: "Wait for Google to index the new pages",
    description: "Indexing happens on Google's own schedule once the sitemap is submitted.",
    purpose: "Nothing changes what a visitor finds until this happens.",
    actor: "external_party",
    changeKind: "external_setup",
    completionCriteria: "The pages appear in Google's index.",
    dependsOn: [4],
    executionSupport: "external_dependency",
  }),
  planStep({
    id: "step-add-pricing-page",
    order: 6,
    title: "Build a dedicated pricing page",
    description: "A pricing page that explains the plans to a prospective customer.",
    purpose: "Vibe cannot yet write and ship a new page like this automatically.",
    actor: "vibe",
    changeKind: "product_change",
    completionCriteria: "A pricing page exists at a public URL.",
    executionSupport: "not_yet_supported",
  }),
];

function plan(overrides: Partial<StoredActionPlan> = {}): StoredActionPlan {
  return {
    id: "plan_e2e",
    projectId: "project_e2e",
    businessAuditId: "audit_e2e",
    opportunitySetId: "set_e2e",
    opportunityId: "move_e2e",
    inputHash: "hash_e2e",
    status: "completed",
    goal: "Make the product discoverable to people already searching for what it does.",
    whyNow:
      "The audit found this is the single largest gap between the business and its market: qualified visitors who are actively searching cannot find the product at all, and every other Move assumes there is traffic to convert.",
    expectedOutcome:
      "Search engines can find, index and rank the product's pages, and Search Console confirms it.",
    addressesRootProblem:
      "The business has no inbound channel from search, which this move directly opens.",
    assumptions: [
      "The chosen segment searches for a recognizable term related to the product.",
      "No existing robots.txt or sitemap is intentionally blocking indexing.",
    ],
    rootProblem: "No inbound channel from organic search",
    sourceConclusionKey: "blocker-1",
    sourceConclusionLineage: "direct",
    lenses: ["acquisition", "offer"],
    stepCount: STEPS.length,
    validationNotes: [],
    validationFindings: [],
    failureCode: null,
    contractVersion: "action-planner-contract-v1",
    plannerVersion: "action-planner-v2",
    promptVersion: "action-planner-prompt-v1",
    rubricVersion: "action-planner-rubric-v1",
    evidencePackVersion: "evidence-pack-v1",
    provider: "anthropic",
    model: "claude-opus-4",
    productProfileId: "profile_e2e",
    founderIntentHash: "intent_e2e",
    createdAt: "2026-08-14T18:00:00.000Z",
    completedAt: "2026-08-14T18:00:42.000Z",
    steps: STEPS,
    ...overrides,
  };
}

/**
 * `firstActionableStep` / `planProgress` are the real, already-unit-tested
 * `sequence.ts` functions — not a guess at what they'd return. A hand-picked
 * value here could quietly drift from what the domain actually computes; the
 * real function can't.
 */
function planView(overrides: Partial<ActionPlanView> = {}): ActionPlanView {
  const storedPlan = overrides.plan ?? plan();
  const actionable = firstActionableStep(storedPlan.steps);
  const founderInputRequest =
    "founderInputRequest" in overrides
      ? (overrides.founderInputRequest ?? null)
      : actionable?.founderInputRequirement
        ? ({
            id: "request_e2e",
            projectId: storedPlan.projectId,
            actionPlanId: storedPlan.id,
            actionPlanStepKey: actionable.id,
            executionInterruptId: null,
            origin: "planner",
            ...actionable.founderInputRequirement,
            contextHash: storedPlan.inputHash,
            status: "open",
            createdAt: "2026-08-14T18:00:42.000Z",
            resolvedAt: null,
          } satisfies FounderInputRequest)
        : null;

  return {
    plan: storedPlan,
    staleness: [],
    firstActionableStep: actionable,
    progress: planProgress(storedPlan.steps),
    ...overrides,
    completedStepOrders: overrides.completedStepOrders ?? [],
    absorbedByStepOrder: overrides.absorbedByStepOrder ?? {},
    founderInputRequest,
    // Derived from the request the fixture just built, so a scenario can never
    // claim open questions it does not carry.
    openFounderInputCount:
      overrides.openFounderInputCount ?? (founderInputRequest?.status === "open" ? 1 : 0),
  };
}

function operation(overrides: Partial<OperationView> = {}): OperationView {
  return {
    operationId: "operation_e2e",
    status: "running",
    stage: "planning",
    startedAt: "2026-08-17T10:00:00.000Z",
    completedAt: null,
    failureCode: null,
    resultId: null,
    shouldPoll: true,
    retryAllowed: false,
    stalled: false,
    ...overrides,
  };
}

export type ActionPlanFixture = {
  /** Which Move the panel is rendered for — mirrors `readiness.opportunityId` (§83). */
  opportunityId: string | null;
  moveTitle: string | null;
  /** The engine's own rank-1 title, for the priority-deviation disclosure. */
  defaultMoveTitle: string | null;
  readiness: ActionPlanReadiness;
  planView: ActionPlanView | null;
  activeOperation: OperationView | null;
  /**
   * What each step's responsibility line says, as the route resolves it.
   *
   * Absent means "the route resolved nothing for this plan", which is a real
   * state and renders the stored classification exactly as it always did.
   */
  responsibilityByStepKey?: Record<string, StepResponsibility>;
};

export const E2E_ACTION_PLAN_SCENARIOS = {
  /** No plan exists yet, and nothing blocks starting one. */
  action_plan_ready_to_start: (): ActionPlanFixture => ({
    opportunityId: "move_e2e",
    moveTitle: MOVE_TITLE,
    defaultMoveTitle: MOVE_TITLE,
    readiness: readiness(),
    planView: null,
    activeOperation: null,
  }),

  /** No Move exists yet — the block a founder sees before ever reaching this move. */
  action_plan_blocked_move_missing: (): ActionPlanFixture => ({
    opportunityId: null,
    moveTitle: null,
    defaultMoveTitle: null,
    readiness: readiness({ ready: false, blockedReason: "move_missing", opportunityId: null }),
    planView: null,
    activeOperation: null,
  }),

  /** The audit itself is missing — routes at the business audit, not next moves. */
  action_plan_blocked_audit_missing: (): ActionPlanFixture => ({
    opportunityId: null,
    moveTitle: null,
    defaultMoveTitle: null,
    readiness: readiness({
      ready: false,
      blockedReason: "audit_missing",
      auditId: null,
      opportunityId: null,
    }),
    planView: null,
    activeOperation: null,
  }),

  /** An explicitly requested Move no longer names anything current (§83). */
  action_plan_blocked_move_not_found: (): ActionPlanFixture => ({
    opportunityId: null,
    moveTitle: null,
    defaultMoveTitle: MOVE_TITLE,
    readiness: readiness({ ready: false, blockedReason: "move_not_found", opportunityId: null }),
    planView: null,
    activeOperation: null,
  }),

  /**
   * A founder chose a Move other than the engine's own rank 1 (§83). The
   * disclosure must say so — never render identically to `action_plan_ready`.
   */
  action_plan_priority_deviation: (): ActionPlanFixture => ({
    opportunityId: "move_e2e_seo",
    moveTitle: "Add discoverability foundations",
    defaultMoveTitle: MOVE_TITLE,
    readiness: readiness({ opportunityId: "move_e2e_seo", isDefaultMove: false }),
    planView: null,
    activeOperation: null,
  }),

  /** A plan is being generated. Ambient copy only — no fake percentage. */
  action_plan_planning: (): ActionPlanFixture => ({
    opportunityId: "move_e2e",
    moveTitle: MOVE_TITLE,
    defaultMoveTitle: MOVE_TITLE,
    readiness: readiness(),
    planView: null,
    activeOperation: operation(),
  }),

  /** A completed plan, covering every actor and every execution-support value. */
  action_plan_ready: (): ActionPlanFixture => ({
    opportunityId: "move_e2e",
    moveTitle: MOVE_TITLE,
    defaultMoveTitle: MOVE_TITLE,
    readiness: readiness(),
    planView: planView(),
    activeOperation: null,
  }),

  /** Prior authoritative evidence has advanced the plan to manual founder work. */
  action_plan_founder_action: (): ActionPlanFixture => {
    const completed = new Set([1, 2, 3]);
    return {
      opportunityId: "move_e2e",
      moveTitle: MOVE_TITLE,
      defaultMoveTitle: MOVE_TITLE,
      readiness: readiness(),
      planView: planView({
        firstActionableStep: firstActionableStep(STEPS, completed),
        progress: planProgress(STEPS, completed),
        completedStepOrders: [...completed],
        founderInputRequest: null,
      }),
      activeOperation: null,
    };
  },

  /**
   * A step a successful run covered rather than carried out (ADR 0089).
   *
   * Step 1 is `vibe` + `analysis`, which `classifyExecutionDependency` folds
   * into the run built for step 3. Once that run has succeeded, verified and
   * validated, step 1 needs nobody to do it — but it was never executed on its
   * own, and a row marked done would erase that. The scene exists to prove the
   * row says which run covered it, and does not claim it was finished.
   */
  action_plan_absorbed_step: (): ActionPlanFixture => {
    const completed = new Set([2, 3]);
    return {
      opportunityId: "move_e2e",
      moveTitle: MOVE_TITLE,
      defaultMoveTitle: MOVE_TITLE,
      readiness: readiness(),
      planView: planView({
        firstActionableStep: firstActionableStep(STEPS, new Set([1, 2, 3])),
        progress: planProgress(STEPS, new Set([1, 2, 3])),
        completedStepOrders: [...completed],
        absorbedByStepOrder: { 1: 3 },
        founderInputRequest: null,
      }),
      activeOperation: null,
    };
  },

  /**
   * The step that could be completed by nothing at all (Sprint 0141).
   *
   * "Draft the search-facing copy" is `vibe` + `analysis`: Vibe's own work,
   * which `resolveStepExecution` refuses because it is not a `product_change`.
   * No run produces it, no founder resolution covers it, and until ADR 0088 no
   * attestation reached it — so once the decision in front of it was answered,
   * the plan stopped here permanently and every later step went with it.
   *
   * The scene exists because that is invisible in the domain: every unit test
   * passed while the screen showed a step marked "Start here" with nothing
   * under it to start.
   */
  action_plan_vibe_no_executor: (): ActionPlanFixture => {
    const completed = new Set([2]);
    return {
      opportunityId: "move_e2e",
      moveTitle: MOVE_TITLE,
      defaultMoveTitle: MOVE_TITLE,
      readiness: readiness(),
      planView: planView({
        firstActionableStep: firstActionableStep(STEPS, completed),
        progress: planProgress(STEPS, completed),
        completedStepOrders: [...completed],
        founderInputRequest: null,
      }),
      activeOperation: null,
    };
  },

  /**
   * The step the agent could build, said honestly.
   *
   * "Build a dedicated pricing page" is `vibe` + `product_change` with no
   * registry capability, so the stored classification is `not_yet_supported`
   * and the screen read "Not automated yet" — while the execution resolver
   * classifies exactly this shape `agentic` and the Agent workspace offers to
   * run it.
   */
  action_plan_agentic_step: (): ActionPlanFixture => ({
    opportunityId: "move_e2e",
    moveTitle: MOVE_TITLE,
    defaultMoveTitle: MOVE_TITLE,
    readiness: readiness(),
    planView: planView({}),
    activeOperation: null,
    responsibilityByStepKey: {
      "step-add-pricing-page": stepResponsibility(
        { executionSupport: "not_yet_supported" },
        { intrinsicMode: "agentic", reason: "agentic_v1_eligible" },
      ),
    },
  }),

  /**
   * The same step, refused — and the refusal says which repository fact.
   *
   * The counterpart of the scene above, and the half that was missing. The
   * resolver is asked on this screen precisely because the stored
   * classification knows only the deterministic registry; when it answers
   * *yes* the row says so, and when it answered **no** it said why and the
   * screen dropped it. `repository_analysis_outdated` is the sharpest case:
   * "Not automated yet" is not vague there, it is false — the work is
   * automated and one free scan is the whole of what stands in the way.
   */
  action_plan_repository_blocked: (): ActionPlanFixture => ({
    opportunityId: "move_e2e",
    moveTitle: MOVE_TITLE,
    defaultMoveTitle: MOVE_TITLE,
    readiness: readiness(),
    planView: planView({}),
    activeOperation: null,
    responsibilityByStepKey: {
      "step-add-pricing-page": stepResponsibility(
        { executionSupport: "not_yet_supported" },
        { intrinsicMode: "unsupported", reason: "repository_analysis_outdated" },
      ),
    },
  }),

  /** The same plan, but the audit has since moved. */
  action_plan_stale: (): ActionPlanFixture => ({
    opportunityId: "move_e2e",
    moveTitle: MOVE_TITLE,
    defaultMoveTitle: MOVE_TITLE,
    readiness: readiness(),
    planView: planView({ staleness: ["audit_superseded", "move_superseded"] }),
    activeOperation: null,
  }),

  /** Planning failed. No provider internals reach the screen. */
  action_plan_failed: (): ActionPlanFixture => ({
    opportunityId: "move_e2e",
    moveTitle: MOVE_TITLE,
    defaultMoveTitle: MOVE_TITLE,
    readiness: readiness(),
    planView: null,
    activeOperation: operation({
      status: "failed",
      stage: "planning",
      failureCode: "action_planning_failed",
      shouldPoll: false,
      retryAllowed: true,
    }),
  }),
} as const;

export type E2eActionPlanScenario = keyof typeof E2E_ACTION_PLAN_SCENARIOS;

export function isE2eActionPlanScenario(value: string): value is E2eActionPlanScenario {
  return Object.hasOwn(E2E_ACTION_PLAN_SCENARIOS, value);
}
