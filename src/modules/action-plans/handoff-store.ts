import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { HandoffTool } from "@/modules/handoff/schema";

/**
 * Which steps of one plan Vibe handed to the founder (ADR 0096).
 *
 * Keyed by step, valued by tool, because both are asked: `isFounderAttestable`
 * needs to know *whether* a step was handed out, and the screen needs to know
 * *which tool* the founder picked — the prompt's opening sentence differs for
 * an agent working in a checked-out repository and a hosted builder that has
 * no branch to work on.
 */
export async function listHandoffsForPlan(
  supabase: SupabaseClient,
  params: { projectId: string; actionPlanId: string },
): Promise<Map<string, HandoffTool>> {
  const { data, error } = await supabase
    .from("action_plan_handoffs")
    .select("action_plan_step_key, tool")
    .eq("project_id", params.projectId)
    .eq("action_plan_id", params.actionPlanId);
  if (error) throw error;

  return new Map(
    ((data ?? []) as { action_plan_step_key: string; tool: HandoffTool }[]).map((row) => [
      row.action_plan_step_key,
      row.tool,
    ]),
  );
}

export async function callRecordActionPlanHandoff(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    actionPlanId: string;
    stepKey: string;
    userId: string;
    tool: HandoffTool;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("record_action_plan_handoff", {
    p_project_id: params.projectId,
    p_action_plan_id: params.actionPlanId,
    p_action_plan_step_key: params.stepKey,
    p_user_id: params.userId,
    p_tool: params.tool,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Action plan handoff returned no id.");
  return data;
}
