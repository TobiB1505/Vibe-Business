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
 * Durable proof that a step was **covered** by a run built for another step.
 *
 * Every id names the same records an `AgentStepCompletionEvidence` names, and
 * that is deliberate: absorption is only meaningful once the absorbing run
 * actually succeeded. What differs is the claim. This says *this step no longer
 * needs doing, because that run performed it inside its own boundary* — never
 * that the step was carried out as a piece of work in its own right.
 */
export type AbsorbedStepSatisfaction = {
  executionSpecId: string;
  agentExecutionRunId: string;
  preparedChangeId: string;
  validationRunId: string;
  /** The covered step. */
  stepKey: string;
  stepOrder: number;
  /** The step whose run covered it — the delivery the preparation was for. */
  absorbedByStepKey: string;
  absorbedByStepOrder: number;
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
 * Which steps no longer need doing — a wider set than "which steps are done".
 *
 * ## Two words the product must not merge
 *
 * A step absorbed into a successful run is **satisfied**: nothing remains for
 * anyone to do, because the run performed that work on its way to its own
 * delivery. It is not **completed**: it was never carried out as a piece of
 * work in its own right, and a product that recorded it as completed would
 * throw away the answer to a question a founder can reasonably ask later —
 * *was this analysis done on its own, or covered by something larger?*
 *
 * So `completedStepsFromEvidence` stays exactly as it was and remains the audit
 * trail. This is the sequencing answer, and only sequencing reads it.
 *
 * ## When absorption starts counting
 *
 * Only once the absorbing run has succeeded, verified and validated — which is
 * precisely the evidence `listStepExecutionEvidence` requires before it emits
 * an `AbsorbedStepSatisfaction` at all. A planned run satisfies nothing, a
 * running one satisfies nothing, and a failed one satisfies nothing. There is
 * no state in between, because the evidence does not exist until the verdict
 * does.
 *
 * ## What it deliberately does not do
 *
 * Verify that the absorption was *legitimate*. The spec's `absorbed_step_keys`
 * were written from the validated document by the same insert that wrote the
 * chain, and the database refuses a row whose absorbed set contains its own
 * head or overlaps its own chain. Re-deriving absorbability here would ask
 * today's dependency classifier about a decision made when the run was built —
 * the same mistake `completedByAgentExecution` documents one function up.
 */
export function satisfiedStepsFromEvidence(
  completed: ReadonlySet<number>,
  absorbed: readonly AbsorbedStepSatisfaction[],
): ReadonlySet<number> {
  const satisfied = new Set(completed);

  for (const item of absorbed) {
    // The head must itself be finished. Absorption is a claim about what one
    // run did, and a run whose own delivery is not complete has not finished
    // establishing anything on the way to it.
    if (!completed.has(item.absorbedByStepOrder)) continue;
    satisfied.add(item.stepOrder);
  }

  return satisfied;
}

/** What covered each satisfied-but-not-completed step, for a screen to name. */
export function absorptionByStepOrder(
  completed: ReadonlySet<number>,
  absorbed: readonly AbsorbedStepSatisfaction[],
): ReadonlyMap<number, number> {
  const covered = new Map<number, number>();

  for (const item of absorbed) {
    if (completed.has(item.stepOrder)) continue;
    if (!completed.has(item.absorbedByStepOrder)) continue;
    covered.set(item.stepOrder, item.absorbedByStepOrder);
  }

  return covered;
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
  absorbed: readonly AbsorbedStepSatisfaction[] = [],
): ReadonlySet<number> {
  const merged = agentEvidence.filter((item) =>
    mergedPreparedChangeIds.has(item.preparedChangeId),
  );
  const completed = completedStepsFromEvidence(
    steps,
    founderResolutions,
    merged,
    founderActionEvidence,
  );

  /*
   * Absorption counts here too, and leaving it out would cost real money.
   *
   * `classifyExecutionDependency` folds an unfinished `analysis` prerequisite
   * into the next agentic run. If a merged run already absorbed that step and
   * this set did not say so, the classifier would absorb it *again* — the agent
   * re-establishing, inside a second paid run, exactly what the first one
   * established. Saying it is satisfied makes the classifier return `satisfied`
   * instead, which is the true answer.
   *
   * Merged rather than merely validated, for the same reason the delivered
   * steps are: a successor is prepared against the default branch, so work that
   * has not reached it is not there to build on.
   */
  return satisfiedStepsFromEvidence(
    completed,
    absorbed.filter((item) => mergedPreparedChangeIds.has(item.preparedChangeId)),
  );
}
