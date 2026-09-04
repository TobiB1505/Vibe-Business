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

/** Immutable founder testimony bound to one exact attestable step. */
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

/**
 * Which steps a founder may close with their own confirmation (ADR 0088).
 *
 * Two disjoint sets, and the second one is what this function was widened for.
 *
 * A `founder_action` step is the original case, unchanged: real-world work
 * only a person can carry out, so only a person can say it happened.
 *
 * The second is a step whose actor is **Vibe** and which Vibe has no executor
 * for. `resolver.ts` refuses every `vibe` step that is not a `product_change`
 * — `research`, `decision`, `analysis`, `measurement`, `external_setup` — and
 * that refusal was total. No run could produce such a step, no founder
 * resolution covered it, and no attestation reached it, so it could not be
 * completed by anything at all; `firstActionableStep` returned it forever and
 * every step behind it in the plan was dead with it. That is not a refusal.
 * It is a plan that cannot be worked.
 *
 * Absorption is not the missing authority either, though it looks like it.
 * `dependencies.ts` folds an `analysis` prerequisite into a downstream agent
 * run, but `listAgentStepCompletionEvidence` reads the run's *chain*, never
 * its absorbed preparation — so an absorbed step is routed past, not finished,
 * and it deadlocks the plan screen exactly as the others do.
 *
 * `changeKind` is the discriminator rather than `executionSupport`, and that
 * is the load-bearing part. `not_yet_supported` is also what a `product_change`
 * step carries whenever the deterministic registry misses it — which is most
 * of them, and precisely the work the agent exists to do. Keying on the change
 * kind mirrors the resolver's own rule, so the set admitted here is exactly
 * the set with no executor: a founder can never confirm away a change Vibe
 * would have built.
 *
 * What an attestation still does not claim is that *Vibe* did the work. The
 * founder is saying the step's own immutable completion criterion is true,
 * which is the same sentence a `founder_action` attestation has always meant.
 */
export function isFounderAttestable(
  step: Pick<ActionPlanStep, "actor" | "changeKind" | "executionSupport">,
): boolean {
  if (step.actor === "founder_action") return step.executionSupport === "founder_acts";
  return step.actor === "vibe" && step.changeKind !== "product_change";
}

function completedByFounderAttestation(
  step: ActionPlanStep,
  evidence: readonly FounderActionCompletionEvidence[],
): boolean {
  if (!isFounderAttestable(step)) return false;

  return evidence.some(
    (item) => item.stepKey === step.id && item.stepOrder === step.order,
  );
}

/**
 * One completion projection over every authority integrated today.
 *
 * Founder-owned information is complete from an active resolution. Agent work
 * is complete only from the independently assembled execution evidence above.
 * A founder attestation closes the two kinds of step no execution can reach:
 * real-world work, and Vibe's own work that Vibe has no executor for. An
 * external dependency deliberately contributes nothing until its own
 * authority exists.
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
