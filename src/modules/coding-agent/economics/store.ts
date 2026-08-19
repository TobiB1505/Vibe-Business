import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  summarizeExecutionEconomics,
  summarizeChangeEconomics,
  type ChangeEconomics,
  type ExecutionEconomics,
  type ProviderUsageRow,
  type RunCostRow,
  type SandboxMeteringRow,
} from "./cost";

/**
 * Reading execution economics off the rows that already hold it.
 *
 * No new table and no new column: `ai_usage_events` is the per-call ledger the
 * gateway writes, `sandbox_usage_events` is the metering the cleanup step
 * writes, and `prepared_changes` is what says whether the money bought
 * anything. This file joins them; it stores nothing.
 *
 * The join key for provider usage is `job_id = agent_execution_run_id`, which
 * is the same key the run's own gateway ceilings are measured against — so the
 * cost shown in the inspector is by construction the cost the ceilings saw.
 */

export async function readExecutionEconomics(
  supabase: SupabaseClient,
  params: { runId: string; projectId: string; providerBudgetUsd?: number | null },
): Promise<ExecutionEconomics> {
  const [usage, sandbox] = await Promise.all([
    supabase
      .from("ai_usage_events")
      .select(
        "status, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, thinking_tokens, provider_cost_usd, latency_ms",
      )
      .eq("job_id", params.runId)
      .eq("project_id", params.projectId),
    supabase
      .from("sandbox_usage_events")
      .select(
        "active_cpu_ms, sandbox_duration_ms, network_egress_bytes, network_ingress_bytes, provider_cost_usd",
      )
      .eq("validation_run_id", params.runId)
      .eq("project_id", params.projectId)
      .maybeSingle(),
  ]);

  if (usage.error) throw usage.error;
  if (sandbox.error) throw sandbox.error;

  return summarizeExecutionEconomics({
    usage: (usage.data ?? []).map(toProviderRow),
    sandbox: sandbox.data ? toSandboxRow(sandbox.data as RawSandboxRow) : null,
    providerBudgetUsd: params.providerBudgetUsd ?? null,
  });
}

/**
 * Every agent run for a project, with what it cost and whether it delivered.
 *
 * The `producedPreparedChange` half is a left join on `prepared_changes` by
 * operation — not on the run's own status. A run can complete and still leave
 * nothing reviewable, which is exactly what runs #1 and #2 did, and the whole
 * point of the metric is to count that as spend without counting it as
 * delivery.
 */
export async function readProjectChangeEconomics(
  supabase: SupabaseClient,
  params: { projectId: string },
): Promise<ChangeEconomics & { rows: readonly RunCostRow[] }> {
  const { data: runs, error: runsError } = await supabase
    .from("agent_execution_runs")
    .select("id, operation_run_id")
    .eq("project_id", params.projectId);

  if (runsError) throw runsError;

  const runRows = (runs ?? []) as { id: string; operation_run_id: string }[];
  if (runRows.length === 0) {
    return { ...summarizeChangeEconomics([]), rows: [] };
  }

  const runIds = runRows.map((row) => row.id);
  const operationIds = runRows.map((row) => row.operation_run_id);

  const [usage, sandbox, prepared] = await Promise.all([
    supabase
      .from("ai_usage_events")
      .select("job_id, provider_cost_usd")
      .in("job_id", runIds)
      .eq("project_id", params.projectId),
    supabase
      .from("sandbox_usage_events")
      .select("validation_run_id, provider_cost_usd")
      .in("validation_run_id", runIds)
      .eq("project_id", params.projectId),
    supabase
      .from("prepared_changes")
      .select("operation_run_id, status")
      .in("operation_run_id", operationIds)
      .eq("project_id", params.projectId),
  ]);

  if (usage.error) throw usage.error;
  if (sandbox.error) throw sandbox.error;
  if (prepared.error) throw prepared.error;

  const providerCost = new Map<string, number>();
  for (const row of (usage.data ?? []) as { job_id: string; provider_cost_usd: string | number | null }[]) {
    providerCost.set(row.job_id, (providerCost.get(row.job_id) ?? 0) + numeric(row.provider_cost_usd));
  }

  const sandboxCost = new Map<string, number | null>();
  for (const row of (sandbox.data ?? []) as {
    validation_run_id: string;
    provider_cost_usd: string | number | null;
  }[]) {
    sandboxCost.set(
      row.validation_run_id,
      row.provider_cost_usd === null ? null : numeric(row.provider_cost_usd),
    );
  }

  // "Prepared" is the first state at which a human has something to look at.
  // A row that exists but failed to prepare bought nothing.
  const delivered = new Set(
    ((prepared.data ?? []) as { operation_run_id: string; status: string }[])
      .filter((row) => row.status === "prepared")
      .map((row) => row.operation_run_id),
  );

  const rows: RunCostRow[] = runRows.map((run) => ({
    runId: run.id,
    providerCostUsd: providerCost.get(run.id) ?? 0,
    sandboxCostUsd: sandboxCost.get(run.id) ?? null,
    producedPreparedChange: delivered.has(run.operation_run_id),
  }));

  return { ...summarizeChangeEconomics(rows), rows };
}

/** Postgres `numeric` arrives as a string. Parsing it in one place avoids drift. */
function numeric(value: string | number | null): number {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type RawUsageRow = {
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  thinking_tokens: number | null;
  provider_cost_usd: string | number | null;
  latency_ms: number | null;
};

type RawSandboxRow = {
  active_cpu_ms: number | null;
  sandbox_duration_ms: number | null;
  network_egress_bytes: number | null;
  network_ingress_bytes: number | null;
  provider_cost_usd: string | number | null;
};

function toProviderRow(raw: unknown): ProviderUsageRow {
  const row = raw as RawUsageRow;
  return {
    status: row.status,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadInputTokens: row.cache_read_input_tokens,
    cacheCreationInputTokens: row.cache_creation_input_tokens,
    thinkingTokens: row.thinking_tokens,
    providerCostUsd: row.provider_cost_usd === null ? null : numeric(row.provider_cost_usd),
    latencyMs: row.latency_ms,
  };
}

function toSandboxRow(row: RawSandboxRow): SandboxMeteringRow {
  return {
    activeCpuMs: row.active_cpu_ms,
    sandboxDurationMs: row.sandbox_duration_ms,
    networkEgressBytes: row.network_egress_bytes,
    networkIngressBytes: row.network_ingress_bytes,
    providerCostUsd: row.provider_cost_usd === null ? null : numeric(row.provider_cost_usd),
  };
}
