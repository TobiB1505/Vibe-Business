import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { callRecordActionPlanHandoff } from "@/modules/action-plans/handoff-store";
import type { HandoffPurpose, HandoffTool } from "@/modules/handoff/schema";

export type RecordHandoffResult =
  | { ok: true; handoffId: string }
  | { ok: false; error: "project_not_found" | "step_not_handoffable" | "handoff_failed" };

/**
 * The only service-role write for a handoff (ADR 0096).
 *
 * Ownership is re-established before the RPC, and the database then admits only
 * a `vibe` + `product_change` step — the one shape Vibe declines to run and the
 * only one a handoff means anything for. Retrying returns the existing id.
 *
 * What it deliberately does not re-check is whether Vibe *currently* refuses
 * that step. The caller establishes that against the live resolution before
 * offering the prompt; asking again here could answer differently, and the row
 * is bound to one immutable plan/step pair either way.
 */
export async function recordActionPlanHandoff(params: {
  projectId: string;
  userId: string;
  actionPlanId: string;
  stepKey: string;
  tool: HandoffTool;
  /** Whether Vibe declined the work, or cannot reach the check (ADR 0096). */
  purpose: HandoffPurpose;
}): Promise<RecordHandoffResult> {
  const supabase = createServiceClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (projectError || !project) return { ok: false, error: "project_not_found" };

  try {
    const handoffId = await callRecordActionPlanHandoff(supabase, params);
    return { ok: true, handoffId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("action_plan_step_not_handoffable")) {
      return { ok: false, error: "step_not_handoffable" };
    }
    return { ok: false, error: "handoff_failed" };
  }
}
