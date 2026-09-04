import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type { ExecutionCapability } from "@/modules/execution/schema";
import type { ExecutionBudget, ExecutionCreditBinding } from "./budget";
import { computeBusinessContextHash, computeExecutionSpecIdentity } from "./identity";
import { resolveChainPricingClass } from "./pricing-class";
import { classifyExecutionRisk } from "./risk";
import { BUILD_CHAIN_POLICY_VERSION } from "./chain";
import type {
  ExecutionPricingClass,
  ExecutionPricingClassReason,
} from "@/modules/economy/execution-class";
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
 * makes `isToolAllowed` and `checkWriteScope` mean
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
  /** Stable semantic key — `decision:<subject>` or `input:<subject>`. */
  key: string;
  /** The plan step that recorded it, when it came from one. */
  stepOrder: number | null;
  /** What was decided, in the founder's own recorded terms. */
  decision: string;
};

/**
 * One preparatory step this execution performs itself (Core-4 semantics fix
 * §12, §13, §14).
 *
 * ## What it is
 *
 * A Planner step classified as Vibe's own technical preparation, folded into
 * the boundary of a downstream agentic execution instead of standing in front
 * of it. The primary step is still the delivery target; this is context that
 * tells the agent what to establish before it writes anything.
 *
 * ## What it is emphatically not
 *
 * **Authority.** Absorbed preparation grants no tool, no budget, no wider file
 * scope, no side effect, no higher risk ceiling and no secret. The policy is
 * compiled from the mode, execution class, risk class and write scope, and
 * nothing here is an input to any of them — a preparation step that says
 * *"deploy the result"* is a quoted sentence in a fenced user message, and the
 * gateway has no deploy tool to give it.
 *
 * **Completion.** The Planner's step is not marked done, not rewritten, and not
 * removed. This records how the execution boundary was compiled; the plan
 * remains exactly as stored (§34).
 */
export type AbsorbedPreparation = {
  stepOrder: number;
  stepKey: string;
  /** The preparation's own title, in the plan's recorded words. */
  title: string;
  /** Why the plan wanted it. */
  purpose: string;
  /** What the plan says finishing it looks like. */
  doneWhen: string;
};

/**
 * A further step this same run delivers (`build-chain-v1`).
 *
 * Structurally identical to {@link AbsorbedPreparation} and **deliberately a
 * separate type**, because the two mean opposite things.
 *
 * Preparation is work the run performs *on the way to* its objective, and the
 * Planner's step for it is never marked done — ADR 0026 promises exactly that.
 * A chained delivery is the objective, again: the run is expected to deliver
 * it, and one validated execution completes it. Sharing one type would make
 * that distinction a comment, and the first person to reuse the wrong one would
 * break ADR 0026's guarantee inside the type that carries it.
 *
 * Like preparation, it grants nothing. The compiled policy is a function of
 * mode, execution class, risk class and write scope; a chain adds deliveries,
 * never permissions. And like preparation, it reaches the agent as fenced,
 * untrusted-labelled prose in a user message, never as an instruction.
 */
export type ChainedDelivery = {
  stepOrder: number;
  stepKey: string;
  /** The step's own title, in the plan's recorded words. */
  title: string;
  /** Why the plan wanted it. */
  purpose: string;
  /** What the plan says finishing it looks like. */
  doneWhen: string;
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
  /**
   * Preparation this run performs before the change, in plan order (§12).
   *
   * Empty for every execution whose prerequisites were already satisfied, and
   * for every non-agentic route. On the objective rather than in
   * `businessContext` because it is part of *what the agent is asked to do* —
   * business context is what the work rests on, and this is work.
   */
  preparation: readonly AbsorbedPreparation[];
  /**
   * Further steps this one run delivers, in plan order (`build-chain-v1`).
   *
   * **Excludes the head**, which is the objective above — this is the rest of
   * the chain and nothing else, so a reader never has to work out whether the
   * step they are looking at appears twice. Empty for every run that delivers
   * one step, which is every run stored before build chains existed, and the
   * accessor {@link chainedDeliveriesOf} returns `[]` for a spec that predates
   * the field entirely.
   */
  chain?: readonly ChainedDelivery[];
};

/**
 * The chained deliveries of a spec, or none.
 *
 * One accessor rather than `spec.objective.chain ?? []` at each call site, so a
 * document stored before this field existed cannot reach a reader as
 * `undefined`. That absence is what lets `EXECUTION_SPEC_SCHEMA_VERSION` stay
 * at v1: a v1 document read by chain-aware code yields no chain, which is
 * exactly what that run was — there is nothing to reinterpret.
 */
export function chainedDeliveriesOf(spec: {
  objective: Pick<ExecutionObjective, "chain">;
}): readonly ChainedDelivery[] {
  return spec.objective.chain ?? [];
}

/**
 * Every step key this run delivers, head first — or nothing.
 *
 * Two things this deliberately is not. It is not the objective's `chain`, which
 * excludes the head; and it is **empty rather than `[stepKey]`** for a run that
 * delivers one step, because that is what the identity hashes, what the column
 * stores, and what every row written before build chains means. A single-member
 * list would say nothing `stepKey` has not already said, in two more places.
 */
export function chainedStepKeysOf(spec: {
  stepKey: string;
  objective: Pick<ExecutionObjective, "chain">;
}): readonly string[] {
  const members = chainedDeliveriesOf(spec);
  return members.length === 0 ? [] : [spec.stepKey, ...members.map((member) => member.stepKey)];
}

/** The orders matching {@link chainedStepKeysOf}, in the same order. */
export function chainedStepOrdersOf(spec: {
  stepOrder: number;
  objective: Pick<ExecutionObjective, "chain">;
}): readonly number[] {
  const members = chainedDeliveriesOf(spec);
  return members.length === 0 ? [] : [spec.stepOrder, ...members.map((member) => member.stepOrder)];
}

/**
 * Every step this run absorbs as preparation, in plan order — or nothing.
 *
 * The mirror of {@link chainedStepKeysOf} and deliberately not the same thing.
 * A chain member is **delivered** by the run; an absorbed step is work the run
 * performs on its way to delivering something else, and the two sets are
 * disjoint by construction — `resolveBuildChain` carries `product_change`
 * steps, `classifyExecutionDependency` absorbs `analysis` ones.
 *
 * Unlike the chain, the head is never a member: a step does not absorb itself.
 * That is why this returns the preparation as it stands rather than prepending
 * `stepKey`, and why the column carrying it has the opposite CHECK.
 *
 * Read from the objective for the same reason the chain is: the document is
 * what was built and validated, so a column derived from it cannot disagree
 * with the spec it sits beside (§54).
 */
export function absorbedStepKeysOf(spec: {
  objective: Pick<ExecutionObjective, "preparation">;
}): readonly string[] {
  return spec.objective.preparation.map((preparation) => preparation.stepKey);
}

/** The orders matching {@link absorbedStepKeysOf}, in the same order. */
export function absorbedStepOrdersOf(spec: {
  objective: Pick<ExecutionObjective, "preparation">;
}): readonly number[] {
  return spec.objective.preparation.map((preparation) => preparation.stepOrder);
}

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
  /**
   * The directory the application lives in. `"."` for a single-app repository.
   *
   * Optional because a spec is a document: rows written before a repository
   * could hold its application anywhere do not carry it, and reading absent as
   * the root is what those runs did. New specs always set it.
   *
   * Read from here rather than re-resolved at execution time, for the same
   * reason every other premise on this document is: a founder naming a
   * different application must not move a running run's working directory
   * (rule 67).
   */
  workspaceRoot?: string;
  /**
   * The directory the install runs in. `workspaceRoot` unless a workspace root
   * above it (Stufe 8).
   *
   * Optional for the same reason and read the same way: absent means the run
   * installed where it built, which is what every run before workspaces did.
   */
  installRoot?: string;
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
  /**
   * What this step is priced at, and why (`launch-v1`).
   *
   * Null for anything that is not mutating agent work, which is what
   * `classifyExecutionPricingClass` returns for a non-mutating step — such a
   * step never reaches agentic execution, so it has no class rather than a
   * cheap one.
   *
   * Carried on the document, not recomputed at start time, because the price a
   * customer was shown and the budget a run is bounded by must be the same
   * decision. Re-deriving it later would let a change to the evidence
   * vocabulary silently re-tier work somebody already authorized.
   *
   * Deliberately **not** in the spec identity. It is a function of `stepKey`
   * and `riskClass`, both of which already are — so a step whose class could
   * change has a different identity anyway, and hashing a derived field would
   * only add a second way to invalidate the same spec. This is the same
   * reasoning `identity.ts` gives for excluding the budget and the reservation.
   */
  pricingClass: ExecutionPricingClass | null;
  pricingClassReason: ExecutionPricingClassReason;
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
  /**
   * The plan steps named by `resolution.absorbedPreparation` (§12, §13).
   *
   * Passed in rather than looked up, because a spec builder that reached into a
   * plan could disagree with the resolver about which steps were absorbed. It
   * is checked instead: exactly these orders, no more and no fewer, or the
   * build refuses.
   */
  preparationSteps?: readonly ActionPlanStep[];
  /**
   * The chain this run carries, head first, from `resolveBuildChain`.
   *
   * Passed in whole rather than as the successors alone, because the resolver's
   * answer is "these members" and splitting it here would create a second place
   * that decides which one is the head. Absent or one member means a run that
   * delivers one step — the shape of every spec built before build chains.
   *
   * Refused unless its head *is* this step: a chain whose head is somewhere else
   * describes a run nothing resolved.
   */
  chainSteps?: readonly ActionPlanStep[];
  operationRunId?: string | null;
  createdAt: string;
};

/**
 * The caller's preparation steps did not match what the resolver absorbed.
 *
 * A loud failure rather than a reconciliation. The two halves disagreeing means
 * the spec would describe an execution boundary nothing resolved, and quietly
 * preferring either side would hide which one was wrong.
 */
export class ExecutionSpecPreparationMismatch extends Error {
  constructor(
    readonly expected: readonly number[],
    readonly received: readonly number[],
  ) {
    super(
      `The resolver absorbed preparation steps [${expected.join(", ")}], ` +
        `but [${received.join(", ")}] were supplied. Re-resolve the step rather than reconciling these.`,
    );
    this.name = "ExecutionSpecPreparationMismatch";
  }
}

/**
 * The chain handed to the builder is not a chain of this step.
 *
 * Loud, for the same reason {@link ExecutionSpecPreparationMismatch} is loud: a
 * spec whose head is not the step being built would price, identify and
 * complete work nobody resolved, and picking a side quietly would hide which
 * half was wrong.
 */
export class ExecutionSpecChainMismatch extends Error {
  constructor(
    readonly stepKey: string,
    readonly received: readonly string[],
  ) {
    super(
      `A build chain must begin at the step being built ("${stepKey}"), ` +
        `but [${received.join(", ")}] were supplied. Re-resolve the step rather than reconciling these.`,
    );
    this.name = "ExecutionSpecChainMismatch";
  }
}

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

  const preparationSteps = [...(input.preparationSteps ?? [])].sort((a, b) => a.order - b.order);
  const absorbed = [...resolution.absorbedPreparation].sort((a, b) => a - b);
  const supplied = preparationSteps.map((preparation) => preparation.order);
  if (
    absorbed.length !== supplied.length ||
    absorbed.some((order, index) => order !== supplied[index])
  ) {
    throw new ExecutionSpecPreparationMismatch(absorbed, supplied);
  }

  /*
   * The chain, validated before anything reads it.
   *
   * Head-first and beginning at this step, or the build refuses. That property
   * is also a CHECK constraint on `execution_specs`, so the same sentence is
   * true in the application and in the database.
   */
  const chainSteps = [...(input.chainSteps ?? [step])];
  if (chainSteps[0]?.id !== step.id) {
    throw new ExecutionSpecChainMismatch(
      step.id,
      chainSteps.map((member) => member.id),
    );
  }

  const objective: ExecutionObjective = {
    goal: plan.goal,
    stepTitle: step.title,
    purpose: step.purpose,
    doneWhen: step.completionCriteria,
    expectedChangedState: plan.expectedOutcome,
    preparation: preparationSteps.map((preparation) => ({
      stepOrder: preparation.order,
      stepKey: preparation.id,
      title: preparation.title,
      purpose: preparation.purpose,
      doneWhen: preparation.completionCriteria,
    })),
    // The head is the objective above, so only the rest of the chain is carried
    // here — and a run of one omits the field entirely, keeping a solo spec
    // byte-identical to what it was before chains existed.
    ...(chainSteps.length > 1
      ? {
          chain: chainSteps.slice(1).map((member) => ({
            stepOrder: member.order,
            stepKey: member.id,
            title: member.title,
            purpose: member.purpose,
            doneWhen: member.completionCriteria,
          })),
        }
      : {}),
  };

  assertNoSecretMaterial("objective.goal", objective.goal);
  assertNoSecretMaterial("objective.stepTitle", objective.stepTitle);
  assertNoSecretMaterial("objective.purpose", objective.purpose);
  assertNoSecretMaterial("objective.doneWhen", objective.doneWhen);
  assertNoSecretMaterial("objective.expectedChangedState", objective.expectedChangedState);
  // Preparation is Planner prose like the rest of the objective, and reaches the
  // agent's user message the same way. It gets the same guard.
  for (const preparation of objective.preparation) {
    assertNoSecretMaterial(
      `objective.preparation[${preparation.stepKey}].title`,
      preparation.title,
    );
    assertNoSecretMaterial(
      `objective.preparation[${preparation.stepKey}].purpose`,
      preparation.purpose,
    );
    assertNoSecretMaterial(
      `objective.preparation[${preparation.stepKey}].doneWhen`,
      preparation.doneWhen,
    );
  }
  // A chained delivery is Planner prose reaching the agent's user message, like
  // preparation and like the objective. Same guard, no exception.
  for (const member of chainedDeliveriesOf({ objective })) {
    assertNoSecretMaterial(`objective.chain[${member.stepKey}].title`, member.title);
    assertNoSecretMaterial(`objective.chain[${member.stepKey}].purpose`, member.purpose);
    assertNoSecretMaterial(`objective.chain[${member.stepKey}].doneWhen`, member.doneWhen);
  }
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
    // Two runs that deliver the same step but carry different preparation are
    // different execution boundaries, so they are different specs (§13).
    absorbedPreparationKeys: objective.preparation.map((preparation) => preparation.stepKey),
    // Every step this run delivers, head included. Two runs delivering the same
    // head but different chains are different instructions, and rule 67 needs
    // them to be different artifacts — see `identity.ts` for what goes wrong
    // otherwise.
    chainStepKeys: chainSteps.map((member) => member.id),
    chainPolicyVersion: BUILD_CHAIN_POLICY_VERSION,
    specSchemaVersion: EXECUTION_SPEC_SCHEMA_VERSION,
    resolverVersion: EXECUTION_RESOLVER_VERSION,
    policyVersion: EXECUTION_POLICY_VERSION,
    riskPolicyVersion: EXECUTION_RISK_POLICY_VERSION,
  });

  /*
   * Priced over the whole chain, once, here.
   *
   * The head's own risk class comes from the resolver, which already decided
   * it; a member's is classified the same way the resolver would, from its own
   * structured fields. `resolveChainPricingClass` takes the maximum.
   */
  const pricing = resolveChainPricingClass({
    members: chainSteps,
    riskClasses: chainSteps.map((member, index) =>
      index === 0 ? resolution.riskClass : classifyExecutionRisk(member),
    ),
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
    pricingClass: pricing.pricingClass,
    pricingClassReason: pricing.reason,
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

    resolverVersion: EXECUTION_RESOLVER_VERSION,
    policyVersion: EXECUTION_POLICY_VERSION,
    riskPolicyVersion: EXECUTION_RISK_POLICY_VERSION,

    createdAt: input.createdAt,
  };
}
