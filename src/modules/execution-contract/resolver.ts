import {
  matchCapability,
  type CapabilityMatchContext,
} from "@/modules/action-plans/capability-registry";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type { ExecutionCapability } from "@/modules/execution/schema";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import { classifyExecutionRisk } from "./risk";
import { resolveExecutionValidation } from "./validation-requirements";
import {
  CURRENT_AGENTIC_EXECUTION_CLASS,
  EXECUTION_RESOLVER_VERSION,
  EXECUTION_RISK_POLICY_VERSION,
  MAX_AGENTIC_V1_RISK,
  riskExceeds,
  type ExecutionAdmission,
  type ExecutionClass,
  type ExecutionMode,
  type ExecutionResolution,
  type ExecutionResolutionReason,
  type ExecutionRiskClass,
} from "./schema";

/**
 * The Execution Resolver (EXECUTION CORE-3 §6, §7, §20, §27, §37).
 *
 * ## The authority rule this file is
 *
 * > Planner intent is input. The Execution Resolver is authority.
 *
 * The Planner's own `executionSupport` and `capability` fields are **not read
 * here at all**. Not consulted, not cross-checked, not used as a hint. That is
 * not distrust of the Planner — those fields are server-derived and correct at
 * the time they were written. It is that they were written *then*, against a
 * repository snapshot and a capability registry that may since have moved, and
 * a stored classification is a routing signal rather than permission (Rule 55).
 *
 * So the resolver re-derives everything from first principles: the step's
 * structured fields, the current registry, the current snapshot, the current
 * validation profile. A plan that says `vibe_executes_now` and a project whose
 * repository no longer matches the capability produce `unsupported` — which is
 * exactly the case §41 asks to be tested.
 *
 * ## Deterministic, and deliberately so (§37)
 *
 * No AI call, no provider, no network. Given the same step, plan, snapshot and
 * registry, this returns the same answer forever. Future AI may write code;
 * the safety and classification boundary stays deterministic, because a
 * classification a model could influence is a classification an injected
 * README could influence.
 *
 * ## Precedence (§7, §27)
 *
 * ```
 * 1. unfinished prerequisites            → blocked        (§27)
 * 2. the step is not Vibe's to do        → needs_user_input / manual / blocked
 * 3. an existing deterministic executor  → deterministic  (§7)
 * 4. the bounded agentic boundary        → agentic        (§20)
 * 5. everything else                     → unsupported
 * ```
 *
 * Deterministic before agentic is not an implementation convenience — §7 makes
 * it a rule. An existing executor is cheaper, more predictable, easier to
 * validate and has no model variance, and agentic execution exists to cover
 * what deterministic engineering cannot reach rather than to replace it.
 */

/* ---------------------------------------------------------------------------
 * Input
 * ------------------------------------------------------------------------ */

/** The live repository facts admission needs. Null when they could not be read. */
export type LiveRepositoryHead = {
  defaultBranch: string;
  commitSha: string;
};

export type RepositoryContext = {
  /** The connected repository, or null when none is. */
  connection: { id: string; fullName: string; defaultBranch: string } | null;
  /** The newest successful snapshot, or null when none exists. */
  snapshot: RepositoryIntelligenceSnapshot | null;
  snapshotId: string | null;
  /** The commit that snapshot analyzed. */
  snapshotCommitSha: string | null;
  /** Whether that snapshot is still the newest successful one. */
  snapshotIsLatest: boolean;
  /**
   * GitHub's current default-branch HEAD, or null when it could not be read.
   *
   * Null is a real state, not an error: a report can still classify every step
   * honestly without it, and admission simply refuses (§16, §29).
   */
  liveHead: LiveRepositoryHead | null;
};

export type PlanContext = {
  /** Every step in the plan, so prerequisites can be named. */
  steps: readonly ActionPlanStep[];
  /**
   * Step orders recorded as finished.
   *
   * Empty today — nothing in the product completes a step yet, exactly as
   * `action-plans/sequence.ts` documents. Threaded through rather than assumed
   * so that the moment completion exists, dependency resolution is already
   * correct rather than needing to be rediscovered.
   */
  completedSteps: ReadonlySet<number>;
  /** Whether this plan is still the project's current one. */
  isCurrent: boolean;
};

export type ResolveExecutionInput = {
  step: ActionPlanStep;
  plan: PlanContext;
  repository: RepositoryContext;
  /**
   * Whether an authorized Credit budget policy exists for agentic work.
   *
   * False today (`budget.ts` has no approved policy). Passed in rather than
   * read here so the resolver stays a pure function of its inputs.
   */
  agenticBudgetAuthorized: boolean;
};

/* ---------------------------------------------------------------------------
 * Resolution
 * ------------------------------------------------------------------------ */

type Classification = {
  mode: ExecutionMode;
  reason: ExecutionResolutionReason;
  executionClass: ExecutionClass | null;
  capability: ExecutionCapability | null;
  capabilityVersion: string | null;
  unmet: ExecutionResolutionReason[];
};

/**
 * What this step would resolve to with nothing standing in front of it.
 *
 * Split out from `resolveStepExecution` so the same logic produces both the
 * authoritative answer and the forecast a blocked step carries. There is one
 * implementation, so the forecast can never disagree with what actually happens
 * once the prerequisite completes.
 */
function classifyIntrinsic(input: ResolveExecutionInput): Classification {
  const { step, repository } = input;
  const unmet: ExecutionResolutionReason[] = [];

  switch (step.actor) {
    case "founder_decision":
      // The one mode that means "nothing can be decided for you". §28: an
      // approved founder decision is structured Execution context; until it
      // exists, execution has no premise to work from.
      return {
        mode: "needs_user_input",
        reason: "founder_decision_required",
        executionClass: null,
        capability: null,
        capabilityVersion: null,
        unmet,
      };

    case "founder_action":
      return {
        mode: "manual",
        reason: "founder_action_required",
        executionClass: null,
        capability: null,
        capabilityVersion: null,
        unmet,
      };

    case "external_party":
      // A dependency that is not satisfied and never will be by Vibe. Not a
      // failure, and never described as one.
      return {
        mode: "blocked",
        reason: "external_party_required",
        executionClass: null,
        capability: null,
        capabilityVersion: null,
        unmet,
      };

    case "vibe":
      break;
  }

  const risk = classifyExecutionRisk({
    changeKind: step.changeKind,
    evidenceIds: step.evidenceIds,
  });

  /*
   * Deterministic first (§7).
   *
   * Re-matched against the *current* registry and the *current* snapshot, which
   * is what makes the Planner non-authoritative: a plan step carrying
   * `capability: "nextjs_seo_foundations_v2"` from last week gets no weight
   * here, and a project whose repository has since grown a robots.txt correctly
   * stops matching.
   */
  const capabilityContext: CapabilityMatchContext = { repository: repository.snapshot };
  const match =
    risk === "prohibited"
      ? null
      : matchCapability(
          { changeKind: step.changeKind, evidenceIds: step.evidenceIds },
          capabilityContext,
        );

  if (match) {
    return {
      mode: "deterministic",
      reason: "deterministic_capability_matched",
      executionClass: null,
      capability: match.capability,
      capabilityVersion: match.capabilityVersion,
      unmet,
    };
  }

  // Vibe's own reasoning work — the planner's `vibe_prepares` shape. Real work,
  // genuinely Vibe's, and no executor produces it on a click (§7 of CORE-2b).
  if (step.changeKind !== "product_change") {
    return {
      mode: "unsupported",
      reason:
        step.changeKind === "analysis" || step.changeKind === "measurement"
          ? "no_executor_for_vibe_work"
          : "change_kind_not_executable",
      executionClass: null,
      capability: null,
      capabilityVersion: null,
      unmet,
    };
  }

  /*
   * The bounded agentic boundary (§20).
   *
   * Every gate below is a *capability of this system*, checked against
   * deterministic facts. None of them is a judgement about the task's wording,
   * and none of them can be satisfied by a model asserting anything.
   */
  if (risk === "prohibited") {
    return {
      mode: "unsupported",
      reason: "risk_class_prohibited",
      executionClass: null,
      capability: null,
      capabilityVersion: null,
      unmet: ["risk_class_prohibited"],
    };
  }

  if (riskExceeds(risk, MAX_AGENTIC_V1_RISK)) {
    unmet.push("risk_class_not_permitted");
  }

  if (!repository.connection) {
    unmet.push("repository_not_connected");
  }

  if (!repository.snapshot) {
    unmet.push("repository_snapshot_missing");
  } else {
    // §53: the required validation profile must be real and derived from this
    // repository. No profile means no way to prove a change is anything, and
    // §31 forbids letting the agent's own claim stand in for one.
    const validation = resolveExecutionValidation(repository.snapshot);
    if (!validation.supported) unmet.push("validation_profile_unsupported");
  }

  if (unmet.length > 0) {
    return {
      mode: "unsupported",
      reason: unmet[0],
      executionClass: null,
      capability: null,
      capabilityVersion: null,
      unmet,
    };
  }

  return {
    mode: "agentic",
    reason: "agentic_v1_eligible",
    executionClass: CURRENT_AGENTIC_EXECUTION_CLASS,
    capability: null,
    capabilityVersion: null,
    unmet,
  };
}

/**
 * Live-state and money gates (§16, §24, §29, §49, §52).
 *
 * Evaluated only for modes Vibe could actually carry out. A `manual` step is
 * not "inadmissible" — the concept does not apply to it — so admission is
 * refused with `not_executable_mode` and no live state is consulted at all.
 */
function evaluateAdmission(
  input: ResolveExecutionInput,
  mode: ExecutionMode,
): ExecutionAdmission {
  if (mode !== "agentic" && mode !== "deterministic") {
    return { admissible: false, refusal: "not_executable_mode" };
  }

  if (!input.plan.isCurrent) {
    return { admissible: false, refusal: "action_plan_superseded" };
  }

  const { repository } = input;

  if (!repository.snapshotIsLatest) {
    return { admissible: false, refusal: "repository_snapshot_stale" };
  }

  // The premise must be re-established from live state, never inherited from
  // the evidence chain (Rule 55, ADR 0014). An unread HEAD is not "probably
  // unchanged" — it is unknown, and unknown is a refusal.
  if (!repository.liveHead) {
    return { admissible: false, refusal: "source_revision_unverified" };
  }

  if (
    repository.snapshotCommitSha === null ||
    repository.liveHead.commitSha !== repository.snapshotCommitSha
  ) {
    // No merge reasoning, no rebase, no cleverness. A moved default branch
    // blocks (§16, Rule 56).
    return { admissible: false, refusal: "repository_head_moved" };
  }

  if (mode === "agentic" && !input.agenticBudgetAuthorized) {
    return { admissible: false, refusal: "agentic_pricing_not_configured" };
  }

  return { admissible: true };
}

/**
 * Resolves one Action Plan step (§6).
 *
 * Total: every step gets a truthful answer, and there is no "unknown" outcome.
 */
export function resolveStepExecution(input: ResolveExecutionInput): ExecutionResolution {
  const { step, plan } = input;

  const risk: ExecutionRiskClass = classifyExecutionRisk({
    changeKind: step.changeKind,
    evidenceIds: step.evidenceIds,
  });

  const intrinsic = classifyIntrinsic(input);

  // §27: a blocked step cannot become ready merely because a capability
  // exists. Dependencies are checked *after* the intrinsic classification so
  // the forecast is available, and *before* the mode is decided so nothing
  // downstream can act on it.
  const blockedBy = step.dependsOn
    .filter((order) => !plan.completedSteps.has(order))
    .slice()
    .sort((a, b) => a - b);

  const blocked = blockedBy.length > 0;
  const mode: ExecutionMode = blocked ? "blocked" : intrinsic.mode;
  const reason: ExecutionResolutionReason = blocked
    ? "dependency_unsatisfied"
    : intrinsic.reason;

  return {
    resolverVersion: EXECUTION_RESOLVER_VERSION,
    riskPolicyVersion: EXECUTION_RISK_POLICY_VERSION,

    stepOrder: step.order,
    stepKey: step.id,

    mode,
    intrinsicMode: intrinsic.mode,
    reason,
    riskClass: risk,
    executionClass: blocked ? null : intrinsic.executionClass,

    capability: blocked ? null : intrinsic.capability,
    capabilityVersion: blocked ? null : intrinsic.capabilityVersion,

    blockedBy,
    unmetRequirements: blocked ? ["dependency_unsatisfied", ...intrinsic.unmet] : intrinsic.unmet,

    requiresUserInput: intrinsic.mode === "needs_user_input",

    admission: evaluateAdmission(input, mode),
  };
}

/** Resolves every step in a plan, in plan order. */
export function resolvePlanExecution(
  input: Omit<ResolveExecutionInput, "step">,
): ExecutionResolution[] {
  return [...input.plan.steps]
    .sort((a, b) => a.order - b.order)
    .map((step) => resolveStepExecution({ ...input, step }));
}
