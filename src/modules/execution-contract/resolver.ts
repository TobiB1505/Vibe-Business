import {
  matchCapability,
  type CapabilityMatchContext,
} from "@/modules/action-plans/capability-registry";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type { ExecutionCapability } from "@/modules/execution/schema";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import { resolveExecutionDependencies } from "./dependencies";
import { classifyExecutionRisk } from "./risk";
import type { ValidationBlockReason } from "@/modules/validation/schema";
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
 * 1. the step is not Vibe's to do        → needs_user_input / manual / blocked
 * 2. an existing deterministic executor  → deterministic  (§7)
 * 3. the bounded agentic boundary        → agentic        (§20)
 * 4. everything else                     → unsupported
 * ─── then, against that route ───
 * 5. hard unfinished prerequisites       → blocked        (§27)
 * ```
 *
 * ## Which prerequisites are hard (Core-4 semantics fix)
 *
 * Not all of them. A Planner step describes *what work is needed*; it does not
 * define one runtime execution boundary per step. When the route is agentic,
 * `dependencies.ts` separates prerequisites that must already exist — a founder
 * decision, real-world work, an external party, a product change — from Vibe's
 * own technical preparation, which the same bounded run performs itself.
 *
 * Preparation is absorbed and recorded; it is never marked complete, and the
 * plan is never rewritten. One hard prerequisite still blocks everything.
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
   * Threaded through rather than assumed, and the caller decides what "finished"
   * means. There are two honest answers and this is the narrower one: a step
   * counts here when the next step could actually be built on top of it, which
   * for an agent step means its change is on the default branch
   * (`completedStepsForExecutionRouting`). The plan screen asks the wider
   * question and answers it from a passed validation (ADR 0054).
   *
   * It was empty for a long time, and the comment saying so outlived the fact
   * by several sprints: ADR 0054 shipped the projection, and nothing passed it
   * here. A validated, merged step went on reading as an unfinished
   * prerequisite, so its successor was permanently unstartable and the screen
   * told the founder an earlier step had to finish first.
   */
  completedSteps: ReadonlySet<number>;
  /** Whether this plan is still the project's current one. */
  isCurrent: boolean;
};

/**
 * Whether the live-product defects this step cites are still real (Rule 55).
 *
 * A step's `evidenceIds` name what it is for, and the `live.*` ones are minted
 * only while the defect is present — `business-audit/evidence.ts` appends
 * `_missing` to a signal's id exactly when `signal.present` is false, so a
 * fixed defect does not flip a boolean, its id stops being minted at all.
 * Re-running the scan and rebuilding the pack therefore answers "is this still
 * true?" by set membership, with no threshold and no comparison of values.
 *
 * Passed in rather than observed here, for the same reason `liveHead` is: the
 * resolver is a pure function of its inputs, and a crawl is I/O. The caller
 * that can do the crawl decides; this module only refuses on the verdict.
 *
 * Three states, because two would lie. `verified` means a fresh-enough pack
 * still mints every cited id. `stale` means at least one is gone — the premise
 * was true when the plan was written and is not now. `unverified` means the
 * scan could not establish it, which a budget-degraded `partial` snapshot
 * (Rule 39) produces whenever it did not reach the cited surface; that is not
 * evidence of a fix, and it refuses rather than passing.
 */
export type LiveEvidenceContext =
  | { status: "verified" }
  | { status: "stale"; fixedEvidenceIds: readonly string[] }
  | { status: "unverified"; reason: string }
  /**
   * The step cites no `live.*` evidence at all, so there is nothing to
   * revalidate and no scan was run. Distinct from `verified` so that "we
   * checked and it holds" is never confused with "there was nothing to check".
   */
  | { status: "not_applicable" };

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
  /**
   * The live-premise verdict, or `undefined` where no caller established one.
   *
   * Optional, and deliberately *not* refused on when absent. Report-shaped
   * callers classify every step in a plan and spend nothing; forcing a crawl
   * per step to render a list would be absurd, and refusing without one would
   * print "this is already fixed" next to steps nobody looked at — a false
   * statement, which is worse than a missing one.
   *
   * So the obligation is split. This module refuses a verdict that came back
   * *bad*; requiring that a verdict exist at all belongs to the path that
   * spends money, immediately in front of the Credit hold. That mirrors how
   * `liveHead` works one field up, where the reading is done by the caller
   * that can do I/O and the refusal is decided here.
   */
  liveEvidence?: LiveEvidenceContext;
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

    case "founder_input":
      return {
        mode: "needs_user_input",
        reason: "founder_input_required",
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
    if (!validation.supported) unmet.push(unmetFor(validation.reason));
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
function evaluateAdmission(input: ResolveExecutionInput, mode: ExecutionMode): ExecutionAdmission {
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

  // The live premise, on the same footing as the repository one above: a
  // defect the step cites and that a fresh scan no longer finds is a premise
  // that stopped being true, and running against it spends the user's money to
  // produce nothing (three of five calibration fixtures did exactly that).
  //
  // Only a verdict that came back bad refuses here. An absent verdict does
  // not — see `liveEvidence`'s own note for why the plan report must not print
  // "already fixed" beside steps nobody checked, and where the obligation to
  // *have* a verdict lives instead.
  if (input.liveEvidence?.status === "stale") {
    return { admissible: false, refusal: "live_premise_no_longer_true" };
  }

  if (input.liveEvidence?.status === "unverified") {
    return { admissible: false, refusal: "live_premise_unverified" };
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

  /*
   * §27, as amended by the Core-4 semantics fix.
   *
   * A blocked step still cannot become ready merely because a capability
   * exists — dependencies are checked *after* the intrinsic classification so
   * the forecast is available, and *before* the mode is decided so nothing
   * downstream can act on it.
   *
   * What changed is which unfinished prerequisites count. `dependencies.ts`
   * separates the ones that must already exist from Vibe's own technical
   * preparation, and the latter is absorbed into the run rather than standing
   * in front of it. `absorbable` is the gate: only an agentic route can carry
   * preparation, so every other mode gets the pre-fix behaviour unchanged.
   */
  const dependencies = resolveExecutionDependencies({
    step,
    steps: plan.steps,
    completed: plan.completedSteps,
    capabilityContext: { repository: input.repository.snapshot },
    absorbable: intrinsic.mode === "agentic",
  });

  const blockedBy = dependencies.hardBlockers;
  const blocked = blockedBy.length > 0;
  const mode: ExecutionMode = blocked ? "blocked" : intrinsic.mode;
  const dependencyReason: ExecutionResolutionReason = dependencies.cycleDetected
    ? "dependency_cycle_detected"
    : "dependency_unsatisfied";
  const reason: ExecutionResolutionReason = blocked ? dependencyReason : intrinsic.reason;

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
    // Never populated for a blocked step: absorption is all-or-nothing, and a
    // run that is not happening has absorbed nothing.
    absorbedPreparation: blocked ? [] : dependencies.absorbedPreparation,
    unmetRequirements: blocked ? [dependencyReason, ...intrinsic.unmet] : intrinsic.unmet,

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

/**
 * The specific thing a founder is missing, from the validation resolver's own
 * vocabulary.
 *
 * A single `validation_profile_unsupported` used to cover all of these, which
 * told a founder Vibe could not prove a change to their project and nothing
 * about why. Every one of these is fixable, and most in a minute — but only if
 * the screen says which one it is.
 */
function unmetFor(reason: ValidationBlockReason): ExecutionResolutionReason {
  switch (reason) {
    case "not_a_node_project":
      return "no_node_project";
    case "no_build_script":
      return "no_build_script";
    case "lockfile_missing":
      return "no_lockfile";
    case "package_manager_unsupported":
      return "package_manager_unsupported";
    case "workspace_choice_required":
      return "workspace_choice_required";
    case "repository_analysis_outdated":
      return "repository_analysis_outdated";
    default:
      // `ambiguous_workspace`, `prepared_change_not_ready`,
      // `repository_connection_invalid` and the residual
      // `validation_not_supported` — none of which a plan screen can name more
      // usefully than the general sentence does.
      return "validation_profile_unsupported";
  }
}
