import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { callAttestFounderActionStep } from "@/modules/action-plans/founder-action-store";

export type AttestFounderActionResult =
  | { ok: true; attestationId: string }
  | {
      ok: false;
      error: "project_not_found" | "step_not_attestable" | "attestation_failed";
    };

/**
 * The only service-role write for a founder_action attestation.
 *
 * Ownership is re-established before the RPC. The database then repeats that
 * check against the immutable plan/step pair and accepts only
 * founder_action/founder_acts work. Retrying returns the existing evidence id.
 */
export async function attestFounderAction(params: {
  projectId: string;
  userId: string;
  actionPlanId: string;
  stepKey: string;
}): Promise<AttestFounderActionResult> {
  const supabase = createServiceClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (projectError || !project) return { ok: false, error: "project_not_found" };

  try {
    const attestationId = await callAttestFounderActionStep(supabase, params);
    return { ok: true, attestationId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("founder_action_step_not_attestable")) {
      return { ok: false, error: "step_not_attestable" };
    }
    return { ok: false, error: "attestation_failed" };
  }
}
