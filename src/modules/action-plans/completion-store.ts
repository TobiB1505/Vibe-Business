import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentStepCompletionEvidence } from "./completion";

type CompletionSpecRow = {
  id: string;
  step_key: string;
  step_order: number;
};

type CompletionRunRow = {
  id: string;
  execution_spec_id: string;
  prepared_change_id: string;
};

type VerificationEventRow = {
  agent_execution_run_id: string;
};

type PassingValidationRow = {
  id: string;
  prepared_change_id: string;
  source_integrity: unknown;
};

function changedFilesWereVerified(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "changedFilesVerified" in value &&
    value.changedFilesVerified === true
  );
}

/**
 * Reads the existing execution records that jointly authorize Agent-step
 * completion. No row alone is enough:
 *
 * 1. the immutable spec binds the run to this plan and step;
 * 2. the planner-owned run succeeded and produced a Prepared Change;
 * 3. Vibe accepted the observed candidate (`change_verified`);
 * 4. independent validation passed after verifying the changed files.
 *
 * Missing or legacy evidence stays incomplete. That is intentionally safer
 * than reconstructing authority from prose or a terminal status.
 */
export async function listAgentStepCompletionEvidence(
  supabase: SupabaseClient,
  params: { projectId: string; actionPlanId: string },
): Promise<AgentStepCompletionEvidence[]> {
  const { data: specData, error: specError } = await supabase
    .from("execution_specs")
    .select("id, step_key, step_order")
    .eq("project_id", params.projectId)
    .eq("action_plan_id", params.actionPlanId);

  if (specError) throw specError;

  const specs = (specData ?? []) as CompletionSpecRow[];
  if (specs.length === 0) return [];

  const { data: runData, error: runError } = await supabase
    .from("agent_execution_runs")
    .select("id, execution_spec_id, prepared_change_id")
    .eq("project_id", params.projectId)
    .eq("execution_origin", "planner")
    .eq("status", "succeeded")
    .in(
      "execution_spec_id",
      specs.map((spec) => spec.id),
    )
    .not("prepared_change_id", "is", null);

  if (runError) throw runError;

  const runs = (runData ?? []) as CompletionRunRow[];
  if (runs.length === 0) return [];

  const [eventResult, validationResult] = await Promise.all([
    supabase
      .from("agent_execution_events")
      .select("agent_execution_run_id")
      .eq("project_id", params.projectId)
      .eq("type", "change_verified")
      .in(
        "agent_execution_run_id",
        runs.map((run) => run.id),
      ),
    supabase
      .from("validation_runs")
      .select("id, prepared_change_id, source_integrity")
      .eq("project_id", params.projectId)
      .eq("status", "passed")
      .in(
        "prepared_change_id",
        runs.map((run) => run.prepared_change_id),
      ),
  ]);

  if (eventResult.error) throw eventResult.error;
  if (validationResult.error) throw validationResult.error;

  const verifiedRunIds = new Set(
    ((eventResult.data ?? []) as VerificationEventRow[]).map(
      (event) => event.agent_execution_run_id,
    ),
  );
  const validationsByPreparedChange = new Map<string, PassingValidationRow>();

  for (const validation of (validationResult.data ?? []) as PassingValidationRow[]) {
    if (!changedFilesWereVerified(validation.source_integrity)) continue;
    if (!validationsByPreparedChange.has(validation.prepared_change_id)) {
      validationsByPreparedChange.set(validation.prepared_change_id, validation);
    }
  }

  const specsById = new Map(specs.map((spec) => [spec.id, spec]));
  const evidence: AgentStepCompletionEvidence[] = [];

  for (const run of runs) {
    if (!verifiedRunIds.has(run.id)) continue;

    const spec = specsById.get(run.execution_spec_id);
    const validation = validationsByPreparedChange.get(run.prepared_change_id);
    if (!spec || !validation) continue;

    evidence.push({
      executionSpecId: spec.id,
      agentExecutionRunId: run.id,
      preparedChangeId: run.prepared_change_id,
      validationRunId: validation.id,
      stepKey: spec.step_key,
      stepOrder: spec.step_order,
    });
  }

  return evidence;
}
