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
   * The whole cost rides on exactly one SKU, so summing billing usage
   * reproduces the provider ledger rather than a multiple of it.
   */
  it("attributes the call's cost once, never per SKU", () => {
    const events = projectAiUsage(aiRow());
    const costed = events.filter((event) => event.costStatus === "costed");
    expect(costed).toHaveLength(1);
    expect(events.filter((event) => event.rawCostNanoUsd !== null)).toHaveLength(1);
  });

  /** Effective dating is respected: history is priced as it was priced then. */
  it("prices an old call at the rate in force when it happened", () => {
    const introductory = projectAiUsage(aiRow({ created_at: "2026-08-14T18:00:00.000Z" }));
    const standard = projectAiUsage(aiRow({ created_at: "2026-09-02T18:00:00.000Z" }));

    // $2→$3 in, $10→$15 out on 1 September.
    expect(introductory[0].rawCostNanoUsd).toBe(80_000_000);
    expect(standard[0].rawCostNanoUsd).toBe(120_000_000);
    expect(introductory[0].providerPricingVersion).not.toBe(standard[0].providerPricingVersion);
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
