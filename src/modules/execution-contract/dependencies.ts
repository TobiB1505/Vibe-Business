import type { CapabilityMatchContext } from "@/modules/action-plans/capability-registry";
import { matchCapability } from "@/modules/action-plans/capability-registry";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import { findDependencyCycles } from "@/modules/action-plans/sequence";
import { classifyExecutionRisk } from "./risk";

/**
 * Execution dependency semantics (EXECUTION CORE-4 SEMANTICS FIX §1, §6, §7).
 *
 * ## The defect this file exists to fix
 *
 * A real dogfood found the resolver refusing work it could safely do. The
 * persisted SEO plan for Vibe Business looks like this:
 *
 * ```
 * 1  Define the metadata plan …            vibe · analysis        depends on —
 * 2  Add canonical URLs …                  vibe · product_change  depends on 1
 * 3  Add Open Graph tags and structured …  vibe · product_change  depends on 1
 * 4  Add robots meta directives …          vibe · product_change  depends on 1
 * ```
 *
 * Step 1 resolved `unsupported` — correctly, because no *executor* produces a
 * written metadata plan on a click. Steps 2–4 then resolved `blocked`, because
 * a prerequisite was unfinished. Every individual answer was right and the
 * outcome was wrong: three moderate-risk changes to a Next.js/pnpm repository
 * that Vibe can validate, refused because Vibe had not first done a piece of
 * *its own thinking* that the coding agent does anyway as its first act.
 *
 * ## The distinction
 *
 * > Not every Planner dependency is a hard execution blocker.
 *
 * ```
 * hard              something that must already EXIST before execution
 *                   a founder decision · manual work · an external prerequisite
 *                   · a real product change
 *
 * agent_preparable  work Vibe itself performs as part of the same bounded run
 *                   inspect the current implementation · determine the
 *                   repository-consistent pattern · prepare the approach
 *
 * satisfied         already finished; nothing to wait for and nothing to absorb
 * ```
 *
 * The Planner describes *what work is needed*. It does not define one runtime
 * execution boundary per step — that is the Execution layer's call, and this
 * file is where it is made.
 *
 * ## Deterministic, from structured fields only (§7)
 *
 * No AI call, and no reading of step titles. Classification looks at `actor`,
 * `changeKind`, the derived risk class and the current capability registry —
 * the same closed vocabulary `risk.ts` and `capability-registry.ts` are already
 * restricted to, and for the same reason: a rule keyed on prose would let a
 * reworded step reclassify itself, which is the most valuable thing a prompt
 * injection in a customer's repository could achieve.
 *
 * There is deliberately no `title.includes("analyze")` anywhere below.
 */

/* ---------------------------------------------------------------------------
 * Classification
 * ------------------------------------------------------------------------ */

export const EXECUTION_DEPENDENCY_CLASSES = [
  /** Finished. Not a dependency any more. */
  "satisfied",
  /**
   * Vibe's own technical preparation, absorbable into a downstream agent run.
   *
   * Never granted on a guess: the step must be Vibe's responsibility, must
   * produce no state outside Vibe, must carry no independent consequence, and
   * must have no deterministic executor of its own.
   */
  "agent_preparable",
  /**
   * Must already exist. Execution does not proceed.
   *
   * The default, and deliberately so. Anything this file cannot positively
   * prove is preparation is hard — a founder decision, real-world work, an
   * external prerequisite, a product change, or simply a shape nobody has
   * reasoned about yet.
   */
  "hard",
] as const;
export type ExecutionDependencyClass = (typeof EXECUTION_DEPENDENCY_CLASSES)[number];

/**
 * Change kinds that are Vibe's own preparation rather than a change to the world.
 *
 * `analysis` and nothing else, and the omissions are the interesting part.
 *
 * `measurement` is excluded even though `classify.ts` also maps it to
 * `vibe_prepares`. A measurement step is an *observation of a finished result*
 * — "verify the new signals render correctly on the live site". Folding that
 * into the run that produced the change would be the agent certifying its own
 * work, which Rule 78 and Core-4 §31 forbid outright: an agent's own checks are
 * advisory, and Vibe's independent validation is the verdict. Absorbing a
 * verification step would quietly make the run its own judge.
 *
 * `research` is excluded because it gathers information *from people or the
 * market* (see `STEP_CHANGE_KINDS`). Nothing in a repository answers it, so an
 * agent absorbing it would be inventing the answer.
 *
 * `decision` is excluded because a decision that reached this list at all would
 * be one the Planner assigned to Vibe, and "Vibe decided on the founder's
 * behalf without saying so" is exactly what §9 forbids.
 */
const PREPARATORY_CHANGE_KINDS: readonly ActionPlanStep["changeKind"][] = ["analysis"];

export type ClassifyDependencyInput = {
  step: ActionPlanStep;
  completed: ReadonlySet<number>;
  capabilityContext: CapabilityMatchContext;
};

/**
 * What one dependency step means for execution right now.
 *
 * Default-deny by construction: `hard` is the fall-through, and every condition
 * below has to pass for a step to be reclassified as preparation.
 */
export function classifyExecutionDependency(
  input: ClassifyDependencyInput,
): ExecutionDependencyClass {
  const { step } = input;

  if (input.completed.has(step.order)) return "satisfied";

  // §9, §10: a founder decision, real-world work, and a third party are the
  // three things Vibe must never absorb and never guess. They stay hard
  // whatever else is true of them.
  if (step.actor !== "vibe") return "hard";

  if (!PREPARATORY_CHANGE_KINDS.includes(step.changeKind)) return "hard";

  /*
   * Belt and braces on top of the change-kind gate.
   *
   * `classifyExecutionRisk` returns `low` for every non-mutating change kind
   * today, so this cannot currently fire — which is precisely why it is here.
   * If a future change makes `analysis` escalate for some evidence shape, the
   * consequence should be that the step stops being absorbable, not that this
   * file silently keeps folding it into an agent run.
   */
  if (
    classifyExecutionRisk({ changeKind: step.changeKind, evidenceIds: step.evidenceIds }) !== "low"
  ) {
    return "hard";
  }

  /*
   * Deterministic stays preferred (§36, and Core-3 §7).
   *
   * If a registry capability matches the preparation, Vibe has a real executor
   * for it — so the honest answer is to run that executor, not to hand the work
   * to a model as background context. No registry entry serves `analysis`
   * today, so like the risk gate above this is a guard against a future one.
   */
  if (
    matchCapability(
      { changeKind: step.changeKind, evidenceIds: step.evidenceIds },
      input.capabilityContext,
    )
  ) {
    return "hard";
  }

  return "agent_preparable";
}

/* ---------------------------------------------------------------------------
 * Traversal
 * ------------------------------------------------------------------------ */

export type ExecutionDependencyResolution = {
  /**
   * Unfinished prerequisites that stop this step now, in plan order.
   *
   * The direct dependencies only — a hard step buried in a preparation chain
   * surfaces as the *preparable* dependency that leads to it, because that is
   * the edge the plan actually draws and the one a reader can act on.
   */
  hardBlockers: readonly number[];
  /**
   * Preparation this execution would carry out itself, in plan order.
   *
   * Includes transitive preparation: if A prepares, B prepares and depends on
   * A, and C depends on B, then C absorbs both (§19). Empty whenever anything
   * is hard — absorption is not a partial credit.
   */
  absorbedPreparation: readonly number[];
  /** Per direct dependency, for reporting. Plan order. */
  classifications: readonly { order: number; classification: ExecutionDependencyClass }[];
  /**
   * A prerequisite loop was found while walking the chain (§32).
   *
   * `repairDependencies` strips cycles when a plan is validated, so a stored
   * plan should never contain one. This is not a reason to trust that here: the
   * traversal refuses rather than looping, and the refusal is a hard block.
   */
  cycleDetected: boolean;
};

export type ResolveDependenciesInput = {
  step: ActionPlanStep;
  steps: readonly ActionPlanStep[];
  completed: ReadonlySet<number>;
  capabilityContext: CapabilityMatchContext;
  /**
   * Whether this step's own route can carry preparation at all.
   *
   * False collapses the whole thing to the pre-fix behaviour: every unfinished
   * prerequisite is hard. It is false for everything except an agentic route,
   * and that restriction is load-bearing rather than cautious —
   *
   * - a `needs_user_input`, `manual` or `unsupported` step is not something the
   *   Execution Engine runs, so there is no execution boundary to absorb
   *   preparation *into*;
   * - a `deterministic` step runs a code generator that reads structured
   *   repository facts and nothing else. Telling it a metadata plan exists
   *   would change nothing about what it emits, so recording that it "absorbed"
   *   the preparation would be a false claim about the run.
   *
   * Only an agent reads context and acts on it, so only an agentic route may
   * say it performed the preparation.
   */
  absorbable: boolean;
};

/**
 * How one step's prerequisites bear on executing it now (§15, §18, §19, §32).
 *
 * One hard dependency is enough to block, whatever else is absorbable (§30) —
 * and a preparable dependency whose own chain reaches something hard is itself
 * hard, because performing it would mean proceeding without the thing it needs.
 */
export function resolveExecutionDependencies(
  input: ResolveDependenciesInput,
): ExecutionDependencyResolution {
  const byOrder = new Map(input.steps.map((step) => [step.order, step]));
  const unfinished = [...input.step.dependsOn]
    .filter((order) => !input.completed.has(order))
    .sort((a, b) => a - b);

  const classifications = [...input.step.dependsOn]
    .sort((a, b) => a - b)
    .map((order) => {
      const dependency = byOrder.get(order);
      return {
        order,
        // A dangling edge — a prerequisite that is not in the plan — is hard.
        // Validation repairs those, and a resolver that guessed at one would be
        // deciding that a step nobody can see does not matter.
        classification: dependency
          ? classifyExecutionDependency({
              step: dependency,
              completed: input.completed,
              capabilityContext: input.capabilityContext,
            })
          : ("hard" as ExecutionDependencyClass),
      };
    });

  if (!input.absorbable) {
    return {
      hardBlockers: unfinished,
      absorbedPreparation: [],
      classifications,
      cycleDetected: false,
    };
  }

  /*
   * Cycles are settled before anything is walked (§32).
   *
   * `findDependencyCycles` is the plan layer's own tested implementation, so
   * there is one answer to "do these prerequisites form a loop?" rather than a
   * second traversal here that could disagree with it. Restricted to what this
   * step can actually reach: a loop elsewhere in the plan is somebody else's
   * problem and must not refuse work that does not touch it.
   *
   * Settling it first is also what makes the chain walk below trivially
   * terminating — it runs only on an acyclic subgraph.
   */
  const cyclic = new Set(findDependencyCycles([...input.steps]));
  const reachable = dependencyClosure(input.step, byOrder);
  if ([...reachable].some((order) => cyclic.has(order))) {
    return {
      hardBlockers: unfinished,
      absorbedPreparation: [],
      classifications,
      cycleDetected: true,
    };
  }

  const hardBlockers: number[] = [];
  const absorbed = new Set<number>();

  for (const order of unfinished) {
    const chain = walkPreparationChain(order, {
      byOrder,
      completed: input.completed,
      capabilityContext: input.capabilityContext,
    });

    if (chain.absorbable) {
      for (const absorbedOrder of chain.orders) absorbed.add(absorbedOrder);
    } else {
      hardBlockers.push(order);
    }
  }

  // Absorption is all-or-nothing. A run that carried half its preparation while
  // something hard stood in front of it would be an execution proceeding on an
  // incomplete premise, which is the thing this whole file is careful about.
  if (hardBlockers.length > 0) {
    return {
      hardBlockers,
      absorbedPreparation: [],
      classifications,
      cycleDetected: false,
    };
  }

  return {
    hardBlockers: [],
    absorbedPreparation: [...absorbed].sort((a, b) => a - b),
    classifications,
    cycleDetected: false,
  };
}

/** Every step reachable through `dependsOn`, including the step itself. */
function dependencyClosure(
  step: ActionPlanStep,
  byOrder: Map<number, ActionPlanStep>,
): Set<number> {
  const seen = new Set<number>([step.order]);
  const queue = [...step.dependsOn];

  while (queue.length > 0) {
    const order = queue.shift()!;
    if (seen.has(order)) continue;
    seen.add(order);
    const next = byOrder.get(order);
    if (next) queue.push(...next.dependsOn);
  }

  return seen;
}

/**
 * Walks one prerequisite and everything behind it (§19).
 *
 * Iterative rather than recursive, matching `findDependencyCycles`: a plan's
 * dependency graph comes from a model, and blowing the stack on untrusted input
 * is not an acceptable failure mode. Cycles were ruled out by the caller, so the
 * visited set here is a de-duplicator rather than a termination guard.
 */
function walkPreparationChain(
  start: number,
  context: {
    byOrder: Map<number, ActionPlanStep>;
    completed: ReadonlySet<number>;
    capabilityContext: CapabilityMatchContext;
  },
): { absorbable: boolean; orders: number[] } {
  const collected = new Set<number>();
  const visited = new Set<number>();
  const queue: number[] = [start];

  while (queue.length > 0) {
    const order = queue.shift()!;
    if (visited.has(order)) continue;
    visited.add(order);

    // A finished prerequisite is not preparation to perform — it already
    // happened, and nothing behind it can be reached through it either.
    if (context.completed.has(order)) continue;

    const step = context.byOrder.get(order);
    if (!step) return { absorbable: false, orders: [] };

    const classification = classifyExecutionDependency({
      step,
      completed: context.completed,
      capabilityContext: context.capabilityContext,
    });

    // One hard link anywhere in the chain breaks the whole chain: performing
    // the preparation would mean proceeding without what it rests on (§30).
    if (classification !== "agent_preparable") return { absorbable: false, orders: [] };

    collected.add(order);
    for (const next of step.dependsOn) queue.push(next);
  }

  return { absorbable: true, orders: [...collected] };
}
