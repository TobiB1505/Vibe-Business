import "server-only";
import { estimateSandboxCost } from "@/modules/economy/sandbox-usage-estimate";
import { meterSandboxUsage } from "@/modules/credits/meter";
import type { SandboxUsageRow } from "@/modules/credits/projection";
import { SANDBOX_RESOURCES } from "@/modules/validation/budgets";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAIUsage } from "@/modules/ai/usage";
import type { SandboxUsage } from "@/modules/validation/sandbox-port";
import type { AgentModelUsage } from "./provider";
import type { AgentProviderOutcome } from "./schema";

/**
 * Metering one agent execution (EXECUTION CORE-4 §19, §20, §35, §46).
 *
 * ## Two ledgers, unchanged
 *
 * ```
 * ai_usage_events        inference          tokens, priced by the cost book
 * sandbox_usage_events   compute            CPU ms, bytes, no token concept
 * ```
 *
 * Sprint 10A separated them because mixing sandbox compute into the AI ledger
 * would corrupt every cost-per-audit figure Sprint 4 built. An agent run
 * consumes both, so it writes to both — and to nothing new. §20 asks for the
 * *existing* provider usage infrastructure, not a third table.
 *
 * ## What is authoritative, and what is merely carried
 *
 * §19 is specific: do not use a client-side aggregate cost as the sole billing
 * authority when the provider does not guarantee it. The Claude Agent SDK's own
 * type documentation calls its `costUSD` "an estimate, not a billing statement",
 * so this module prices tokens through `ai/pricing.ts` — the same effective-
 * dated, integer-nanodollar book every other paid call in this product uses —
 * and keeps the SDK's figure out of the ledger entirely.
 *
 * That is not distrust for its own sake. It means the first Agent cost baseline
 * is denominated the same way as the audit's, so the two can be compared, and
 * it means a provider price change is picked up by the cost book rather than by
 * whatever version of an SDK happened to be installed.
 *
 * ## Unknown is not zero (§20, §46)
 *
 * Vercel meters Active CPU and egress but exposes no attributable per-sandbox
 * amount, so `provider_cost_usd` on a sandbox event stays null. A number
 * derived from a public rate card would be a guess wearing an accounting
 * figure's clothes — the same refusal `validation/vercel/provider.ts` already
 * makes, and it holds here.
 *
 * ## Failures are metered too (§35)
 *
 * A provider that errored after generating tokens still billed for them. Usage
 * is recorded for every outcome, successful or not, because the customer's
 * Credit settlement and Vibe's provider invoice are separate facts and only one
 * of them is decided by whether the run delivered anything.
 */

export type AgentUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** The provider's own estimate, summed. Reported, never used as the ledger figure. */
  reportedCostUsd: number | null;
};

/** Sums per-model usage into one set of totals, for a report. */
export function totalAgentUsage(usage: readonly AgentModelUsage[]): AgentUsageTotals {
  let reported: number | null = null;

  const totals = usage.reduce<AgentUsageTotals>(
    (accumulator, entry) => {
      if (entry.reportedCostUsd !== null) reported = (reported ?? 0) + entry.reportedCostUsd;
      return {
        inputTokens: accumulator.inputTokens + entry.inputTokens,
        outputTokens: accumulator.outputTokens + entry.outputTokens,
        cacheReadInputTokens: accumulator.cacheReadInputTokens + entry.cacheReadInputTokens,
        cacheCreationInputTokens:
          accumulator.cacheCreationInputTokens + entry.cacheCreationInputTokens,
        reportedCostUsd: null,
      };
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      reportedCostUsd: null,
    },
  );

  return { ...totals, reportedCostUsd: reported };
}

/**
 * Records agent inference, one ledger row per model (§19).
 *
 * Per model rather than one aggregated row, because the SDK reports per-model
 * totals and the cost book prices per model. Collapsing them would require
 * choosing a single model name for a bill that may span two, and a ledger that
 * has to guess which model it is describing is a ledger that cannot be audited.
 *
 * A model with no tokens at all writes nothing: §47 says record usage only when
 * tokens were genuinely billed, and a zero row is a claim that a call happened.
 */
export async function recordAgentAiUsage(
  supabase: SupabaseClient,
  params: {
    userId: string;
    projectId: string;
    /** The AgentExecutionRun. Binds every row to one execution (§19). */
    agentExecutionRunId: string;
    provider: string;
    usage: readonly AgentModelUsage[];
    outcome: AgentProviderOutcome;
    durationMs: number;
    failureCode: string | null;
  },
): Promise<void> {
  for (const entry of params.usage) {
    const billedAnything =
      entry.inputTokens > 0 ||
      entry.outputTokens > 0 ||
      entry.cacheReadInputTokens > 0 ||
      entry.cacheCreationInputTokens > 0;
    if (!billedAnything) continue;

    await recordAIUsage(supabase, {
      userId: params.userId,
      projectId: params.projectId,
      operation: "agentic_execution",
      provider: params.provider,
      model: entry.model,
      jobId: params.agentExecutionRunId,
      status: params.outcome === "completed" ? "succeeded" : "failed",
      usage: {
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        // The agent harness does not report reasoning tokens separately, and
        // they are already inside `outputTokens` where the provider bills them.
        // Recording a fabricated split would be worse than recording none.
        thinkingTokens: 0,
      },
      cacheReadInputTokens: entry.cacheReadInputTokens,
      cacheCreationInputTokens: entry.cacheCreationInputTokens,
      // There is no pre-call count for an agent loop: the input is a
      // conversation that does not exist until it happens. Null rather than a
      // number that would silently corrupt the estimate-drift measurement.
      estimatedInputTokens: null,
      latencyMs: params.durationMs,
      failureCode: params.outcome === "completed" ? null : (params.failureCode ?? params.outcome),
    });
  }
}

/**
 * Records the sandbox an agent worked in (§20).
 *
 * Written through the same table validation uses, with `operation` naming the
 * agent rather than the validation — so the first Agent cost baseline can be
 * separated from the validation runs that follow it, which are metered
 * independently by the existing pipeline.
 *
 * `validation_run_id` carries the *agent* run id. The column is deliberately
 * not a foreign key (a ledger must outlive the run it paid for), and reusing it
 * keeps a single infrastructure ledger rather than growing a parallel one.
 */
export async function recordAgentSandboxUsage(
  supabase: SupabaseClient,
  params: {
    userId: string;
    projectId: string;
    agentExecutionRunId: string;
    provider: string;
    runtime: string | null;
    usage: SandboxUsage | null;
    sandboxDurationMs: number | null;
    cleanupStatus: string;
    succeeded: boolean;
    failureCode: string | null;
  },
): Promise<void> {
  const estimate = estimateSandboxCost({
    purpose: "agent_execution",
    sandboxDurationMs: params.sandboxDurationMs,
    activeCpuMs: params.usage?.activeCpuDurationMs ?? null,
    outboundBytes: params.usage?.networkEgressBytes ?? null,
    // The agent's `create` passes no resource shape, so the provider applies
    // `SANDBOX_RESOURCES.vcpus` — the same constant, read from the same place
    // rather than repeated as a number here.
    vcpus: SANDBOX_RESOURCES.vcpus,
  });

  const { data, error } = await supabase.from("sandbox_usage_events").insert({
    user_id: params.userId,
    project_id: params.projectId,
    operation: "agent_execution",
    provider: params.provider,
    runtime: params.runtime,
    validation_run_id: params.agentExecutionRunId,
    status: params.succeeded ? "passed" : "failed",
    sandbox_duration_ms: params.sandboxDurationMs,
    active_cpu_ms: params.usage?.activeCpuDurationMs ?? null,
    network_ingress_bytes: params.usage?.networkIngressBytes ?? null,
    network_egress_bytes: params.usage?.networkEgressBytes ?? null,
    // Null unless the provider exposes an attributable billed amount. Vercel
    // does not, and an estimate here would be a guess in an accounting column —
    // which is why the estimate has columns of its own (ADR 0073).
    provider_cost_usd: params.usage?.costUsd ?? null,
    estimated_cost_nano_usd: estimate.estimatedCostNanoUsd,
    cost_pricing_version: estimate.pricingVersion,
    vcpus: estimate.vcpus,
    cleanup_status: params.cleanupStatus,
    failure_code: params.failureCode,
  }).select("id, user_id, project_id, provider, sandbox_duration_ms, active_cpu_ms, network_ingress_bytes, network_egress_bytes, provider_cost_usd, estimated_cost_nano_usd, cost_pricing_version, created_at").single();

  /*
   * Into the billing ledger immediately (ADR 0073).
   *
   * The measurement and its projection are the same event, so the ledger that
   * makes margin knowable is current by construction rather than by a repair
   * pass an operator has to remember.
   */
  if (data) await meterSandboxUsage(supabase, data as unknown as SandboxUsageRow);

  if (error) {
    // Never throws. A ledger write failing must not fail a run whose provider
    // cost has already been incurred — the same rule `recordAIUsage` follows.
    console.error("[agent-usage] failed to record sandbox usage", {
      agentExecutionRunId: params.agentExecutionRunId,
      message: error.message,
    });
  }
}
