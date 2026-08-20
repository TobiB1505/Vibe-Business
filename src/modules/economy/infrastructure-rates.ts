/**
 * Infrastructure list prices, versioned (Sprint 0050).
 *
 * ## Why this is not `ai/pricing.ts`
 *
 * Same discipline, different provider. `ai/pricing.ts` is Vibe's record of what
 * Anthropic bills, and it is trustworthy because the application's own ledger
 * reconciles against it exactly. This file is the same idea for compute — and
 * it is deliberately *less* trusted, because nothing reconciles against it yet.
 *
 * ## Provenance is a field, not a comment
 *
 * `sourceKind` is required, and the value below is **`operator_supplied`**, not
 * `official_public_pricing`. That is the honest label:
 *
 * - The figures were given by the operator on 2026-08-20 as Vercel's documented
 *   public rates.
 * - They could **not** be independently verified from this environment.
 *   `vercel.com` is blocked by the container's egress proxy, and the Vercel
 *   documentation-search tool returns the pricing page's worked examples but
 *   not its price table.
 *
 * So the numbers are used, the cost derived from them is labelled `estimated`
 * rather than `measured`, and the unverified status travels with every figure
 * this file produces. Confirming them against the live pricing page is a real
 * task, not a formality — see ECONOMY_MODEL.md.
 *
 * ## Integer nanodollars
 *
 * Same reason `credits/units.ts` and `ai/pricing.ts` do it: a float
 * multiplication chain across CPU-hours, GB-hours and byte counts accumulates
 * error that eventually shows up in a ledger. Every rate below is an integer
 * number of nanodollars per whole provider unit.
 */

export const RATE_SOURCE_KINDS = [
  /** Read from the provider's published price table and verified here. */
  "official_public_pricing",
  /** Supplied by an operator; not independently verified from this environment. */
  "operator_supplied",
] as const;
export type RateSourceKind = (typeof RATE_SOURCE_KINDS)[number];

export type InfrastructureRateCard = {
  provider: "vercel_sandbox";
  pricingVersion: string;
  /** When the figures were stated. Not when they became effective. */
  observedAt: string;
  currency: "USD";
  source: string;
  sourceKind: RateSourceKind;
  /** True only when this environment confirmed the figures against the source. */
  verified: boolean;
  /** Why verification did not happen, when it did not. */
  verificationNote: string | null;

  activeCpuNanoUsdPerCpuHour: number;
  memoryNanoUsdPerGbHour: number;
  creationNanoUsd: number;
  outboundNetworkNanoUsdPerGb: number;
  snapshotStorageNanoUsdPerGbMonth: number;

  /**
   * RAM per vCPU, in GB. A provider allocation rule rather than a price, and it
   * lives here because memory cost cannot be derived without it.
   *
   * Confirmed from Vercel's own documentation ("Ensure memory is 2,048 MB per
   * vCPU"), which *was* reachable — so unlike the prices, this one is verified.
   */
  gbRamPerVcpu: number;
};

/**
 * The rate card in force.
 *
 * `$0.128` per CPU-hour, `$0.0212` per GB-hour, `$0.60` per million sandbox
 * creations, `$0.15` per GB egress, `$0.08` per GB-month of snapshot storage.
 */
export const VERCEL_SANDBOX_RATES: InfrastructureRateCard = {
  provider: "vercel_sandbox",
  pricingVersion: "vercel-sandbox-2026-08-20",
  observedAt: "2026-08-20",
  currency: "USD",
  source: "https://vercel.com/docs/sandbox/pricing",
  sourceKind: "operator_supplied",
  verified: false,
  verificationNote:
    "vercel.com is blocked by this environment's egress proxy; the Vercel docs-search tool returns the pricing page's worked examples but not its price table. Figures are the operator's, dated 2026-08-20.",

  activeCpuNanoUsdPerCpuHour: 128_000_000, // $0.128
  memoryNanoUsdPerGbHour: 21_200_000, // $0.0212
  creationNanoUsd: 600, // $0.60 per 1,000,000
  outboundNetworkNanoUsdPerGb: 150_000_000, // $0.15
  snapshotStorageNanoUsdPerGbMonth: 80_000_000, // $0.08

  gbRamPerVcpu: 2,
};

export const INFRASTRUCTURE_RATE_CARDS: readonly InfrastructureRateCard[] = [
  VERCEL_SANDBOX_RATES,
];

/**
 * The card a stored analysis was computed under.
 *
 * Looked up by version, never by "the current one". A price change must not
 * silently restate a historical result — the same rule `validation_identity`
 * enforces for validation semantics, applied to money.
 */
export function rateCardByVersion(version: string): InfrastructureRateCard | null {
  return INFRASTRUCTURE_RATE_CARDS.find((card) => card.pricingVersion === version) ?? null;
}

/* ---------------------------------------------------------------------------
 * What this rate card is not
 * ------------------------------------------------------------------------ */

/**
 * Vercel Pro includes a monthly usage allowance, and it is deliberately absent
 * from this file.
 *
 * Netting plan credits against a run would make the first runs of each month
 * appear free, which is not a fact about a run — it is a fact about an invoice.
 * Unit economics need the **marginal list price** of the resources a run
 * consumed, so that is what this models.
 *
 * The distinction is `resourceCost` (here) versus
 * `actualInvoiceAfterPlanCredits` (account level, not modelled anywhere in
 * Vibe). Keeping them apart is the difference between "this run cost us $0.06"
 * and "this run happened to fall inside an allowance we had already paid for".
 */
export const PLAN_CREDITS_ARE_NOT_MODELLED = true;
