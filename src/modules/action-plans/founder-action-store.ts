import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FounderActionCompletionEvidence } from "./completion";

type FounderActionAttestationRow = {
  id: string;
  project_id: string;
  action_plan_id: string;
  action_plan_step_key: string;
  action_plan_step_order: number;
  attested_by_user_id: string;
  attestation_version: string;
  finding: string | null;
  created_at: string;
};

const ATTESTATION_COLUMNS =
  "id, project_id, action_plan_id, action_plan_step_key, action_plan_step_order, attested_by_user_id, attestation_version, finding, created_at";

export async function listFounderActionCompletionEvidence(
  supabase: SupabaseClient,
  params: { projectId: string; actionPlanId: string },
): Promise<FounderActionCompletionEvidence[]> {
  const { data, error } = await supabase
    .from("action_plan_founder_attestations")
    .select(ATTESTATION_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("action_plan_id", params.actionPlanId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as FounderActionAttestationRow[]).map((row) => ({
    attestationId: row.id,
    attestedByUserId: row.attested_by_user_id,
    attestedAt: row.created_at,
    attestationVersion: row.attestation_version,
    stepKey: row.action_plan_step_key,
    stepOrder: row.action_plan_step_order,
    finding: row.finding,
  }));
}

export async function callAttestFounderActionStep(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    actionPlanId: string;
    stepKey: string;
    userId: string;
    /** The step's own output for a Vibe step; absent for founder_action work. */
    finding: string | null;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("attest_founder_action_step", {
    p_project_id: params.projectId,
    p_action_plan_id: params.actionPlanId,
    p_action_plan_step_key: params.stepKey,
    p_user_id: params.userId,
    p_finding: params.finding,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Founder action attestation returned no id.");
  return data;
}

/**
 * Every finding this founder has recorded, oldest first (ADR 0092).
 *
 * Across the project rather than one plan, because a finding outlives the plan
 * it was recorded on — that is the whole point of storing it. A replan is a new
 * plan, and the thing it must not do is ask again what the founder already
 * answered.
 *
 * Bounded, because this grows with how long somebody has used the product and
 * it is assembled into a paid prompt. `attestationId` comes back so plan
 * identity can be keyed on *which* findings a plan was written against without
 * putting founder prose into a hash.
 */
export const PROJECT_FINDING_LIMIT = 40;

export type ProjectFinding = {
  attestationId: string;
  /** The step the founder answered, in the plan's own words. */
  stepTitle: string;
  finding: string;
};

export async function listProjectFindings(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectFinding[]> {
  const { data, error } = await supabase
    .from("action_plan_founder_attestations")
    .select("id, action_plan_id, action_plan_step_key, finding")
    .eq("project_id", projectId)
    .not("finding", "is", null)
    .order("created_at", { ascending: true })
    .limit(PROJECT_FINDING_LIMIT);
  if (error) throw error;

  const rows = (data ?? []) as {
    id: string;
    action_plan_id: string;
    action_plan_step_key: string;
    finding: string;
  }[];
  if (rows.length === 0) return [];

  /*
   * The title is read rather than the key rendered, because the key is an
   * internal slug and a finding without the question it answers is half a
   * sentence. Two bounded reads instead of a join: the composite foreign key
   * that links these is not a relationship PostgREST exposes, and inventing an
   * embed for it would be a query that works until it does not.
   */
  const { data: stepData, error: stepError } = await supabase
    .from("action_plan_steps")
    .select("action_plan_id, step_key, title")
    .in("action_plan_id", [...new Set(rows.map((row) => row.action_plan_id))])
    .in("step_key", [...new Set(rows.map((row) => row.action_plan_step_key))]);
  if (stepError) throw stepError;

  const titles = new Map(
    ((stepData ?? []) as { action_plan_id: string; step_key: string; title: string }[]).map(
      (row) => [`${row.action_plan_id}:${row.step_key}`, row.title],
    ),
  );

  return rows.map((row) => ({
    attestationId: row.id,
    // A step whose plan was deleted leaves the finding standing on its own,
    // which is still worth giving the planner — it just carries no question.
    stepTitle: titles.get(`${row.action_plan_id}:${row.action_plan_step_key}`) ?? "",
    finding: row.finding,
  }));
}
