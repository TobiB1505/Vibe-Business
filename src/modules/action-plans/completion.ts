import type { FounderCompletionEvidence } from "@/modules/founder-input/completion";
import { completedStepsFromFounderResolutions } from "@/modules/founder-input/completion";
import { isExecutableByVibe, type ActionPlanStep } from "./schema";

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

function completedByAgentExecution(
  step: ActionPlanStep,
  evidence: readonly AgentStepCompletionEvidence[],
): boolean {
  if (step.actor !== "vibe" || !isExecutableByVibe(step)) return false;

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
