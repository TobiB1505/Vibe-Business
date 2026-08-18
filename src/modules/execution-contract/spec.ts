import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type { ExecutionCapability } from "@/modules/execution/schema";
import type { ExecutionBudget, ExecutionCreditBinding } from "./budget";
import {
  AGENTIC_FRESHNESS_CHECKS,
  DETERMINISTIC_FRESHNESS_CHECKS,
  type FreshnessCheck,
} from "./freshness";
import { computeBusinessContextHash, computeExecutionSpecIdentity } from "./identity";
import { compileExecutionPolicy, type ExecutionPolicy, type ExecutionWriteScope } from "./policy";
import { assertNoSecretMaterial } from "./secrets";
import {
  EXECUTION_INTERRUPT_TYPES,
  EXECUTION_POLICY_VERSION,
  EXECUTION_RESOLVER_VERSION,
  EXECUTION_RISK_POLICY_VERSION,
  EXECUTION_SPEC_SCHEMA_VERSION,
  EXECUTION_STOP_REASONS,
  type ExecutionClass,
  type ExecutionInterruptType,
  type ExecutionMode,
  type ExecutionResolution,
  type ExecutionRiskClass,
  type ExecutionStopReason,
} from "./schema";
import type { ExecutionValidationRequirement } from "./validation-requirements";

/**
 * The ExecutionSpec (EXECUTION CORE-3 §9, §10, §11, §12).
 *
 * ## What it is
 *
 * The canonical, machine-readable instruction package a future Coding Agent
 * receives. Not a prompt — §12 separates the two deliberately:
 *
 * ```
 * ExecutionSpec  →  Prompt Compiler  →  provider-specific agent instruction
 * ```
 *
 * If the spec were the prompt, every business and safety rule in this module
 * would end up as sentences in one enormous string, where they would be
 * advisory, unversioned and impossible to test. Keeping them structured is what
 * makes `isToolAllowed`, `checkWriteScope` and `evaluateFreshness` mean
 * anything. Core-3 defines the boundary and stops there: no prompt compiler is
 * built, and no model is called.
 *
 * ## Immutability (§10)
 *
 * A spec is a value, not a record that gets updated. If the user changes a
 * decision, the repository HEAD moves, the plan is replanned or a policy is
 * bumped, the answer is a **new spec with a new identity** — see
 * `identity.ts`. The database enforces it too: `execution_specs` rejects every
 * UPDATE.
 *
 * ## No secrets (§11)
 *
 * There is no field here a credential could occupy. The spec may say
 * *authentication configuration is required*; it can never say what it is. That
 * is a property of the type, not of a scanner — `secrets.ts` explains why the
 * scanner exists anyway and why it is not the defence.
 */

/* ---------------------------------------------------------------------------
 * The document
 * ------------------------------------------------------------------------ */

/** One approved founder decision, as structured context (§28). */
export type ApprovedBusinessDecision = {
  /** Stable key — for a plan-step decision, the step's own key. */
  key: string;
  /** The plan step that recorded it, when it came from one. */
  stepOrder: number | null;
  /** What was decided, in the founder's own recorded terms. */
  decision: string;
};

export type ExecutionObjective = {
  /** The plan's business goal. */
  goal: string;
  stepTitle: string;
  /** What this step changes and why the plan needs it. */
  purpose: string;
  /** How we know it is done — the step's completion criteria (§9). */
  doneWhen: string;
  /**
   * What is true afterwards that is not true now.
   *
   * The plan's `expectedOutcome`, carried forward so an agent optimises for the
   * business change rather than for the literal instruction.
   */
  expectedChangedState: string;
};

export type ExecutionRepositoryBinding = {
  repositoryConnectionId: string;
  fullName: string;
  defaultBranch: string;
  /**
   * The exact commit the work is defined against (§16).
   *
   * There is no "latest main" anywhere in this contract. A change is a commit
   * on top of a specific parent, and a spec that did not pin one would be an
   * instruction about a tree nobody has seen.
   */
  baseSha: string;
  repositorySnapshotId: string;
  /** Deterministic framework/package-manager facts already established. */
  frameworks: readonly string[];
  packageManager: string;
};

/**
 * When a run must stop and ask, rather than deciding for the customer (§22).
 *
 * Stored on the spec as a list of *permitted* interrupt types so a future
 * runtime cannot invent a new reason to interrupt, and so "why did Vibe stop?"
 * is always answerable from a closed vocabulary the product has copy for.
 */
export type ExecutionInterruptRules = {
  mustAskWhen: readonly ExecutionInterruptType[];
  /**
   * Whether trivial implementation choices may be inferred from the repository.
   *
   * True, always, in V1. §22 asks for useful autonomy rather than constant
   * clarification: an agent that can see the project's existing conventions
   * must follow them instead of asking which quote style to use.
   */
  mayInferFromExistingPatterns: true;
};

export type ExecutionSpec = {
  schemaVersion: typeof EXECUTION_SPEC_SCHEMA_VERSION;

  /* Identity (§9) */
  identity: string;
  projectId: string;
  actionPlanId: string;
  stepKey: string;
  stepOrder: number;
  /** The Move and audit the plan traces to, so lineage survives into execution. */
  opportunityId: string;
  businessAuditId: string;
  /** The durable operation carrying this work, when one exists. Null in Core-3. */
  operationRunId: string | null;

  /* What (§9) */
  objective: ExecutionObjective;
  businessContext: {
    approvedDecisions: readonly ApprovedBusinessDecision[];
    /** Hashed into the identity, so a changed decision produces a new spec. */
    businessContextHash: string;
    /** What the plan is proceeding on. */
    assumptions: readonly string[];
    /** Prerequisite step orders, carried so an agent knows what already happened. */
    dependsOnSteps: readonly number[];
  };

  /* Where (§16) */
  repository: ExecutionRepositoryBinding;

  /* How much authority (§5, §13, §19) */
  mode: ExecutionMode;
  executionClass: ExecutionClass | null;
  riskClass: ExecutionRiskClass;
  capability: ExecutionCapability | null;
  capabilityVersion: string | null;
  policy: ExecutionPolicy;

  /* What must pass (§30, §31) */
  validation: ExecutionValidationRequirement;

  /* How much it may cost (§24, §25) */
  budget: ExecutionBudget | null;
  credit: ExecutionCreditBinding;

  /* When to stop (§21, §22, §23) */
  interruptRules: ExecutionInterruptRules;
  stopConditions: readonly ExecutionStopReason[];

  /* What must be re-checked immediately before a write (§29) */
  freshnessChecks: readonly FreshnessCheck[];

  /* Versions (§36) */
  resolverVersion: typeof EXECUTION_RESOLVER_VERSION;
  policyVersion: typeof EXECUTION_POLICY_VERSION;
  riskPolicyVersion: typeof EXECUTION_RISK_POLICY_VERSION;

  createdAt: string;
};

/* ---------------------------------------------------------------------------
 * Building
 * ------------------------------------------------------------------------ */

export type BuildExecutionSpecInput = {
  resolution: ExecutionResolution;
  step: ActionPlanStep;
  plan: {
    id: string;
    goal: string;
    expectedOutcome: string;
    assumptions: readonly string[];
    opportunityId: string;
    businessAuditId: string;
  };
  projectId: string;
  repository: ExecutionRepositoryBinding;
  approvedDecisions: readonly ApprovedBusinessDecision[];
  validation: ExecutionValidationRequirement;
  budget: ExecutionBudget | null;
  credit: ExecutionCreditBinding;
  /** Fixture-supplied in tests; Core-4 derives it from the approved budget policy. */
  writeScope: ExecutionWriteScope;
  operationRunId?: string | null;
  createdAt: string;
};

export class ExecutionSpecNotBuildable extends Error {
  constructor(readonly mode: ExecutionMode) {
    super(
      `An ExecutionSpec describes work Vibe can carry out; mode "${mode}" is not that. ` +
        "Re-resolve the step rather than building a spec for it.",
    );
    this.name = "ExecutionSpecNotBuildable";
  }
}

/**
 * Builds the immutable instruction package for one resolved step.
 *
 * ## Why it refuses non-executable modes
 *
 * A spec for a `blocked` or `needs_user_input` step would be an instruction
 * package for work nobody may start — an object whose only possible use is to
 * be mistaken for permission. §44 and §45 require that a missing decision or an
 * unfinished prerequisite produces *no spec ready to run*, and the cleanest way
 * to guarantee that is for the constructor to refuse.
 *
 * ## Why the secret guard runs on the objective only
 *
 * Those four fields plus the decision labels are the entire free-text surface
 * of a spec. Everything else is an enum, an identifier, a count or a hash — see
 * `secrets.ts` for why the schema, not the guard, is the actual defence.
 */
export function buildExecutionSpec(input: BuildExecutionSpecInput): ExecutionSpec {
  const { resolution, step, plan } = input;

  if (resolution.mode !== "agentic" && resolution.mode !== "deterministic") {
    throw new ExecutionSpecNotBuildable(resolution.mode);
  }

  const objective: ExecutionObjective = {
    goal: plan.goal,
    stepTitle: step.title,
    purpose: step.purpose,
    doneWhen: step.completionCriteria,
    expectedChangedState: plan.expectedOutcome,
  };

  assertNoSecretMaterial("objective.goal", objective.goal);
  assertNoSecretMaterial("objective.stepTitle", objective.stepTitle);
  assertNoSecretMaterial("objective.purpose", objective.purpose);
  assertNoSecretMaterial("objective.doneWhen", objective.doneWhen);
  assertNoSecretMaterial("objective.expectedChangedState", objective.expectedChangedState);
  for (const decision of input.approvedDecisions) {
    assertNoSecretMaterial(`businessContext.approvedDecisions[${decision.key}]`, decision.decision);
  }

  const businessContextHash = computeBusinessContextHash(
    input.approvedDecisions.map((decision) => ({ key: decision.key, value: decision.decision })),
  );

  const policy = compileExecutionPolicy({
    mode: resolution.mode,
    executionClass: resolution.executionClass,
    riskClass: resolution.riskClass,
    writeScope: input.writeScope,
  });

  const identity = computeExecutionSpecIdentity({
    projectId: input.projectId,
    actionPlanId: plan.id,
    stepKey: step.id,
    baseSha: input.repository.baseSha,
    repositorySnapshotId: input.repository.repositorySnapshotId,
    mode: resolution.mode,
    executionClass: resolution.executionClass,
    riskClass: resolution.riskClass,
    capability: resolution.capability,
    capabilityVersion: resolution.capabilityVersion,
    businessContextHash,
    specSchemaVersion: EXECUTION_SPEC_SCHEMA_VERSION,
    resolverVersion: EXECUTION_RESOLVER_VERSION,
    policyVersion: EXECUTION_POLICY_VERSION,
    riskPolicyVersion: EXECUTION_RISK_POLICY_VERSION,
  });

  return {
    schemaVersion: EXECUTION_SPEC_SCHEMA_VERSION,

    identity,
    projectId: input.projectId,
    actionPlanId: plan.id,
    stepKey: step.id,
    stepOrder: step.order,
    opportunityId: plan.opportunityId,
    businessAuditId: plan.businessAuditId,
    operationRunId: input.operationRunId ?? null,

    objective,
    businessContext: {
      approvedDecisions: input.approvedDecisions,
      businessContextHash,
      assumptions: plan.assumptions,
      dependsOnSteps: step.dependsOn,
    },

    repository: input.repository,

    mode: resolution.mode,
    executionClass: resolution.executionClass,
    riskClass: resolution.riskClass,
    capability: resolution.capability,
    capabilityVersion: resolution.capabilityVersion,
    policy,

    validation: input.validation,

    budget: input.budget,
    credit: input.credit,

    interruptRules: {
      // Every situation in the closed vocabulary is a legitimate reason to
      // stop. The list is on the spec rather than implied so a future runtime
      // cannot add a reason, and so an audit can see what was permitted.
      mustAskWhen: EXECUTION_INTERRUPT_TYPES,
      mayInferFromExistingPatterns: true,
    },
    stopConditions: EXECUTION_STOP_REASONS,

    freshnessChecks:
      resolution.mode === "deterministic"
        ? DETERMINISTIC_FRESHNESS_CHECKS
        : AGENTIC_FRESHNESS_CHECKS,

    resolverVersion: EXECUTION_RESOLVER_VERSION,
    policyVersion: EXECUTION_POLICY_VERSION,
    riskPolicyVersion: EXECUTION_RISK_POLICY_VERSION,

    createdAt: input.createdAt,
  };
}
