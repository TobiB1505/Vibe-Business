import { describe, expect, it } from "vitest";
import { calculateProviderCost } from "@/modules/ai/pricing";
import {
  projectAiUsage,
  projectDeepScanUsage,
  projectReviewBrowserUsage,
  projectSandboxUsage,
  storedCostToNanoUsd,
  summarizeCost,
  type AiUsageRow,
  type SandboxUsageRow,
} from "./projection";
import { rateUsage } from "./rating";
import { NON_CHARGEABLE_SKUS } from "./schema";

/**
 * Usage projection (BILLING CORE-1 §16, §18, §41, §42, §52, §69).
 *
 * The claim under test is narrow and load-bearing: projecting a provider
 * ledger row into billing must not change what it says. Specifically it must
 * not turn an unknown cost into a free one, and its recomputed cost must equal
 * the figure the canonical ledger already stored — because §69 says a
 * disagreement is a semantic mismatch to investigate, not something to paper
 * over.
 */

function aiRow(overrides: Partial<AiUsageRow> = {}): AiUsageRow {
  return {
    id: "usage-1",
    user_id: "user-1",
    project_id: "project-1",
    operation: "business_readiness_audit",
    provider: "anthropic",
    model: "claude-sonnet-5",
    job_id: "audit-1",
    status: "succeeded",
    input_tokens: 20_000,
    output_tokens: 4_000,
    thinking_tokens: 1_200,
    // Null is the honest default: no operation but an agent turn has a cache
    // breakpoint, so every other row in the live ledger carries nulls here.
    cache_read_input_tokens: null,
    cache_creation_input_tokens: null,
    provider_cost_usd: null,
    pricing_version: null,
    // Inside the introductory Sonnet window: $2/MTok in, $10/MTok out.
    created_at: "2026-08-14T18:00:00.000Z",
    ...overrides,
  };
}

describe("AI usage projection", () => {
  it("splits one call into per-SKU events", () => {
    const events = projectAiUsage(aiRow());
    expect(events.map((event) => event.sku)).toEqual([
      "anthropic_input_tokens",
      "anthropic_output_tokens",
      "anthropic_thinking_tokens",
    ]);
    expect(events[0].quantity).toBe(20_000);
    expect(events[1].quantity).toBe(4_000);
    expect(events[2].quantity).toBe(1_200);
  });

  /**
   * §69 — the reconciliation guarantee. Billing must reproduce the AI
   * ledger's own arithmetic exactly, using the same authoritative module,
   * evaluated at the row's own timestamp.
   */
  it("recomputes exactly the cost the authoritative pricing module produces", () => {
    const row = aiRow();
    const events = projectAiUsage(row);
    const authoritative = calculateProviderCost({
      model: row.model,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      at: new Date(row.created_at),
    });

    const projectedCost = events.reduce((total, event) => total + (event.rawCostNanoUsd ?? 0), 0);
    expect(projectedCost).toBe(authoritative.totalNanoUsd);
    // 20_000 * 2_000 + 4_000 * 10_000 = 40_000_000 + 40_000_000 nanodollars.
    expect(projectedCost).toBe(80_000_000);
    expect(events[0].providerPricingVersion).toBe(authoritative.pricingVersion);
  });

  /**
   * Sprint 0057 E2 — cache tokens are billed, and only one side priced them.
   *
   * `ai/usage.ts` passes `cacheReadInputTokens` and `cacheCreationInputTokens`
   * into `calculateProviderCost` and stores the result in `provider_cost_usd`.
   * This module re-priced from input and output alone, so for every agent turn
   * the two figures disagreed by the whole cache bill — and `reconciliation.ts`
   * reported each disagreement as a §69 semantic mismatch, which is exactly
   * what a §69 mismatch is supposed to mean.
   *
   * Measured against the live ledger before this was written: 314 AI usage
   * rows, 234 of them carrying cache tokens, and 234 mismatches. Not a
   * coincidence — the same 234 rows.
   */
  it("recomputes the cost of a cached agent turn exactly as the ledger stored it", () => {
    // The shape `recordAIUsage` writes for an agent turn: a small uncached
    // prompt, a large cache read of the transcript, and a cache write.
    const written = calculateProviderCost({
      model: "claude-sonnet-5",
      inputTokens: 1_200,
      outputTokens: 300,
      cacheReadInputTokens: 40_000,
      cacheCreationInputTokens: 2_000,
      at: new Date("2026-08-14T18:00:00.000Z"),
    });

    const row = aiRow({
      input_tokens: 1_200,
      output_tokens: 300,
      thinking_tokens: null,
      cache_read_input_tokens: 40_000,
      cache_creation_input_tokens: 2_000,
      provider_cost_usd: written.totalUsd,
    });

    const events = projectAiUsage(row);
    const projectedCost = events.reduce((total, event) => total + (event.rawCostNanoUsd ?? 0), 0);

    // 1_200 * 2_000 + 300 * 10_000 + 40_000 * 200 + 2_000 * 2_500
    //   = 2_400_000 + 3_000_000 + 8_000_000 + 5_000_000
    expect(projectedCost).toBe(18_400_000);
    expect(projectedCost).toBe(written.totalNanoUsd);
    // The §69 comparison `reconciliation.ts` actually makes.
    expect(projectedCost).toBe(storedCostToNanoUsd(row.provider_cost_usd));
  });

  /**
   * The metering half, which is what the cost test above deliberately does not
   * cover: the same cached turn must now also *count* the cache tokens, or a
   * rate card has no quantity to rate.
   */
  it("meters cache read and cache write as their own SKUs", () => {
    const events = projectAiUsage(
      aiRow({
        thinking_tokens: null,
        cache_read_input_tokens: 40_000,
        cache_creation_input_tokens: 2_000,
      }),
    );

    expect(events.map((event) => event.sku)).toEqual([
      "anthropic_input_tokens",
      "anthropic_output_tokens",
      "anthropic_cache_read_tokens",
      "anthropic_cache_write_tokens",
    ]);

    const byS = new Map(events.map((event) => [event.sku, event]));
    expect(byS.get("anthropic_cache_read_tokens")?.quantity).toBe(40_000);
    expect(byS.get("anthropic_cache_write_tokens")?.quantity).toBe(2_000);
  });

  /**
   * The invariant the cost test asserts, restated against the rows that were
   * just added: metering a unit must not bill for it twice. The cache price is
   * already inside the single figure on the input row.
   */
  it("attaches no second cost to the cache rows", () => {
    const events = projectAiUsage(
      aiRow({ cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2_000 }),
    );

    const cache = events.filter((event) => event.sku.startsWith("anthropic_cache_"));
    expect(cache).toHaveLength(2);
    for (const event of cache) {
      expect(event.rawCostNanoUsd).toBeNull();
      expect(event.costStatus).toBe("not_billable");
    }

    // Exactly one row still carries the whole call's cost.
    expect(events.filter((event) => event.rawCostNanoUsd !== null)).toHaveLength(1);
  });

  /**
   * `not_billable` is a statement about provider cost, never about whether a
   * customer may be charged. Thinking tokens are informational because the
   * provider already counted them inside output; cache is billed separately at
   * 0.1x and 1.25x input, so a rate card must be able to reach it.
   */
  it("keeps the cache SKUs rateable, unlike thinking tokens", () => {
    expect(NON_CHARGEABLE_SKUS).toContain("anthropic_thinking_tokens");
    expect(NON_CHARGEABLE_SKUS).not.toContain("anthropic_cache_read_tokens");
    expect(NON_CHARGEABLE_SKUS).not.toContain("anthropic_cache_write_tokens");
  });

  /**
   * A cache breakpoint that was never used reports zero, and every operation
   * but an agent turn has none. A zero-quantity row on every AI call would be
   * noise, not a measurement.
   */
  it("emits nothing for a call that used no cache", () => {
    for (const value of [null, 0] as const) {
      const events = projectAiUsage(
        aiRow({ cache_read_input_tokens: value, cache_creation_input_tokens: value }),
      );
      expect(events.some((event) => event.sku.startsWith("anthropic_cache_"))).toBe(false);
    }
  });

  /**
   * The other half of the same guarantee: pricing a field that is absent must
   * not move a number that was already right. Every operation before agentic
   * execution is a single request with no cache breakpoint, so its columns are
   * null and its arithmetic has to stay byte-identical — a cost book whose
   * history moves when a column is added is not a cost book.
   */
  it("leaves a call without cache tokens priced exactly as before", () => {
    const events = projectAiUsage(aiRow({ cache_read_input_tokens: null, cache_creation_input_tokens: null }));
    expect(events[0].rawCostNanoUsd).toBe(80_000_000);
  });

  /**
   * The whole cost rides on exactly one SKU, so summing billing usage
   * reproduces the provider ledger rather than a multiple of it.
   */
  it("attributes the call's cost once, never per SKU", () => {
    const events = projectAiUsage(aiRow());
    const costed = events.filter((event) => event.costStatus === "costed");
    expect(costed).toHaveLength(1);
    expect(events.filter((event) => event.rawCostNanoUsd !== null)).toHaveLength(1);
  });

  /**
   * Effective dating is respected: history is priced as it was priced then.
   *
   * The row's own `created_at` is what `costForAiRow` resolves against, never
   * the wall clock — which is what makes this projection safe to re-run after a
   * price book changes. It used to be demonstrated with the Sonnet 5 step on
   * 2026-09-01; that step was cancelled (ADR 0062), so the property is now
   * shown against the only window boundary left in the book: Haiku 4.5's own
   * opening instant.
   */
  it("prices a call at the rate in force when it happened, not now", () => {
    const haiku = { model: "claude-haiku-4-5-20251001" };

    const inside = projectAiUsage(aiRow({ ...haiku, created_at: "2026-08-14T18:00:00.000Z" }));
    const before = projectAiUsage(aiRow({ ...haiku, created_at: "2025-09-15T18:00:00.000Z" }));

    // 20,000 × $1/MTok + 4,000 × $5/MTok.
    expect(inside[0].rawCostNanoUsd).toBe(40_000_000);
    expect(inside[0].providerPricingVersion).toBe("claude-haiku-4-5-2025-10");

    // Before the model had a price at all — reported as unrated, never as free.
    expect(before[0].costStatus).toBe("rate_unavailable");
    expect(before[0].rawCostNanoUsd).toBeNull();
  });

  /**
   * Historical safety across the cancelled 2026-09-01 Sonnet step.
   *
   * This projection **recomputes** cost from `MODEL_PRICING` rather than reading
   * `provider_cost_usd`, so correcting the price book is exactly the operation
   * that could silently re-rate settled history. It cannot here, and this is
   * where that is asserted: a row either side of the instant that used to be a
   * 50% step now prices identically, under the same version.
   */
  it("does not re-rate anything across the cancelled September step", () => {
    const before = projectAiUsage(aiRow({ created_at: "2026-08-31T23:59:59.999Z" }));
    const after = projectAiUsage(aiRow({ created_at: "2026-09-01T00:00:00.000Z" }));

    // 20,000 × $2/MTok + 4,000 × $10/MTok, on both sides.
    expect(before[0].rawCostNanoUsd).toBe(80_000_000);
    expect(after[0].rawCostNanoUsd).toBe(80_000_000);
    expect(after[0].providerPricingVersion).toBe(before[0].providerPricingVersion);
    expect(before[0].providerPricingVersion).toBe("claude-sonnet-5-introductory-2026");
  });

  /**
   * §52 — a model with no configured price is `rate_unavailable`, and
   * critically **not** a cost of zero.
   */
  it("marks an unpriced model rate_unavailable rather than free", () => {
    const events = projectAiUsage(aiRow({ model: "some-unpriced-model" }));
    expect(events[0].costStatus).toBe("rate_unavailable");
    expect(events[0].rawCostNanoUsd).toBeNull();
  });

  /**
   * The one case where zero is honest: a call that failed before any tokens
   * were billed. It is still `not_billable` rather than `costed` at zero, so
   * it can never be mistaken for a priced call that happened to be free.
   */
  it("treats a call with no billed tokens as not_billable, not as a zero price", () => {
    const events = projectAiUsage(
      aiRow({ input_tokens: null, output_tokens: null, thinking_tokens: null, status: "failed" }),
    );
    expect(events).toHaveLength(0);
  });
});

describe("stored cost parsing", () => {
  /** Exact string parsing, because a float round-trip would defeat the point. */
  it("converts the ledger's decimal string to exact nanodollars", () => {
    expect(storedCostToNanoUsd("0.080000000")).toBe(80_000_000);
    expect(storedCostToNanoUsd("0.000000001")).toBe(1);
    expect(storedCostToNanoUsd("1.500000000")).toBe(1_500_000_000);
    expect(storedCostToNanoUsd(null)).toBeNull();
  });

  it("round-trips a recomputed cost back to the stored representation", () => {
    const row = aiRow({ provider_cost_usd: "0.080000000" });
    const events = projectAiUsage(row);
    expect(events[0].rawCostNanoUsd).toBe(storedCostToNanoUsd(row.provider_cost_usd));
  });
});

/** §41 — browser cost is unknown, and stays unknown. */
describe("browser usage", () => {
  it("records Deep Scan duration with an unknown cost, never zero", () => {
    const events = projectDeepScanUsage(
      { id: "scan-1", project_id: "project-1", duration_ms: 42_000, created_at: "2026-08-14T00:00:00Z" },
      { userId: "user-1" },
    );

    expect(events[0].sku).toBe("browser_duration_ms");
    expect(events[0].quantity).toBe(42_000);
    expect(events[0].costStatus).toBe("cost_unknown");
    expect(events[0].rawCostNanoUsd).toBeNull();
  });

  it("records visual-review browser duration the same way", () => {
    const events = projectReviewBrowserUsage({
      id: "review-1",
      user_id: "user-1",
      project_id: "project-1",
      provider: "browserbase",
      duration_ms: 15_000,
      created_at: "2026-08-14T00:00:00Z",
    });
    expect(events[0].costStatus).toBe("cost_unknown");
  });
});

/** §42 — measure what Vercel reports; invent nothing it does not. */
describe("sandbox usage", () => {
  function sandboxRow(overrides: Partial<SandboxUsageRow> = {}): SandboxUsageRow {
    return {
      id: "sandbox-1",
      user_id: "user-1",
      project_id: "project-1",
      provider: "vercel",
      sandbox_duration_ms: 285_000,
      active_cpu_ms: 41_000,
      network_ingress_bytes: 1_200_000,
      network_egress_bytes: 340_000,
      provider_cost_usd: null,
      created_at: "2026-08-14T00:00:00Z",
      ...overrides,
    };
  }

  it("emits one event per measured unit", () => {
    const events = projectSandboxUsage(sandboxRow());
    expect(events.map((event) => event.sku)).toEqual([
      "sandbox_duration_ms",
      "sandbox_active_cpu_ms",
      "sandbox_ingress_bytes",
      "sandbox_egress_bytes",
    ]);
  });

  /**
   * A null column produces no event at all. "We did not measure this" and
   * "this was zero" are different facts and only one is safe to sum.
   */
  it("omits an unmeasured column rather than recording zero", () => {
    const events = projectSandboxUsage(sandboxRow({ active_cpu_ms: null, network_egress_bytes: null }));
    expect(events.map((event) => event.sku)).toEqual(["sandbox_duration_ms", "sandbox_ingress_bytes"]);
  });

  it("keeps cost unknown when the provider reports none", () => {
    const events = projectSandboxUsage(sandboxRow());
    expect(events[0].costStatus).toBe("cost_unknown");
    expect(events.every((event) => event.rawCostNanoUsd === null)).toBe(true);
  });
});

/**
 * §18, §70 — the summary keeps known and unknown apart.
 *
 * There is deliberately no single "total cost", because adding a known figure
 * to an unknown one and reporting the known figure is a measurement-shaped
 * lie.
 */
describe("cost summary", () => {
  it("never folds unknown cost into the known total", () => {
    const usage = [
      ...projectAiUsage(aiRow()),
      ...projectDeepScanUsage(
        { id: "scan-1", project_id: "project-1", duration_ms: 42_000, created_at: "2026-08-14T00:00:00Z" },
        { userId: "user-1" },
      ),
    ];

    const summary = summarizeCost(usage);
    expect(summary.knownCostNanoUsd).toBe(80_000_000);
    expect(summary.costedEvents).toBe(1);
    expect(summary.unknownCostEvents).toBe(1);
  });
});

/**
 * The end-to-end shadow answer for a real audit, as Core 1 actually reports
 * it: measured, costed, and explicitly not rated.
 */
describe("shadow rating of a real-shaped audit", () => {
  it("costs the call but reports Credits as not configured", () => {
    const usage = projectAiUsage(aiRow());
    const rating = rateUsage(usage);

    expect(summarizeCost(usage).knownCostNanoUsd).toBe(80_000_000);
    expect(rating.status).toBe("rate_card_not_configured");
    expect(rating.credits).toBeNull();
  });
});
