import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { callAttestFounderActionStep } from "@/modules/action-plans/founder-action-store";

export type AttestFounderActionResult =
  | { ok: true; attestationId: string }
  | {
      ok: false;
      error:
        | "project_not_found"
        | "step_not_attestable"
        | "finding_required"
        | "finding_not_accepted"
        | "attestation_failed";
    };

/**
 * The only service-role write for a founder_action attestation.
 *
 * Ownership is re-established before the RPC. The database then repeats that
 * check against the immutable plan/step pair, admits only the two step kinds
 * no execution can finish, and enforces that a Vibe step carries its finding
 * while a founder_action step carries none. Retrying returns the existing
 * evidence id.
 */
export async function attestFounderAction(params: {
  projectId: string;
  userId: string;
  actionPlanId: string;
  stepKey: string;
  /**
   * The step's own output, for a Vibe step. Null for founder_action work.
   *
   * Passed through rather than validated here: the database decides which step
   * kind must carry one and which must not, and a second opinion in TypeScript
   * could only disagree with it (ADR 0093).
   */
  finding: string | null;
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
    if (message.includes("founder_step_finding_required")) {
      return { ok: false, error: "finding_required" };
    }
    if (message.includes("founder_step_finding_not_accepted")) {
      return { ok: false, error: "finding_not_accepted" };
    }
    return { ok: false, error: "attestation_failed" };
  }
}
