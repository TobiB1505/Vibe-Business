import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateProviderCost, UnpricedModelError } from "./pricing";
import type { AIOperation, AIUsage } from "./provider";

/**
 * Internal AI usage ledger (Sprint 4 §25).
 *
 * This is provider-cost accounting, **not** the customer-facing Vibe Credit
 * ledger from PRODUCT.md §12 — no margin, no credits, no billing. It exists
 * from the first paid call so unit economics are measurable from day one
 * rather than reconstructed later from an invoice.
 *
 * What is never written here: prompt text, evidence content, model output,
 * reasoning, API keys. The ledger records *that* a call happened, what it
 * cost, and how long it took.
 */

export type UsageStatus = "succeeded" | "failed";

export type RecordUsageParams = {
  userId: string;
  projectId: string;
  operation: AIOperation;
  provider: string;
  model: string;
  /** The audit (or future job) this call belongs to. */
  jobId: string | null;
  status: UsageStatus;
  /**
   * Tokens the provider actually reported. Omitted when a call failed
   * before any tokens were billed — recording zero-cost usage as if it were
   * charged, or estimated usage as if it were actual, corrupts the ledger
   * (Sprint 4 §27).
   */
  usage?: AIUsage;
  /** Pre-call estimate from token counting, kept to measure estimate drift. */
  estimatedInputTokens: number | null;
  latencyMs: number;
  /** Typed failure code for a failed call; null when it succeeded. */
  failureCode: string | null;
};

/**
 * Writes one usage event. Never throws: a ledger write failing must not
 * fail an audit the user already paid for. Failures are logged server-side
 * for operational follow-up.
 */
export async function recordAIUsage(
  supabase: SupabaseClient,
  params: RecordUsageParams,
): Promise<void> {
  let pricingVersion: string | null = null;
  let providerCostUsd: string | null = null;

  if (params.usage) {
    try {
      const cost = calculateProviderCost({
        model: params.model,
        inputTokens: params.usage.inputTokens,
        outputTokens: params.usage.outputTokens,
      });
      pricingVersion = cost.pricingVersion;
      providerCostUsd = cost.totalUsd;
    } catch (error) {
      // An unpriced model is a configuration gap. The usage event is still
      // written — losing the token counts too would leave no trace of a
      // call that really was billed.
      if (error instanceof UnpricedModelError) {
        console.error("[ai-usage] no pricing configured", { model: params.model });
      } else {
        throw error;
      }
    }
  }

  const { error } = await supabase.from("ai_usage_events").insert({
    user_id: params.userId,
    project_id: params.projectId,
    operation: params.operation,
    provider: params.provider,
    model: params.model,
    job_id: params.jobId,
    status: params.status,
    input_tokens: params.usage?.inputTokens ?? null,
    output_tokens: params.usage?.outputTokens ?? null,
    thinking_tokens: params.usage?.thinkingTokens ?? null,
    estimated_input_tokens: params.estimatedInputTokens,
    provider_cost_usd: providerCostUsd,
    pricing_version: pricingVersion,
    latency_ms: params.latencyMs,
    failure_code: params.failureCode,
  });

  if (error) {
    console.error("[ai-usage] failed to record usage event", {
      operation: params.operation,
      status: params.status,
      message: error.message,
    });
  }
}
