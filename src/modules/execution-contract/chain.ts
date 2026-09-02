import type { ActionPlanStep } from "@/modules/action-plans/schema";
import { matchCapability, type CapabilityMatchContext } from "@/modules/action-plans/capability-registry";
import { findDependencyCycles } from "@/modules/action-plans/sequence";
import { classifyExecutionRisk } from "./risk";
import { MAX_AGENTIC_V1_RISK, riskExceeds } from "./schema";

/**
 * The build chain one run may carry (Stage 3).
 *
 * ## What a chain is, and why it is not a dependency class
 *
 * A Move's build is not one step. Measured over every completed plan in this
 * product: six runs of contiguous `vibe`/`product_change` steps — four of
 * length two, two of length three, and **never one**. Not a single Move has
 * planned its build as a single step, because the Planner splits engineering
 * work for a founder's readability, not for an execution boundary.
 *
 * `dependencies.ts` already answers the mirror-image question — *may this
 * **prerequisite** be carried?* — and its answer must not be extended
 * backwards into this one. Three reasons, and the third is the one that would
 * actually break something:
 *
 * 1. **Direction.** `classifyExecutionDependency` walks backwards along
 *    `dependsOn` and its output feeds `blockedBy`. `resolver.ts` computes
 *    `blocked = blockedBy.length > 0`, so a *successor* arriving in that array
 *    would block the very run it was meant to extend.
 * 2. **Partiality.** Absorption is all-or-nothing on purpose: a run carrying
 *    half its preparation proceeds on an incomplete premise. That is right for
 *    prerequisites and wrong here — a chain of three that can only carry two is
 *    a perfectly good chain of two, and the third stays for the next run.
 * 3. **Completion.** `AbsorbedPreparation` is explicitly *not* completion; ADR
 *    0026 promises the Planner's own state is untouched. A chain member is the
 *    opposite: it must be marked complete or the chain buys nothing. One type
 *    for both would break that promise inside the type that carries it.
 *
 * ## What this reads
 *
 * Structure only: `actor`, `changeKind`, `dependsOn`, `evidenceIds` through the
 * risk classifier, and the capability registry. **No prose.** Rewording every
 * title, purpose and done-when in a plan changes nothing here, and a test
 * asserts exactly that — the same discipline `dependencies.ts` records for
 * itself, and the reason a model cannot talk its way into a longer chain.
 *
 * ## What a chain never does
 *
 * It widens no tool, no path, no risk class and no budget regime. Every member
 * had to resolve `agentic` on its own before it could join, so a chain contains
 * only work a single run was already allowed to do. What changes is how many
 * deliveries one prepared change, one approval and one fast-forward carry.
 */

/**
 * Bumped when the rules below change what "this run carries these steps" meant.
 *
 * Part of the execution spec identity for a chained run (rule 65): a stored
 * spec must never be reinterpreted under chain rules it was not resolved
 * under. It sits beside the resolver and risk-policy versions rather than
 * inside them, because those answer different questions.
 */
export const BUILD_CHAIN_POLICY_VERSION = "build-chain-v1" as const;

/**
 * The most steps one run may deliver.
 *
 * Measured rather than chosen. The longest chain any plan in this product has
 * ever contained is three. And `complex` — the tier a chain is always priced at
 * — allows twelve changed files, while dogfood run #7 took eight for a *single*
 * step. Four deliveries under a twelve-file ceiling is not a plausible
 * envelope; three is the boundary that ceiling actually draws.
 */
export const MAX_BUILD_CHAIN_MEMBERS = 3;

/**
 * Why the chain stopped where it did.
 *
 * A closed vocabulary, because every one of these reaches a founder as a
 * sentence explaining why a run contains what it contains. A chain that is
 * shorter than someone expected and says nothing about why reads as a defect.
 */
export const BUILD_CHAIN_BOUNDARY_REASONS = [
  /** The head is the last step in the plan. */
  "no_successor",
  /** The next step is a founder's, an outside party's, or not a product change. */
  "successor_not_agentic",
  /** A registry capability serves the next step — deterministic beats agentic. */
  "successor_capability_matched",
  /** The next step is `prohibited`, or above what an agentic run may touch. */
  "successor_risk_ceiling",
  /** The next step also waits on something this chain does not contain. */
  "dependency_outside_chain",
  /** {@link MAX_BUILD_CHAIN_MEMBERS} reached. */
  "chain_length_ceiling",
  /** The steps this chain would walk refer back to each other. */
  "cycle_detected",
] as const;

export type BuildChainBoundaryReason = (typeof BUILD_CHAIN_BOUNDARY_REASONS)[number];

export type BuildChainResolution = {
  /**
   * The head and every successor it carries, in plan order.
   *
   * Never empty — the head is always a member of its own chain, which is what
   * lets one array describe both "just this step" and "this step plus two".
   * The database says the same thing with a CHECK constraint.
   */
  members: readonly ActionPlanStep[];
  boundary: BuildChainBoundaryReason;
  policyVersion: typeof BUILD_CHAIN_POLICY_VERSION;
};

export type ResolveBuildChainInput = {
  /** The step a run would be started on. Assumed to have resolved `agentic`. */
  head: ActionPlanStep;
  /** Every step in the plan, in any order. */
  steps: readonly ActionPlanStep[];
  /**
   * Step orders a successor may already build on.
   *
   * The execution router's narrower answer — an agent step counts once its
   * change reached the default branch (`completedStepsForExecutionRouting`) —
   * because a chain member's prerequisites are satisfied either by the chain
   * itself or by work that is already there to build on.
   */
  completed: ReadonlySet<number>;
  capabilityContext: CapabilityMatchContext;
};

function resolution(
  members: readonly ActionPlanStep[],
  boundary: BuildChainBoundaryReason,
): BuildChainResolution {
  return { members, boundary, policyVersion: BUILD_CHAIN_POLICY_VERSION };
}

/**
 * Whether this successor may join, and if not, what to say about it.
 *
 * Order matters and is the order a founder would ask in: is this even Vibe's
 * work, then would Vibe refuse it, then does something better already exist,
 * then is it waiting on something else.
 */
function admit(
  step: ActionPlanStep,
  admitted: ReadonlySet<number>,
  input: ResolveBuildChainInput,
): BuildChainBoundaryReason | null {
  if (step.actor !== "vibe" || step.changeKind !== "product_change") {
    return "successor_not_agentic";
  }

  const risk = classifyExecutionRisk(step);
  if (risk === "prohibited" || riskExceeds(risk, MAX_AGENTIC_V1_RISK)) {
    return "successor_risk_ceiling";
  }

  // Deterministic before agentic (`resolver.ts` §7). A chain that swallowed a
  // generator step would put a model on work Vibe's own code does exactly.
  if (matchCapability(step, input.capabilityContext) !== null) {
    return "successor_capability_matched";
  }

  /*
   * Contiguous *and* dependent, in one test.
   *
   * A prerequisite is satisfied if it is already there to build on, or if this
   * same chain is about to deliver it. Anything else — a founder decision still
   * open, a step further down the plan, a prerequisite outside the chain —
   * stops the walk. This is what makes the first hard boundary terminate a
   * chain without a rule naming boundaries at all.
   */
  const unsatisfied = step.dependsOn.some(
    (order) => !input.completed.has(order) && !admitted.has(order),
  );
  if (unsatisfied) return "dependency_outside_chain";

  return null;
}

/**
 * The chain a run starting at `head` would carry.
 *
 * Deliberately **not** part of `resolveStepExecution`. `resolvePlanExecution`
 * maps steps independently, and two screens depend on that independence — the
 * plan screen renders one responsibility line per row and row N's answer must
 * not depend on row N-1's. A chain is a property of the *offer* a caller is
 * about to make, so it is resolved over the resolutions rather than inside one.
 */
export function resolveBuildChain(input: ResolveBuildChainInput): BuildChainResolution {
  const members: ActionPlanStep[] = [input.head];

  /*
   * Cycles first, through the plan layer's own implementation, so there is one
   * answer in the product to "do these refer back to each other?" rather than a
   * second traversal here that could disagree with `dependencies.ts`.
   */
  const cyclic = new Set(findDependencyCycles([...input.steps]));
  if (cyclic.has(input.head.order)) return resolution(members, "cycle_detected");

  const successors = [...input.steps]
    .filter((step) => step.order > input.head.order)
    .sort((left, right) => left.order - right.order);

  const admitted = new Set<number>([input.head.order]);

  for (const step of successors) {
    if (members.length >= MAX_BUILD_CHAIN_MEMBERS) {
      return resolution(members, "chain_length_ceiling");
    }
    if (cyclic.has(step.order)) return resolution(members, "cycle_detected");

    const refusal = admit(step, admitted, input);
    if (refusal) return resolution(members, refusal);

    members.push(step);
    admitted.add(step.order);
  }

  return resolution(members, "no_successor");
}

/** The step keys a chain delivers, in plan order. Feeds the spec identity. */
export function chainStepKeys(chain: BuildChainResolution): readonly string[] {
  return chain.members.map((step) => step.id);
}
