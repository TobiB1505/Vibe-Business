import type { ActionPlanStep, PlanProgress } from "./schema";

/**
 * Dependency reasoning over a plan (CORE-2b §21, §38, §39, §79).
 *
 * Pure functions over steps. No database, no model, no provider — the whole
 * point of this file is that "what can happen next?" is a deterministic
 * question with one answer, computed the same way by the plan view, the
 * onboarding first-move panel and the dogfood report.
 *
 * ## Why the first actionable step is not `steps[0]`
 *
 * §38 is blunt about this and it is worth restating in code: "first move" must
 * not mean "first array item". A plan whose first step is already done, or
 * whose second step is waiting on a decision nobody has made, has a different
 * genuine answer to "what could happen right now" — and a product that showed
 * the array's head would be telling a founder to do something they cannot do.
 *
 * A founder decision *is* allowed to be the first actionable step. The bar is
 * not "Vibe can do it"; the bar is "nothing unfinished stands in front of it".
 */

/** Steps whose type-specific authoritative completion evidence exists. */
export type CompletedSteps = ReadonlySet<number>;

const NO_COMPLETIONS: CompletedSteps = new Set<number>();

/**
 * Dependency cycles, as the orders involved (§79).
 *
 * Returns every step that participates in a cycle rather than one example,
 * because the repair drops the offending edges and needs to know all of them.
 * Iterative colouring rather than recursion: a model could in principle emit a
 * long chain, and blowing the stack on untrusted input is not an acceptable
 * failure mode.
 */
export function findDependencyCycles(steps: ActionPlanStep[]): number[] {
  const byOrder = new Map(steps.map((step) => [step.order, step]));
  const state = new Map<number, "visiting" | "done">();
  const inCycle = new Set<number>();

  for (const root of steps) {
    if (state.get(root.order) === "done") continue;

    // An explicit stack of (node, next dependency index) frames.
    const stack: { order: number; index: number }[] = [{ order: root.order, index: 0 }];
    const path: number[] = [];
    state.set(root.order, "visiting");
    path.push(root.order);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const step = byOrder.get(frame.order);
      const dependencies = step?.dependsOn ?? [];

      if (frame.index >= dependencies.length) {
        state.set(frame.order, "done");
        stack.pop();
        path.pop();
        continue;
      }

      const next = dependencies[frame.index];
      frame.index += 1;

      if (!byOrder.has(next)) continue;

      if (state.get(next) === "visiting") {
        // Everything from `next` to the top of the current path is a cycle.
        const start = path.indexOf(next);
        for (const order of path.slice(start)) inCycle.add(order);
        continue;
      }

      if (state.get(next) === "done") continue;

      state.set(next, "visiting");
      stack.push({ order: next, index: 0 });
      path.push(next);
    }
  }

  return [...inCycle].sort((a, b) => a - b);
}

/**
 * Removes dependency edges that cannot be honoured (§21, §79).
 *
 * Two kinds: an edge pointing at a step that no longer exists (validation
 * discards steps), and every edge belonging to a cycle. Repair rather than
 * rejection, because a plan with one bad edge is still a plan we paid for and
 * the business reasoning in it is usually sound — but the edges themselves are
 * discarded rather than guessed at, since "which of these three should really
 * come first" is not something the server can know.
 */
export type DependencyRepair = {
  steps: ActionPlanStep[];
  notes: string[];
  /** A prerequisite pointed at a step that is not in the plan. */
  removedDanglingEdge: boolean;
  /** Prerequisites formed a loop and were broken. */
  brokeCycle: boolean;
};

export function repairDependencies(steps: ActionPlanStep[]): DependencyRepair {
  const notes: string[] = [];
  let removedDanglingEdge = false;
  const existing = new Set(steps.map((step) => step.order));

  let cleaned = steps.map((step) => {
    const kept = step.dependsOn.filter((order) => order !== step.order && existing.has(order));
    if (kept.length !== step.dependsOn.length) {
      notes.push(`"${step.title}" referenced a prerequisite that is not in the plan; it was removed.`);
      removedDanglingEdge = true;
    }
    return kept.length === step.dependsOn.length ? step : { ...step, dependsOn: kept };
  });

  const cycle = new Set(findDependencyCycles(cleaned));
  if (cycle.size > 0) {
    notes.push(
      `The plan's prerequisites formed a loop across ${cycle.size} steps; those prerequisites were removed so the plan can be ordered.`,
    );
    cleaned = cleaned.map((step) =>
      cycle.has(step.order)
        ? { ...step, dependsOn: step.dependsOn.filter((order) => !cycle.has(order)) }
        : step,
    );
  }

  return { steps: cleaned, notes, removedDanglingEdge, brokeCycle: cycle.size > 0 };
}

/** True when every prerequisite of this step is finished. */
export function isUnblocked(step: ActionPlanStep, completed: CompletedSteps): boolean {
  return step.dependsOn.every((order) => completed.has(order));
}

/**
 * The step that could genuinely happen next, or null (§39).
 *
 * "Genuinely" is the whole content of this function: not done, and nothing
 * unfinished in front of it. A downstream step never wins over an open
 * prerequisite, whatever its position in the array (§78).
 */
export function firstActionableStep(
  steps: ActionPlanStep[],
  completed: CompletedSteps = NO_COMPLETIONS,
): ActionPlanStep | null {
  const ordered = [...steps].sort((a, b) => a.order - b.order);
  for (const step of ordered) {
    if (completed.has(step.order)) continue;
    if (isUnblocked(step, completed)) return step;
  }
  return null;
}

/**
 * Where the plan stands, derived rather than stored (§40).
 *
 * Derived because a stored answer could disagree with the steps that define it,
 * and the steps are the plan. Four states, each of which a screen can act on:
 * Vibe's move, the founder's move, waiting on the world, done.
 */
export function planProgress(
  steps: ActionPlanStep[],
  completed: CompletedSteps = NO_COMPLETIONS,
): PlanProgress {
  if (steps.length > 0 && steps.every((step) => completed.has(step.order))) return "finished";

  const next = firstActionableStep(steps, completed);
  if (!next) return "blocked";

  switch (next.executionSupport) {
    case "founder_decides":
    case "founder_provides_input":
    case "founder_acts":
      return "needs_founder";
    case "external_dependency":
      return "blocked";
    default:
      return "ready";
  }
}
