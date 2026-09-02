import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { recordAIUsage, type RecordUsageParams } from "./usage";

/**
 * Usage ledger integrity.
 *
 * The ledger exists to make unit economics measurable, which only works if
 * it records what was actually billed. Two failure modes corrupt it in
 * opposite directions: inventing cost for a call that was never charged, and
 * losing the trace of one that was.
 */

/**
 * The insert, with the `RETURNING` the real client performs.
 *
 * `.insert().select().single()` is one PostgREST request, not two, and the
 * inserted row is what `meterAiUsage` projects into the billing ledger
 * (ADR 0073). A double that stopped at `insert` would let this file pass while
 * the metering call it enables threw in production — which is exactly what
 * happened when the chain was added.
 *
 * `data` is deliberately null here: these tests are about what is *written*,
 * and returning a row would drag the whole projection into their assertions.
 * A null return exercises the guard that keeps the metering optional.
 */
function captureInsert() {
  const rows: Record<string, unknown>[] = [];
  const supabase = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        rows.push(row);
        return {
          select: () => ({ single: async () => ({ data: null, error: null }) }),
        };
      },
    }),
  } as unknown as SupabaseClient;

  return { supabase, rows };
}

const base: RecordUsageParams = {
  userId: "11111111-1111-1111-1111-111111111111",
  projectId: "22222222-2222-2222-2222-222222222222",
  operation: "business_readiness_audit",
  provider: "anthropic",
  model: "claude-sonnet-5",
  jobId: "33333333-3333-3333-3333-333333333333",
  status: "failed",
  estimatedInputTokens: null,
  latencyMs: 0,
  failureCode: null,
};

describe("recordAIUsage — free operations", () => {
  it("records no provider cost when a free token count failed before any generation", async () => {
    const { supabase, rows } = captureInsert();

    // Exactly what the audit service writes when the cost gate fails: the
    // token count is free, so the outcome carries no usage.
    await recordAIUsage(supabase, { ...base, failureCode: "provider_billing_error" });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.provider_cost_usd).toBeNull();
    expect(row.pricing_version).toBeNull();
    expect(row.input_tokens).toBeNull();
    expect(row.output_tokens).toBeNull();
    expect(row.thinking_tokens).toBeNull();
    // The event itself is still written: the attempt happened, and the
    // reason it failed is the operationally useful part.
    expect(row.status).toBe("failed");
    expect(row.failure_code).toBe("provider_billing_error");
  });

  it("does record cost when tokens were genuinely billed", async () => {
    const { supabase, rows } = captureInsert();

    await recordAIUsage(supabase, {
      ...base,
      status: "failed",
      failureCode: "provider_refusal",
      usage: { inputTokens: 2_500, outputTokens: 900, thinkingTokens: 400 },
      latencyMs: 4_200,
    });

    const row = rows[0];
    expect(row.input_tokens).toBe(2_500);
    expect(Number(row.provider_cost_usd)).toBeGreaterThan(0);
    expect(row.pricing_version).toBeTruthy();
  });
});
