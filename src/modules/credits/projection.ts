import { calculateProviderCost, UnpricedModelError } from "@/modules/ai/pricing";
import type { BillableUsage, CostStatus, UsageSku } from "./schema";

/**
 * Provider-neutral usage projection (BILLING CORE-1 §16, §37, §38–§42).
 *
 * Pure functions. Each takes a row as one of Vibe's canonical provider ledgers
 * already stores it and returns normalized {@link BillableUsage} — no database,
 * no clock, no provider SDK, so every projection rule is a unit test.
 *
 * ## Why projection rather than a second ledger
 *
 * `ai_usage_events`, `deep_scan_provider_usage`, `sandbox_usage_events` and
 * `review_browser_usage` each stay authoritative for their own domain. Billing
 * references them by `(source_kind, source_id)` and never copies their token
 * counts as a second source of truth. That reference is also the idempotency
 * key: `billing_usage_events_source_sku_idx` makes one source row project to at
 * most one event per SKU, which is what lets reconciliation run twice.
 *
 * ## The rule every projector below obeys
 *
 * **A cost Vibe does not know is `cost_unknown`, never zero.** Three of the
 * four ledgers store `provider_cost_usd` as null on purpose — Browserbase and
 * Vercel do not return an attributable price, and the existing code refuses to
 * derive one from a public rate card. Billing carries that forward rather than
 * quietly turning "we don't know" into "it was free".
 */

/** One AI usage row, in the shape `ai_usage_events` stores it. */
export type AiUsageRow = {
  id: string;
  user_id: string;
  project_id: string;
  operation: string;
  provider: string;
  model: string;
  job_id: string | null;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  thinking_tokens: number | null;
  /**
   * Cache tokens, as `20260818210000_agent_execution.sql` added them and
   * `ai/usage.ts` writes them. Null for every single-request operation, which
   * is every operation that is not an agent turn.
   */
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  provider_cost_usd: string | number | null;
  pricing_version: string | null;
  created_at: string;
};

/** Nanodollars per USD, matching the integer arithmetic in `ai/pricing.ts`. */
const NANO_USD_PER_USD = 1_000_000_000;

/**
 * Recomputes provider cost from token counts using the authoritative module.
 *
 * Deliberately **recomputed rather than read** from `provider_cost_usd`, then
 * reconciled against the stored value by the caller (§69). The stored figure is
 * a decimal string in a `numeric(18,9)` column; parsing it back into a float
 * would reintroduce exactly the imprecision `pricing.ts` exists to avoid. The
 * recomputation runs at the row's own `created_at`, so an effective-dated price
 * change does not re-price history.
 *
 * Recomputing means the *same* inputs `recordAIUsage` priced, cache tokens
 * included. Pricing from input and output alone made every agent turn disagree
 * with the ledger by its whole cache bill — 234 of the live ledger's 314 rows
 * — and §69 correctly reported each one as a semantic mismatch.
 */
function costForAiRow(row: AiUsageRow): {
  rawCostNanoUsd: number | null;
  costStatus: CostStatus;
  pricingVersion: string | null;
} {
  // A call that failed before any tokens were billed genuinely cost nothing,
  // and `recordAIUsage` records that by omitting the token counts entirely.
  // This is the one case where zero is the honest answer — and it is
  // `not_billable`, not `costed`, so it can never be confused with a price.
  if (row.input_tokens === null && row.output_tokens === null) {
    return { rawCostNanoUsd: null, costStatus: "not_billable", pricingVersion: null };
  }

  try {
    const cost = calculateProviderCost({
      model: row.model,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      // Passed for the same reason `recordAIUsage` passes them: the provider
      // bills cache reads and writes separately from the uncached input, so a
      // recomputation that omits them is not the same number. Null columns
      // default to zero inside `calculateProviderCost`, which is why a
      // pre-agent row's arithmetic is unchanged by this.
      cacheReadInputTokens: row.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: row.cache_creation_input_tokens ?? 0,
      at: new Date(row.created_at),
    });
    return {
      rawCostNanoUsd: cost.totalNanoUsd,
      costStatus: "costed",
      pricingVersion: cost.pricingVersion,
    };
  } catch (error) {
    // A model with no configured price is a real gap, and saying so is the
    // point. Returning zero here would make an unpriced model look free.
    if (error instanceof UnpricedModelError) {
      return { rawCostNanoUsd: null, costStatus: "rate_unavailable", pricingVersion: null };
    }
    throw error;
  }
}

/**
 * Splits one AI usage row into per-SKU billable usage (§17, §62).
 *
 * The row becomes up to five events — input, output, thinking, cache read and
 * cache write — because the billing model is per-SKU and a future rate card may
 * price them differently, as every provider already does.
 *
 * ## Where the cost lands, and why only once
 *
 * `calculateProviderCost` returns one figure for the whole call. Attributing
 * the input portion to the input SKU and the output portion to the output SKU
 * would be inventing a split the pricing module does not expose. So the whole
 * cost is attached to the **input** row and the others carry `not_billable` —
 * the total per source row is therefore exactly the provider cost, never a
 * multiple of it.
 *
 * ## What §69 requires, and where it is currently untrue
 *
 * §69 asks that summing `raw_cost_nano_usd` across billing usage reproduce the
 * AI ledger exactly. **It does not, at HEAD.** Measured against production on
 * 2026-09-04: `ai_usage_events` sums to $10.9079 and its `input_tokens`
 * projections to $8.0194 — a gap of $2.8885, 26% of all inference recorded.
 *
 * The arithmetic here is not the problem: Haiku matches to the cent, and so
 * does every Sonnet 5 row outside 19–21 August 2026. The whole gap is 250 rows
 * from those three days — the only ones carrying cache tokens — projected in a
 * single reconciliation pass on 2026-08-22 by a `calculateProviderCost` that
 * did not price cache yet. 6,623,638 cache-read tokens at 0.1× and 625,520
 * cache-write at 1.25× come to $2.88, which is the gap.
 *
 * Those rows cannot be corrected in place. `projectUsageEvents` upserts with
 * `ignoreDuplicates: true` on `(source_kind, source_id, sku)`, so re-projection
 * is a no-op on a row that exists — the same property described above as what
 * lets reconciliation run twice.
 *
 * Nothing reads them yet: `listUsageForOperation` is this table's only reader
 * and has no caller, and every row is `rate_card_not_configured` because
 * `CREDIT_RATE_CARDS` is empty. So the discrepancy is inert **until per-operation
 * rating ships**, and that is the moment it stops being inert. Recorded in
 * `docs/ROADMAP.md` rather than repaired, because how a projection is superseded
 * belongs with the decision that first depends on one.
 */
export function projectAiUsage(
  row: AiUsageRow,
  options: { operationRunId?: string | null } = {},
): BillableUsage[] {
  const { rawCostNanoUsd, costStatus, pricingVersion } = costForAiRow(row);

  const base = {
    sourceKind: "ai_usage_event" as const,
    sourceId: row.id,
    operationRunId: options.operationRunId ?? null,
    projectId: row.project_id,
    userId: row.user_id,
    provider: row.provider,
    occurredAt: row.created_at,
    providerPricingVersion: null as string | null,
  };

  const events: BillableUsage[] = [];

  if (row.input_tokens !== null) {
    events.push({
      ...base,
      sku: "anthropic_input_tokens",
      quantity: row.input_tokens,
      // The call's whole cost rides here, once.
      rawCostNanoUsd,
      costStatus,
      providerPricingVersion: pricingVersion,
    });
  }

  if (row.output_tokens !== null) {
    events.push({
      ...base,
      sku: "anthropic_output_tokens",
      quantity: row.output_tokens,
      rawCostNanoUsd: null,
      // Measured, and its cost is already counted on the input row.
      costStatus: "not_billable",
      providerPricingVersion: pricingVersion,
    });
  }

  if (row.thinking_tokens !== null && row.thinking_tokens > 0) {
    events.push({
      ...base,
      sku: "anthropic_thinking_tokens",
      quantity: row.thinking_tokens,
      rawCostNanoUsd: null,
      // Already inside the output count the provider billed for.
      costStatus: "not_billable",
      providerPricingVersion: pricingVersion,
    });
  }

  // Emitted only when non-zero, like thinking and for the same reason: every
  // operation without a cache breakpoint reports zero, and a zero-quantity row
  // on every AI call would be noise rather than a measurement.
  //
  // `not_billable` is about *provider cost* and nothing else — the cache price
  // is already inside the one figure on the input row above. It says nothing
  // about whether a customer can be charged: these SKUs are absent from
  // `NON_CHARGEABLE_SKUS` precisely so a rate card can price them.
  const cacheQuantities = [
    ["anthropic_cache_read_tokens", row.cache_read_input_tokens],
    ["anthropic_cache_write_tokens", row.cache_creation_input_tokens],
  ] as const;

  for (const [sku, quantity] of cacheQuantities) {
    if (quantity === null || quantity <= 0) continue;
    events.push({
      ...base,
      sku,
      quantity,
      rawCostNanoUsd: null,
      costStatus: "not_billable",
      providerPricingVersion: pricingVersion,
    });
  }

  return events;
}

/**
 * The provider cost the AI ledger recorded, in nanodollars, for reconciliation.
 *
 * Parses the stored decimal via string manipulation rather than `parseFloat`,
 * so a value like `0.000042000` converts exactly. This is only ever used to
 * *compare* against a recomputed figure (§69) — never as an input to a charge.
 */
export function storedCostToNanoUsd(value: string | number | null): number | null {
  if (value === null) return null;

  const text = typeof value === "number" ? value.toFixed(9) : value.trim();
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = body.split(".");

  const nano = Number(whole) * NANO_USD_PER_USD + Number(fraction.padEnd(9, "0").slice(0, 9));
  return negative ? -nano : nano;
}

/** One Deep Scan browser usage row, as `deep_scan_provider_usage` stores it. */
export type DeepScanUsageRow = {
  id: string;
  project_id: string;
  duration_ms: number;
  created_at: string;
  /**
   * Which browser produced the measurement.
   *
   * Read from the row rather than assumed. It was assumed — a literal
   * `"browserbase"` — and after ADR 0076 that would have filed every scan run
   * in Vibe's own sandbox under a provider Vibe no longer uses, in the ledger
   * every price is derived from.
   */
  provider: string;
  /** Vibe's own derivation, when the session reported dimensions (ADR 0076). */
  estimated_cost_nano_usd?: number | null;
  cost_pricing_version?: string | null;
};

/**
 * Projects Deep Scan browser time (§41).
 *
 * The cost is unknown, and until ADR 0076 that was the state of the world
 * rather than a gap: Browserbase did not return a price with a session, and
 * `buildDeepScanUsage` pins `providerCostUsd: null` as a literal type so no
 * code path can invent one.
 *
 * It is no longer either, for a session Vibe's own sandbox ran. Termination
 * reports the dimensions, `VERCEL_SANDBOX_RATES` has been founder-attested
 * since 2026-08-20, and `estimateSandboxCost` derives the figure — the same
 * function, the same rate card and the same `cost_estimated` status the agent's
 * sandboxes use, so the two can be summed together and neither is mistaken for
 * a bill.
 *
 * A row with no estimate still says `cost_unknown`, and that stays the honest
 * answer for the seven Browserbase rows and for any session that never came up.
 * Nothing is backfilled: deriving a Vercel figure for a scan Browserbase ran
 * would date an estimate to a provider that did not run it.
 */
export function projectDeepScanUsage(
  row: DeepScanUsageRow,
  owner: { userId: string },
): BillableUsage[] {
  // No provider ever states a price here, so there is no stored figure to
  // prefer over the estimate — unlike `projectSandboxUsage`, where the order
  // between the two is the point.
  const estimated = row.estimated_cost_nano_usd ?? null;

  return [
    {
      sourceKind: "deep_scan_provider_usage",
      sourceId: row.id,
      operationRunId: null,
      projectId: row.project_id,
      userId: owner.userId,
      provider: row.provider,
      sku: "browser_duration_ms",
      quantity: row.duration_ms,
      occurredAt: row.created_at,
      rawCostNanoUsd: estimated,
      costStatus: estimated !== null ? "cost_estimated" : "cost_unknown",
      providerPricingVersion: estimated !== null ? (row.cost_pricing_version ?? null) : null,
    },
  ];
}

/** One sandbox usage row, as `sandbox_usage_events` stores it. */
export type SandboxUsageRow = {
  id: string;
  user_id: string;
  project_id: string;
  provider: string;
  sandbox_duration_ms: number | null;
  active_cpu_ms: number | null;
  network_ingress_bytes: number | null;
  network_egress_bytes: number | null;
  provider_cost_usd: string | number | null;
  /** Vibe's own derivation, when the dimensions allowed one (ADR 0073). */
  estimated_cost_nano_usd?: number | null;
  cost_pricing_version?: string | null;
  created_at: string;
};

/**
 * Projects sandbox compute (§42).
 *
 * Every measurable unit Vercel actually reports becomes its own SKU, and a
 * column that is null produces no event at all rather than an event of zero —
 * "we did not measure this" and "this was zero" are different facts, and only
 * one of them is safe to sum.
 *
 * Cost is `cost_unknown` unless the provider genuinely reported one. Vercel
 * currently does not, and no rate is derived from a public price list.
 */
export function projectSandboxUsage(row: SandboxUsageRow): BillableUsage[] {
  /*
   * The provider's own figure first, and Vibe's derivation only in its absence
   * (ADR 0073).
   *
   * The order is the whole point rather than a fallback convenience: a price
   * the provider stated is better evidence than one Vibe computed, so a row
   * that ever gains a real `provider_cost_usd` stops using the estimate without
   * anybody having to remember to. `cost_estimated` keeps the two apart in the
   * ledger, so a sum can be taken over measurements alone.
   */
  const stored = storedCostToNanoUsd(row.provider_cost_usd);
  const estimated = stored === null ? (row.estimated_cost_nano_usd ?? null) : null;

  const rawCost = stored ?? estimated;
  const costStatus: CostStatus =
    stored !== null ? "costed" : estimated !== null ? "cost_estimated" : "cost_unknown";

  const measurements: [UsageSku, number | null][] = [
    ["sandbox_duration_ms", row.sandbox_duration_ms],
    ["sandbox_active_cpu_ms", row.active_cpu_ms],
    ["sandbox_ingress_bytes", row.network_ingress_bytes],
    ["sandbox_egress_bytes", row.network_egress_bytes],
  ];

  const present = measurements.filter(([, quantity]) => quantity !== null);

  return present.map(([sku, quantity], index) => ({
    sourceKind: "sandbox_usage_event" as const,
    sourceId: row.id,
    operationRunId: null,
    projectId: row.project_id,
    userId: row.user_id,
    provider: row.provider,
    sku,
    quantity: quantity ?? 0,
    occurredAt: row.created_at,
    // As with AI, any known cost rides on exactly one of the row's SKUs so a
    // sum over billing usage equals the provider ledger rather than a multiple.
    rawCostNanoUsd: index === 0 ? rawCost : null,
    costStatus: index === 0 ? costStatus : "not_billable",
    // Names the rate card an estimate was computed under, so a later price
    // change cannot silently restate a historical row. Null for a provider
    // figure, which carries its own provenance by being the provider's.
    providerPricingVersion:
      index === 0 ? (estimated === null ? null : (row.cost_pricing_version ?? null)) : null,
  }));
}

/** One visual-review browser usage row, as `review_browser_usage` stores it. */
export type ReviewBrowserUsageRow = {
  id: string;
  user_id: string;
  project_id: string;
  provider: string;
  duration_ms: number;
  created_at: string;
};

/** Projects visual-review browser time. Cost unknown, same as Deep Scan (§41). */
export function projectReviewBrowserUsage(row: ReviewBrowserUsageRow): BillableUsage[] {
  return [
    {
      sourceKind: "review_browser_usage",
      sourceId: row.id,
      operationRunId: null,
      projectId: row.project_id,
      userId: row.user_id,
      provider: row.provider,
      sku: "browser_duration_ms",
      quantity: row.duration_ms,
      occurredAt: row.created_at,
      rawCostNanoUsd: null,
      costStatus: "cost_unknown",
      providerPricingVersion: null,
    },
  ];
}

/**
 * Totals that keep known and unknown apart (§18, §70).
 *
 * There is deliberately no single "total cost" figure. Adding a known
 * $0.047 to an unknown browser session and reporting $0.047 would be a
 * measurement-shaped lie, so the caller gets both numbers and the count of
 * things Vibe cannot price.
 */
export type CostSummary = {
  knownCostNanoUsd: number;
  costedEvents: number;
  unknownCostEvents: number;
  rateUnavailableEvents: number;
  notBillableEvents: number;
};

export function summarizeCost(usage: readonly BillableUsage[]): CostSummary {
  const summary: CostSummary = {
    knownCostNanoUsd: 0,
    costedEvents: 0,
    unknownCostEvents: 0,
    rateUnavailableEvents: 0,
    notBillableEvents: 0,
  };

  for (const event of usage) {
    switch (event.costStatus) {
      case "costed":
        summary.knownCostNanoUsd += event.rawCostNanoUsd ?? 0;
        summary.costedEvents += 1;
        break;
      case "cost_unknown":
        summary.unknownCostEvents += 1;
        break;
      case "rate_unavailable":
        summary.rateUnavailableEvents += 1;
        break;
      case "not_billable":
        summary.notBillableEvents += 1;
        break;
    }
  }

  return summary;
}
