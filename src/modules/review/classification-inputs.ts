import type { SupabaseClient } from "@supabase/supabase-js";
import { findAgentRunByOperation } from "@/modules/coding-agent/store";
import { usablePath } from "@/modules/execution-context/compiler";
import { loadPlanStep } from "@/modules/execution-context/service";
import {
  deriveExecutionSurfaceRequirement,
  resolveExecutionSurface,
  type ExecutionSurfaceRequirement,
  type ResolvedExecutionSurface,
} from "@/modules/execution-context/surface";
import { findExecutionSpecByIdentity } from "@/modules/execution-contract/store";
import { getPreparedChange } from "@/modules/execution/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { classifyReview, type ReviewClassificationResult } from "./classification";

/**
 * Gathering what the review classifier needs (Sprint 0048).
 *
 * The same shape and the same discipline as `validation/depth-inputs.ts`, and
 * deliberately so: one function that assembles trusted inputs, every lookup
 * allowed to fail, and a degradation that is documented rather than incidental.
 *
 * ## What degrades, and to what
 *
 * - No repository snapshot, or one whose route analysis came back `limited` or
 *   `none` → `surface` is null. The classifier still answers from the
 *   structural test; it just cannot name the routes a change touches.
 * - No agent run, no spec, or no plan step → no evidence-derived scopes. The
 *   classification is unaffected: scopes are carried for the explanation, never
 *   consulted for the decision.
 * - No prepared change → null, and the caller shows nothing. A recommendation
 *   about a change that does not exist is worse than silence.
 *
 * The one input that never degrades is the changed-path list, which comes off
 * the prepared change Vibe itself verified — and that is the input the decision
 * actually rests on.
 */

export type ReviewClassificationInput = {
  supabase: SupabaseClient;
  projectId: string;
  preparedChangeId: string;
};

export async function classifyReviewForPreparedChange(
  input: ReviewClassificationInput,
): Promise<ReviewClassificationResult | null> {
  const prepared = await getPreparedChange(input.supabase, {
    projectId: input.projectId,
    preparedChangeId: input.preparedChangeId,
  });
  if (!prepared) return null;

  const [surface, requirement] = await Promise.all([
    loadSurface(input),
    loadRequirement(input, prepared.operationRunId),
  ]);

  return classifyReview({
    changedPaths: prepared.files.map((file) => file.path),
    surface,
    requirement,
  });
}

/**
 * The analyzer's route table for this project, when one resolved.
 *
 * `live` is null on purpose. A live scan may only ever *corroborate* the split
 * between public and authenticated pages, and this classification does not
 * depend on which side a route falls on — both are visual. Loading a second
 * snapshot to refine a distinction nobody reads would be work for its own sake.
 */
async function loadSurface(
  input: ReviewClassificationInput,
): Promise<ResolvedExecutionSurface | null> {
  try {
    const snapshot = await getLatestSuccessfulSnapshot(input.supabase, input.projectId);
    if (!snapshot?.result) return null;

    return resolveExecutionSurface({ snapshot: snapshot.result, live: null, usablePath });
  } catch {
    return null;
  }
}

/**
 * The evidence-derived surface scopes, reached through the run that prepared
 * this change.
 *
 * The same chain the depth resolver walks — agent run, spec identity, stored
 * spec, plan step — because it is the only path from a prepared change back to
 * the trusted Action Step, and having two would mean having two that can
 * disagree.
 */
async function loadRequirement(
  input: ReviewClassificationInput,
  operationRunId: string,
): Promise<ExecutionSurfaceRequirement | null> {
  try {
    const agentRun = await findAgentRunByOperation(input.supabase, operationRunId);
    if (!agentRun) return null;

    const { data } = await input.supabase
      .from("execution_specs")
      .select("spec_identity")
      .eq("id", agentRun.executionSpecId)
      .eq("project_id", input.projectId)
      .maybeSingle();

    const specIdentity = (data as { spec_identity: string } | null)?.spec_identity;
    if (!specIdentity) return null;

    const stored = await findExecutionSpecByIdentity(input.supabase, {
      projectId: input.projectId,
      specIdentity,
    });
    if (!stored) return null;

    const planStep = await loadPlanStep({
      supabase: input.supabase,
      projectId: input.projectId,
      spec: stored.spec,
    });
    if (!planStep) return null;

    return deriveExecutionSurfaceRequirement({
      evidenceIds: planStep.evidenceIds,
      changeKind: planStep.changeKind,
    });
  } catch {
    return null;
  }
}
