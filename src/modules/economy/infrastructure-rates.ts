/**
 * Infrastructure list prices, versioned (Sprint 0050, attestation Sprint 0051b).
 *
 * ## Why this is not `ai/pricing.ts`
 *
 * Same discipline, different provider. `ai/pricing.ts` is Vibe's record of what
 * Anthropic bills, and it is trustworthy because the application's own ledger
 * reconciles against it exactly. This file is the same idea for compute — and
 * it started *less* trusted than that, because nothing reconciled against it.
 *
 * ## Provenance is a field, not a comment
 *
 * `sourceKind` names *how* a figure came to be trusted, and three sprints of
 * trying settled that "this session fetched and checked it" was never going to
 * be how these figures got confirmed — `vercel.com` is blocked by the
 * container's egress proxy, and the Vercel documentation-search tool returns
 * the pricing page's worked examples but never its price table.
 *
 * Two things that are *not* this file's confirmation, tried and rejected in
 * order:
 *
 * - The same operator-supplied numbers restated in a later prompt. Repetition
 *   of the same input through a different channel is not a second source.
 * - A screenshot of a different AI assistant claiming to have browsed the
 *   pricing page. Unfalsifiable from here — no way to tell a real fetch from a
 *   recollection that happens to match — and still not a primary source.
 *
 * What *is* accepted: **`founder_attested`** — Vibe's own founder, the person
 * who carries commercial accountability for what this file claims Vibe's
 * infrastructure costs, explicitly confirmed these five figures by name. That
 * is not a technical verification and the type says so; it is the same kind of
 * human sign-off `credits/rating.ts` already requires before a Credit rate can
 * exist at all ("a rate card is commercial policy, it is reviewed"). A founder
 * attesting to an infrastructure cost is exactly that authority, applied one
 * layer down.
 *
 * `attestedBy` and `attestedAt` are required together with this source kind —
 * an attestation with no author or date is not one.
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
  /**
   * Explicitly confirmed by Vibe's founder, by name and date — commercial
   * sign-off, not a technical fetch. See the module doc for why this is
   * accepted and a screenshot of another AI's claim was not.
   */
  "founder_attested",
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
  /**
   * True once the figures are considered fit to rely on — by an independent
   * technical fetch (`official_public_pricing`) or by a named founder's
   * sign-off (`founder_attested`). Never true for `operator_supplied` alone.
   */
  verified: boolean;
  /** Who attested, when `sourceKind` is `founder_attested`. */
  attestedBy: string | null;
  /** When they attested. Required together with `attestedBy`. */
  attestedAt: string | null;
  /** Why verification did not happen, or what it consisted of. */
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
   * vCPU"), which *was* reachable — so unlike the prices, this one was already
   * verified before the founder's attestation.
   */
  gbRamPerVcpu: number;
};

/**
 * The rate card in force.
 *
 * `$0.128` per CPU-hour, `$0.0212` per GB-hour, `$0.60` per million sandbox
 * creations, `$0.15` per GB egress, `$0.08` per GB-month of snapshot storage —
 * unchanged from Sprint 0050. Only the provenance changed: the founder
 * confirmed these five figures directly on 2026-08-20, after three failed
 * attempts across two sprints to reach the primary source from this
 * environment.
 */
export const VERCEL_SANDBOX_RATES: InfrastructureRateCard = {
  provider: "vercel_sandbox",
  pricingVersion: "vercel-sandbox-2026-08-20",
  observedAt: "2026-08-20",
  currency: "USD",
  source: "https://vercel.com/pricing",
  sourceKind: "founder_attested",
  verified: true,
  attestedBy: "founder",
  attestedAt: "2026-08-20",
  verificationNote:
    "Confirmed directly by Vibe's founder on 2026-08-20. This session's own attempts to reach the primary source failed: vercel.com is blocked by this environment's egress proxy, and the Vercel docs-search tool returns the pricing page's worked examples but never its price table. A separate claim that a different AI assistant had browsed the page was not accepted as confirmation — unfalsifiable from here, and not a primary source.",

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
