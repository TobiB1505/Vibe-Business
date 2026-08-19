import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecutionSpec } from "@/modules/execution-contract/spec";
import { getSnapshotById } from "@/modules/repository-intelligence/store";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { getActionPlanById } from "@/modules/action-plans/store";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import { benchmarkStep, fixtureForStepKey } from "@/modules/coding-agent/dogfood/fixtures";
import { compileExecutionBrief, type TrustedStepFacts } from "./compiler";
import type { ExecutionBrief } from "./brief";
import { compileAgentVerificationPlan, type AgentVerificationPlan } from "./verification";
import { compileCompletionBudget, type CompletionBudget } from "./completion";

/**
 * Loading what the compiler compiles from.
 *
 * Three reads, all optional, none of them new storage. This sprint introduces no
 * intelligence table: `product_profiles` already *is* the versioned Product
 * Intelligence Snapshot, joining the repository, live and authenticated scans
 * under one schema/builder/evidence version and one input hash. A second object
 * with the same job would be the duplicate source of truth the sprint set out to
 * avoid.
 *
 * ## Why the failure mode is "no brief", never "no run"
 *
 * A brief is an optimisation. Every one of these reads may return nothing — a
 * project analysed before the analyzer existed, a profile never built, a product
 * never deployed — and the correct response to all of them is an execution that
 * proceeds exactly as it did before this sprint, told to go and look. An
 * optimisation that can fail an execution is not an optimisation.
 *
 * ## Ownership (Rule 53)
 *
 * This runs under the service-role client during durable execution, where RLS is
 * bypassed. Every read is therefore scoped by a `projectId` taken from the
 * persisted operation row, never from anything the caller computed.
 */

export type LoadExecutionBriefInput = {
  supabase: SupabaseClient;
  projectId: string;
  spec: ExecutionSpec;
};

/**
 * Compiles the brief for one execution, or returns null.
 *
 * Null when the snapshot the spec names cannot be read at all. A snapshot that
 * loads but describes a different commit is *not* null: it produces a brief
 * whose freshness gate withholds every repository-derived claim, and that brief
 * is worth compiling because it still records — durably, on the run — that Vibe
 * had intelligence and deliberately declined to use it. "We had a map of the
 * wrong tree" is a different fact from "we had no map", and only one of them is
 * a reason to go and re-analyse.
 */
export async function loadExecutionBrief(
  input: LoadExecutionBriefInput,
): Promise<ExecutionBrief | null> {
  const { supabase, projectId, spec } = input;

  const snapshotId = spec.repository.repositorySnapshotId;
  if (!snapshotId) return null;

  const [snapshot, profile, live, step] = await Promise.all([
    getSnapshotById(supabase, { snapshotId, projectId }).catch(() => null),
    getLatestProfile(supabase, projectId).catch(() => null),
    getLatestSuccessfulLiveSnapshot(supabase, projectId).catch(() => null),
    loadPlanStep(input),
  ]);

  if (!snapshot?.result) return null;

  return compileExecutionBrief({
    spec,
    snapshot: snapshot.result,
    productProfile: profile?.profile ?? null,
    /*
     * The origin the live scan actually reached, not the URL the user typed —
     * a configured URL that redirected describes a place the product is not.
     * Either way its relation to this commit is `unknown`, and the compiler
     * says so rather than implying the deployed site is this code.
     */
    liveOrigin: live?.result?.source.effectiveOrigin ?? null,
    /*
     * The scan itself, so the compiler can tell a page an anonymous visitor
     * actually reached from one that redirected to a login. It corroborates the
     * public/authenticated split and never contributes a path (Sprint 0044).
     */
    liveSnapshot: live?.result ?? null,
    step: step ? trustedFactsOf(step) : null,
  });
}

/**
 * The plan step this spec was built from.
 *
 * Found by `stepKey` on the plan the spec names, never "the newest plan for this
 * project" — a spec is a value with an identity, and a run that re-read the
 * current plan could be compiled against a step that has since been reworded.
 *
 * Unreadable means null, and null means the compiler falls back to the prose
 * hints it used before Sprint 0044. A missing plan degrades context; it never
 * fails a run.
 *
 * Exported so every reader of "the trusted step behind this spec" — the
 * verification classifier below, and `writeAgentBranchStep`'s commit-message
 * compiler (Sprint 0046) — goes through the same lookup rather than each
 * re-implementing the fixture-then-database check.
 */
export async function loadPlanStep(input: LoadExecutionBriefInput): Promise<ActionPlanStep | null> {
  /*
   * An internal benchmark step comes from Vibe's own fixture registry.
   *
   * Recognised by its key alone, which cannot collide: a Planner step id is
   * `${order}-${changeKind}-${slug(title)}`, so none of them begins with the
   * benchmark namespace. That is what lets a controlled benchmark reach the
   * real Context Compiler and the real verification classifier without a
   * fabricated Action Plan row existing anywhere — the fixture is Vibe-authored
   * code, present in this process, and it goes through the same `classifyStep`
   * a customer's plan does (`coding-agent/dogfood/fixtures.ts`).
   *
   * Checked before the database, deliberately: a benchmark must never be able
   * to pick up a customer's step, and a customer's step can never be named this.
   */
  const fixture = fixtureForStepKey(input.spec.stepKey);
  if (fixture) {
    const snapshot = await getSnapshotById(input.supabase, {
      snapshotId: input.spec.repository.repositorySnapshotId,
      projectId: input.projectId,
    }).catch(() => null);
    return benchmarkStep(fixture, snapshot?.result ?? null);
  }

  try {
    const plan = await getActionPlanById(input.supabase, input.spec.actionPlanId);
    return (
      plan?.steps.find(
        (entry) => entry.id === input.spec.stepKey || entry.order === input.spec.stepOrder,
      ) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * The two fields of a step the compiler is allowed to route on.
 *
 * Narrowed deliberately at the boundary rather than passing the whole step: a
 * step also carries `title`, `description` and `purpose`, and handing those to
 * a surface resolver is how prose gets back in (PART Q).
 */
function trustedFactsOf(step: ActionPlanStep): TrustedStepFacts {
  return { changeKind: step.changeKind, evidenceIds: step.evidenceIds ?? [] };
}


/**
 * How much this run may check its own work (Sprint 0042).
 *
 * ## Why it is loaded here and not read off the spec
 *
 * The two fields that decide it — `changeKind` and the Vibe-minted
 * `evidenceIds` the step cites — live on `action_plan_steps` and are not copied
 * into `ExecutionSpec`. Re-reading them is a deliberate choice over widening the
 * spec: the spec's identity is a hash over what it already carries, and adding
 * fields to it would make every stored spec's identity unrecomputable.
 *
 * The step is found by `stepKey` on the plan the spec names, not by "the newest
 * plan for this project". A spec is a value with an identity, and a run that
 * re-read the current plan could be verified against a step that has since been
 * reworded.
 *
 * ## Why a failure here is not a failure of the run
 *
 * Null means "no plan", and a run with no plan behaves exactly as run #4 did:
 * unbounded self-checking, the v2 instruction, nothing refused. That is the
 * correct direction to fail. A missing plan that meant "forbid every check"
 * would turn an unreadable row into an agent that cannot see its own mistakes.
 */
export async function loadAgentVerificationPlan(
  input: LoadExecutionBriefInput,
): Promise<AgentVerificationPlan | null> {
  const { spec } = input;

  const step = await loadPlanStep(input);
  if (!step) return null;

  return compileAgentVerificationPlan({
    ...trustedFactsOf(step),
    riskClass: spec.riskClass,
  });
}


/**
 * How much work is allowed after the code is written.
 *
 * Keyed on the verification mode rather than classified again, because the two
 * questions have the same answer: a task shallow enough to need only a diff
 * review is a task that should not need ten files read afterwards, and one deep
 * enough to warrant the full suite is one whose failures take room to diagnose.
 * A second taxonomy would be a second thing to keep in agreement.
 */
export function completionBudgetFor(plan: AgentVerificationPlan | null): CompletionBudget | null {
  return plan ? compileCompletionBudget(plan.mode) : null;
}
