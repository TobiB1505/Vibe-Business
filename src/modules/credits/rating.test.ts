import { describe, expect, it } from "vitest";
import {
  CREDIT_RATE_CARDS,
  rateUsage,
  resolveRateCard,
  roundToCreditUnits,
  type CreditRateCard,
} from "./rating";
import type { BillableUsage, UsageSku } from "./schema";

/**
 * Credit rating (BILLING CORE-1 §52, §53, §54, §67).
 *
 * Three separate claims are pinned here, and each has a distinct way of going
 * wrong:
 *
 *  - **Unknown is not zero.** A usage row Vibe cannot price must not rate to
 *    "free". Three of Vibe's four provider ledgers store a null cost by
 *    policy, so this is the common case, not the edge case.
 *  - **History does not move.** A charge rated under v1 stays rated under v1
 *    after v2 activates, forever.
 *  - **Fragmentation is not a price increase.** Splitting one operation into
 *    many small usage events must not cost a customer more.
 *
 * Every rate card in this file is a fixture. `CREDIT_RATE_CARDS` — the
 * production registry — is asserted empty, because it is (§67).
 */

/** An obviously-named fixture. Never added to the production registry. */
const TEST_CARD_V1: CreditRateCard = {
  version: "test-rate-card-v1",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveTo: "2026-06-01T00:00:00.000Z",
  lines: [
    { sku: "anthropic_input_tokens", creditUnitsPerUnit: 0.01 },
    { sku: "anthropic_output_tokens", creditUnitsPerUnit: 0.05 },
  ],
};

const TEST_CARD_V2: CreditRateCard = {
  version: "test-rate-card-v2",
  effectiveFrom: "2026-06-01T00:00:00.000Z",
  effectiveTo: null,
  lines: [
    { sku: "anthropic_input_tokens", creditUnitsPerUnit: 0.02 },
    { sku: "anthropic_output_tokens", creditUnitsPerUnit: 0.1 },
  ],
};

const CARDS = [TEST_CARD_V1, TEST_CARD_V2];

function usage(sku: UsageSku, quantity: number, overrides: Partial<BillableUsage> = {}): BillableUsage {
  return {
    sourceKind: "ai_usage_event",
    sourceId: `src-${sku}-${quantity}`,
    operationRunId: null,
    projectId: "project-1",
    userId: "user-1",
    provider: "anthropic",
    sku,
    quantity,
    occurredAt: "2026-03-01T00:00:00.000Z",
    rawCostNanoUsd: 1_000,
    costStatus: "costed",
    providerPricingVersion: "claude-sonnet-5-introductory-2026",
    ...overrides,
  };
}

/** §6, §67 — the state of the product, asserted rather than assumed. */
describe("production rate cards", () => {
  it("has no approved production Credit rate configured", () => {
    expect(CREDIT_RATE_CARDS).toHaveLength(0);
  });

  it("rates real usage as rate_card_not_configured, never as zero credits", () => {
    const result = rateUsage([usage("anthropic_input_tokens", 10_000)]);

    expect(result.status).toBe("rate_card_not_configured");
    // The critical assertion: null, not 0. A caller that coalesced this to
    // zero would be inventing a free operation.
    expect(result.credits).toBeNull();
    expect(result.rateCardVersion).toBeNull();
  });
});

describe("effective dating", () => {
  it("resolves the card in force at an instant", () => {
    expect(resolveRateCard(new Date("2026-03-01T00:00:00Z"), CARDS)?.version).toBe("test-rate-card-v1");
    expect(resolveRateCard(new Date("2026-09-01T00:00:00Z"), CARDS)?.version).toBe("test-rate-card-v2");
  });

  /** Half-open `[from, to)`, identical to `resolvePricing` in ai/pricing.ts. */
  it("gives a boundary instant to the newer card", () => {
    expect(resolveRateCard(new Date("2026-06-01T00:00:00.000Z"), CARDS)?.version).toBe("test-rate-card-v2");
    expect(resolveRateCard(new Date("2026-05-31T23:59:59.999Z"), CARDS)?.version).toBe("test-rate-card-v1");
  });

  it("returns null before any card is in force", () => {
    expect(resolveRateCard(new Date("2025-01-01T00:00:00Z"), CARDS)).toBeNull();
  });
});

/**
 * §53 — the immutability claim.
 *
 * The mechanism is that a rating carries its `rateCardVersion` and a stored
 * charge keeps it. Re-reading a historical charge must never consult today's
 * card, and this test proves the rating function itself is a pure function of
 * the instant it is given.
 */
describe("historical ratings never move", () => {
  it("re-rating an August usage under a September card still yields the August answer", () => {
    const august = new Date("2026-03-01T00:00:00Z");
    const events = [usage("anthropic_input_tokens", 10_000), usage("anthropic_output_tokens", 2_000)];

    // 10_000 * 0.01 + 2_000 * 0.05 = 100 + 100 = 200
    const first = rateUsage(events, { at: august, cards: CARDS });
    expect(first.status).toBe("rated");
    expect(first.credits).toBe(200);
    expect(first.rateCardVersion).toBe("test-rate-card-v1");

    // v2 is now in force and prices the same usage at double.
    const underV2 = rateUsage(events, { at: new Date("2026-09-01T00:00:00Z"), cards: CARDS });
    expect(underV2.credits).toBe(400);
    expect(underV2.rateCardVersion).toBe("test-rate-card-v2");

    // Re-reading the historical instant is unchanged — 420-style immutability.
    const reread = rateUsage(events, { at: august, cards: CARDS });
    expect(reread.credits).toBe(200);
    expect(reread.rateCardVersion).toBe("test-rate-card-v1");
  });
});

/** §54 — deterministic aggregate-then-round. */
describe("rounding", () => {
  it("rounds half away from zero, symmetrically", () => {
    expect(roundToCreditUnits(0.5)).toBe(1);
    expect(roundToCreditUnits(1.5)).toBe(2);
    expect(roundToCreditUnits(-0.5)).toBe(-1);
    expect(roundToCreditUnits(2.4)).toBe(2);
  });

  it("is deterministic — the same input yields the same result every time", () => {
    const events = Array.from({ length: 37 }, (_, index) =>
      usage("anthropic_input_tokens", 7 + index, { sourceId: `src-${index}` }),
    );
    const runs = Array.from({ length: 5 }, () => rateUsage(events, { card: TEST_CARD_V1 }).credits);
    expect(new Set(runs).size).toBe(1);
  });

  /**
   * The anti-fragmentation guarantee, and the reason rounding is not applied
   * per event. 100 events of 7 tokens each rate identically to one event of
   * 700 tokens; rounding each would have charged 100 units instead of 7.
   */
  it("does not overcharge when one operation is split into many tiny events", () => {
    const fragmented = Array.from({ length: 100 }, (_, index) =>
      usage("anthropic_input_tokens", 7, { sourceId: `frag-${index}` }),
    );
    const single = [usage("anthropic_input_tokens", 700)];

    const fragmentedTotal = rateUsage(fragmented, { card: TEST_CARD_V1 }).credits;
    const singleTotal = rateUsage(single, { card: TEST_CARD_V1 }).credits;

    expect(fragmentedTotal).toBe(singleTotal);
    // 700 * 0.01 = 7 credit units, not 100.
    expect(fragmentedTotal).toBe(7);
  });
});

describe("what is and is not chargeable", () => {
  /**
   * Thinking tokens are inside the provider's output count already. Rating
   * them separately would charge reasoning twice.
   */
  it("never prices thinking tokens separately", () => {
    const withThinking = rateUsage(
      [usage("anthropic_output_tokens", 2_000), usage("anthropic_thinking_tokens", 1_500)],
      { card: TEST_CARD_V1 },
    );
    const withoutThinking = rateUsage([usage("anthropic_output_tokens", 2_000)], { card: TEST_CARD_V1 });

    expect(withThinking.credits).toBe(withoutThinking.credits);
    expect(withThinking.status).toBe("rated");
  });

  /**
   * §52 — a SKU the card does not price refuses the whole rating rather than
   * quietly rating the half it understands. Silently omitting the sandbox
   * portion of a run is the error that is hardest to notice.
   */
  it("refuses to partially rate when a present SKU has no priced line", () => {
    const result = rateUsage(
      [usage("anthropic_input_tokens", 10_000), usage("sandbox_active_cpu_ms", 285_000)],
      { card: TEST_CARD_V1 },
    );

    expect(result.status).toBe("sku_not_priced");
    expect(result.credits).toBeNull();
    expect(result.unpricedSkus).toEqual(["sandbox_active_cpu_ms"]);
  });

  it("rates an empty usage set to zero rather than refusing", () => {
    const result = rateUsage([], { card: TEST_CARD_V1 });
    expect(result.status).toBe("rated");
    expect(result.credits).toBe(0);
  });
});
