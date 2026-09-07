import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { HandoffPurpose, HandoffTool } from "@/modules/handoff/schema";

/** One issued prompt, as a caller needs to read it back. */
export type PlanHandoff = { tool: HandoffTool; purpose: HandoffPurpose };

/**
 * Which steps of one plan Vibe handed to the founder (ADR 0096).
 *
 * Keyed by step, valued by tool *and purpose*, because three things are asked.
 * The screen needs to know which tool the founder picked — the prompt's opening
 * sentence differs for an agent working in a checked-out repository and a
 * hosted builder that has no branch. And `isFounderAttestable` needs to know
 * whether a step was handed out **to build**: a verify handoff grants nothing,
 * and a caller that read this map as "was a prompt issued" would let one admit
 * a product change the agent exists to write.
 *
 * The purpose is returned rather than filtered here, so every caller has to say
 * which question it is asking. `buildHandoffKeys` below is the answer to the
 * one that decides completion.
 */
export async function listHandoffsForPlan(
  supabase: SupabaseClient,
  params: { projectId: string; actionPlanId: string },
): Promise<Map<string, PlanHandoff>> {
  const { data, error } = await supabase
    .from("action_plan_handoffs")
    .select("action_plan_step_key, tool, purpose")
    .eq("project_id", params.projectId)
    .eq("action_plan_id", params.actionPlanId);
  if (error) throw error;

  return new Map(
    (
      (data ?? []) as {
        action_plan_step_key: string;
        tool: HandoffTool;
        purpose: HandoffPurpose;
      }[]
    ).map((row) => [row.action_plan_step_key, { tool: row.tool, purpose: row.purpose }]),
  );
}

/**
 * The steps a prompt was issued for **to build**, which is what completion asks.
 *
 * A verify handoff must never appear here. Its step is the founder's own
 * measurement and already attestable without it; letting it into this set would
 * mean a prompt issued to *check* something could admit a product change to
 * being confirmed by hand.
 */
export function buildHandoffKeys(handoffs: ReadonlyMap<string, PlanHandoff>): Set<string> {
  return new Set(
    [...handoffs].filter(([, handoff]) => handoff.purpose === "build").map(([stepKey]) => stepKey),
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
    purpose: HandoffPurpose;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("record_action_plan_handoff", {
    p_project_id: params.projectId,
    p_action_plan_id: params.actionPlanId,
    p_action_plan_step_key: params.stepKey,
    p_user_id: params.userId,
    p_tool: params.tool,
    p_purpose: params.purpose,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Action plan handoff returned no id.");
  return data;
}
