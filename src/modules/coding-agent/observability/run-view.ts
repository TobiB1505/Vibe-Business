import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveAgentLimits, deriveGatewayCeilings } from "../budget";
import type { LiveRunRow, ValidationState } from "./live-view";
import type { FreshnessState } from "@/modules/execution-context/brief";

/**
 * The run's own row, plus the two things derived from its spec.
 *
 * ## Why the budget is re-derived rather than read
 *
 * Because it is not stored on the run. `agent_execution_runs` records what a
 * run *did*; the ceilings it did it under live in the `ExecutionSpec`, which is
 * the authority (§15). Re-deriving here means the inspector shows the budget
 * the run was actually executed against — including for a run started before a
 * policy version changed, which a denormalized copy would have got wrong in
 * exactly the case where it mattered.
 *
 * ## Why validation is read and never inferred
 *
 * Validation is a separate operation against the prepared branch, run by a
 * separate sandbox with its own verdict. The agent's own checks are advisory
 * and Vibe's are authoritative, so this reports what the validation system
 * says and reports `not_started` when it has not said anything — never a state
 * synthesised from how the agent run went.
 */

export type AgentRunLiveContext = {
  run: LiveRunRow;
  limits: { maxWallClockMs: number; maxTurns: number; maxProviderSpendUsd: number } | null;
  gatewayRequestCeiling: number | null;
  validation: ValidationState;
};

type RawRun = {
  id: string;
  operation_run_id: string;
  execution_spec_id: string;
  status: string;
  assistant_messages: number;
  sdk_loop_iterations: number | null;
  model: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  observed_path_count: number;
  changed_file_count: number;
  context_brief_version: string | null;
  context_freshness: FreshnessState | null;
  context_bytes: number | null;
  context_facts_sent: number | null;
  context_candidates_sent: number | null;
  context_candidates_read: number | null;
  unique_files_read: number | null;
  repeated_file_reads: number | null;
  files_read_outside_context: number | null;
  verification_mode: string | null;
  verification_plan_version: string | null;
  verification_commands: number | null;
  verification_refusals: number | null;
  verification_ms: number | null;
  time_to_first_edit_ms: number | null;
  time_to_last_edit_ms: number | null;
};

export async function readAgentRunForLiveView(
  supabase: SupabaseClient,
  params: { runId: string; projectId: string },
): Promise<AgentRunLiveContext | null> {
  const { data, error } = await supabase
    .from("agent_execution_runs")
    .select(
      "id, operation_run_id, execution_spec_id, status, assistant_messages, sdk_loop_iterations, model, started_at, completed_at, duration_ms, observed_path_count, changed_file_count, context_brief_version, context_freshness, context_bytes, context_facts_sent, context_candidates_sent, context_candidates_read, unique_files_read, repeated_file_reads, files_read_outside_context, verification_mode, verification_plan_version, verification_commands, verification_refusals, verification_ms, time_to_first_edit_ms, time_to_last_edit_ms",
    )
    .eq("id", params.runId)
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as RawRun;

  const run: LiveRunRow = {
    id: row.id,
    status: row.status,
    assistantMessages: row.assistant_messages,
    sdkLoopIterations: row.sdk_loop_iterations,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    observedPathCount: row.observed_path_count,
    changedFileCount: row.changed_file_count,

    /*
     * Present only when the run actually recorded a brief version.
     *
     * The read counts stay nullable inside it, because they are written one
     * step later than the compile counts: a run being watched live has been
     * briefed but has not finished reading, and zero would claim it read
     * nothing rather than that nobody has counted yet.
     */
    verification: row.verification_mode
      ? {
          mode: row.verification_mode,
          planVersion: row.verification_plan_version,
          commands: row.verification_commands,
          refusals: row.verification_refusals,
          verificationMs: row.verification_ms,
          timeToFirstEditMs: row.time_to_first_edit_ms,
          timeToLastEditMs: row.time_to_last_edit_ms,
        }
      : null,

    context: row.context_brief_version
      ? {
          briefVersion: row.context_brief_version,
          freshness: row.context_freshness ?? "unknown",
          bytes: row.context_bytes ?? 0,
          factsSent: row.context_facts_sent ?? 0,
          candidatesSent: row.context_candidates_sent ?? 0,
          candidatesRead: row.context_candidates_read,
          uniqueFilesRead: row.unique_files_read,
          repeatedFileReads: row.repeated_file_reads,
          filesReadOutsideContext: row.files_read_outside_context,
        }
      : null,
  };

  const [limits, validation] = await Promise.all([
    readLimits(supabase, { specId: row.execution_spec_id, projectId: params.projectId }),
    readValidationState(supabase, { operationRunId: row.operation_run_id, projectId: params.projectId }),
  ]);

  return {
    run,
    limits: limits
      ? {
          maxWallClockMs: limits.maxWallClockMs,
          maxTurns: limits.maxTurns,
          maxProviderSpendUsd: limits.maxProviderSpendUsd,
        }
      : null,
    gatewayRequestCeiling: limits
      ? deriveGatewayCeilings({ limits, model: row.model }).maxRequests
      : null,
    validation,
  };
}

async function readLimits(
  supabase: SupabaseClient,
  params: { specId: string; projectId: string },
) {
  const { data, error } = await supabase
    .from("execution_specs")
    .select("spec")
    .eq("id", params.specId)
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (error) throw error;

  const spec = (data as { spec?: { budget?: unknown; policy?: unknown } } | null)?.spec;
  if (!spec?.budget || !spec.policy) return null;

  try {
    return deriveAgentLimits({
      budget: spec.budget as Parameters<typeof deriveAgentLimits>[0]["budget"],
      policy: spec.policy as Parameters<typeof deriveAgentLimits>[0]["policy"],
    });
  } catch {
    // A spec shape this build does not understand is a display gap, never a
    // reason to fail a page that is showing somebody their running execution.
    return null;
  }
}

/**
 * What the independent validation system says about this operation's change.
 *
 * Keyed through `prepared_changes`, because validation runs against the
 * prepared branch rather than against the agent execution — the two are
 * deliberately separate systems, and joining them anywhere else would blur
 * exactly the boundary that keeps the agent's own checks advisory.
 */
async function readValidationState(
  supabase: SupabaseClient,
  params: { operationRunId: string; projectId: string },
): Promise<ValidationState> {
  const { data: prepared, error: preparedError } = await supabase
    .from("prepared_changes")
    .select("id")
    .eq("operation_run_id", params.operationRunId)
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (preparedError) throw preparedError;
  if (!prepared) return "not_started";

  const { data, error } = await supabase
    .from("validation_runs")
    .select("status")
    .eq("prepared_change_id", (prepared as { id: string }).id)
    .eq("project_id", params.projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // A missing validation table or row is "it has not run", not an error worth
  // failing a status read for.
  if (error) return "not_started";

  const status = (data as { status: string } | null)?.status;
  if (!status) return "not_started";

  if (status === "queued") return "queued";
  if (status === "running") return "running";
  if (status === "passed") return "passed";
  if (status === "failed" || status === "errored") return "failed";

  return "not_started";
}
