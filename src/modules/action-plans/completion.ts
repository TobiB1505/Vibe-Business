import type { FounderCompletionEvidence } from "@/modules/founder-input/completion";
import { completedStepsFromFounderResolutions } from "@/modules/founder-input/completion";
import type { ActionPlanStep } from "./schema";

/**
 * The durable facts that prove one planner-owned agent step finished.
 *
 * Every id comes from a canonical record owned by another domain. This module
 * projects those facts into plan progress; it does not create a second
 * completion flag that could disagree with them.
 */
export type AgentStepCompletionEvidence = {
  executionSpecId: string;
  agentExecutionRunId: string;
  preparedChangeId: string;
  validationRunId: string;
  stepKey: string;
  stepOrder: number;
};

/** Immutable founder testimony bound to one exact founder_action step. */
export type FounderActionCompletionEvidence = {
  attestationId: string;
  attestedByUserId: string;
  attestedAt: string;
  attestationVersion: string;
  stepKey: string;
  stepOrder: number;
};

/**
 * Whether one durable execution completed this step.
 *
 * ## Why the Planner's own fields are not consulted
 *
 * This used to require `isExecutableByVibe(step)` as well — `executionSupport
 * === "vibe_executes_now" && capability !== null`. That is the *deterministic*
 * shape, and it is false for every change the coding agent makes: the agentic
 * route is reached only when `matchCapability` returned null (`resolver.ts`),
 * so an agent-built step carries `capability: null` by construction. On the
 * founder's own plan, step 2 is stored `not_yet_supported` with no capability,
 * ran, verified and validated — and could not be completed by this function no
 * matter how much evidence existed.
 *
 * The deeper reason it was wrong is the one `resolver.ts` already states about
 * itself: `executionSupport` and `capability` were the Planner's answer when
 * the plan was written, and the product re-derives routing from current state
 * rather than reading them. Treating them as a *completion* authority is the
 * same mistake one layer over — a stale routing signal deciding whether
 * something that demonstrably happened counts.
 *
 * So the authority is what it always claimed to be: the four durable records
 * assembled by `listAgentStepCompletionEvidence`, bound to this exact key and
 * order, for work whose actor is Vibe. A step Vibe does not own is refused by
 * the actor check; a step Vibe never ran has no evidence to match.
 */
function completedByAgentExecution(
  step: ActionPlanStep,
  evidence: readonly AgentStepCompletionEvidence[],
): boolean {
  if (step.actor !== "vibe") return false;

  return evidence.some(
    (item) => item.stepKey === step.id && item.stepOrder === step.order,
  );
}

function completedByFounderAttestation(
  step: ActionPlanStep,
  evidence: readonly FounderActionCompletionEvidence[],
): boolean {
  if (step.actor !== "founder_action" || step.executionSupport !== "founder_acts") {
    return false;
  }

  return evidence.some(
    (item) => item.stepKey === step.id && item.stepOrder === step.order,
  );
}

/**
 * One completion projection over every authority integrated today.
 *
 * Founder-owned information is complete from an active resolution. Agent work
 * is complete only from the independently assembled execution evidence above.
 * Founder actions and external dependencies deliberately contribute nothing
 * until their own authority exists.
 */
export function completedStepsFromEvidence(
  steps: readonly ActionPlanStep[],
  founderResolutions: readonly FounderCompletionEvidence[],
  agentEvidence: readonly AgentStepCompletionEvidence[],
  founderActionEvidence: readonly FounderActionCompletionEvidence[] = [],
): ReadonlySet<number> {
  const completed = new Set(completedStepsFromFounderResolutions(steps, founderResolutions));

  for (const step of steps) {
    if (completedByAgentExecution(step, agentEvidence)) completed.add(step.order);
    if (completedByFounderAttestation(step, founderActionEvidence)) completed.add(step.order);
  }

  return completed;
}

/**
 * The same question asked by the execution router, which is not the same
 * question — and this file holds both so the difference is stated once.
 *
 * ## Two questions that look like one
 *
 * The plan screen asks **"is this step done?"** and [ADR 0054](../../../docs/decisions/0054-agent-action-plan-completion-evidence.md)
 * answers it from four durable records ending at a passed validation. That is
 * right, and the ADR is explicit that `completed` does not mean approved,
 * merged, deployed or live.
 *
 * The router asks **"may the next step start now?"**, and for an agent step
 * that needs one thing more. A run is prepared against `run.baseSha`, which is
 * the default branch. Starting the successor while its predecessor sits on an
 * unmerged branch would hand the agent a tree without the work it is supposed
 * to build on — the pricing page it must link to would not be there.
 *
 * So an agent step counts here only once its Prepared Change is **merged**:
 * the default branch points at the approved commit and Vibe read it back
 * (rule 74). Founder resolutions and founder attestations are unaffected —
 * neither produces a commit, so neither has a base to be missing from.
 *
 * ## Why this is not the stricter definition everywhere
 *
 * Because "you finished this" and "the next one can start" are different
 * sentences, and collapsing them would make the plan understate what a founder
 * has already achieved while their change waits for review.
 */
export function completedStepsForExecutionRouting(
  steps: readonly ActionPlanStep[],
  founderResolutions: readonly FounderCompletionEvidence[],
  agentEvidence: readonly AgentStepCompletionEvidence[],
  mergedPreparedChangeIds: ReadonlySet<string>,
  founderActionEvidence: readonly FounderActionCompletionEvidence[] = [],
): ReadonlySet<number> {
  const merged = agentEvidence.filter((item) =>
    mergedPreparedChangeIds.has(item.preparedChangeId),
  );

  return completedStepsFromEvidence(steps, founderResolutions, merged, founderActionEvidence);
}
