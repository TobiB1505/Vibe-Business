import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  summarizeExecutionEconomics,
  type ExecutionEconomics,
  type ProviderUsageRow,
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
 *
 * `ai_usage_events` has been deliberately unreachable through the Data API
 * since the Wave 1 privilege work (see `sum_agent_run_usage`), so its half of
 * this read goes through `list_ai_usage_events_for_run` on the service-role
 * client rather than the caller's session-scoped one — this file is a
 * reviewed site in `service-boundary.test.ts`. Ownership of `params.projectId`
 * is not taken from this function's arguments: it was already established a
 * moment earlier by the caller's own RLS-scoped read of the operation row,
 * filtered by both the project id and the session's user id together.
 */

export async function readExecutionEconomics(
  supabase: SupabaseClient,
  params: {
    runId: string;
    projectId: string;
    providerBudgetUsd?: number | null;
    /** The run's own start, on Vibe's clock, and where its last write landed. */
    startedAt?: string | null;
    lastEditMs?: number | null;
  },
): Promise<ExecutionEconomics> {
  const [usage, sandbox] = await Promise.all([
    createServiceClient().rpc("list_ai_usage_events_for_run", {
      p_run_id: params.runId,
      p_project_id: params.projectId,
    }),
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
    startedAt: params.startedAt ?? null,
    lastEditMs: params.lastEditMs ?? null,
  });
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
  created_at?: string | null;
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
    createdAt: row.created_at ?? null,
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
