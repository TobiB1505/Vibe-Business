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
  created_at: string;
};

const ATTESTATION_COLUMNS =
  "id, project_id, action_plan_id, action_plan_step_key, action_plan_step_order, attested_by_user_id, attestation_version, created_at";

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
  }));
}

export async function callAttestFounderActionStep(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    actionPlanId: string;
    stepKey: string;
    userId: string;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("attest_founder_action_step", {
    p_project_id: params.projectId,
    p_action_plan_id: params.actionPlanId,
    p_action_plan_step_key: params.stepKey,
    p_user_id: params.userId,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Founder action attestation returned no id.");
  return data;
}
