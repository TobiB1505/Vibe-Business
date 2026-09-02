/**
 * Costs that are allowed to be unknown (Sprint 0049).
 *
 * ## Why this type exists rather than `number | null`
 *
 * Because the interesting question about Vibe's unit economics is not "what did
 * this cost" but "which parts of that number are real". Model spend is measured
 * to the nanodollar and reconciles exactly against the provider price book.
 * Sandbox time is not, and never will be: `provider_cost_usd` is null in every
 * row Vibe has ever written, because Vercel reports no attributable per-sandbox
 * amount.
 *
 * *(2026-09-02, ADR 0073: what changed is not the provider's silence but Vibe's
 * evidence. `VERCEL_SANDBOX_RATES` has been founder-attested and verified since
 * 2026-08-20, so a figure is now **derived** at write time into
 * `sandbox_usage_events.estimated_cost_nano_usd`, under its own `cost_estimated`
 * status. The distinction this file exists for is what makes that safe: it is an
 * `estimated`, it is stored apart from the provider's column, and a sum can
 * still be taken over measurements alone. Sprint 0053's sentence — "no price was
 * ever supplied" — was true when written and is not now.)*
 *
 * A `number | null` would let a caller write `cost ?? 0`, and a zero silently
 * standing in for "we do not know" is precisely how a business talks itself into
 * a margin it does not have. So absence carries a reason, and a total that
 * contains an absence cannot be rendered as a number at all.
 *
 * ## Measured, estimated, unknown
 *
 * Three states, deliberately not two:
 *
 * - `measured` — a provider told us, and it is recorded.
 * - `estimated` — computed from a measured quantity and a rate **the caller
 *   supplied explicitly**. No rate is defaulted anywhere in this module.
 * - unknown — the quantity exists but no rate does, or the quantity was never
 *   recorded. Both name themselves.
 */

export const COST_BASES = ["measured", "estimated"] as const;
export type CostBasis = (typeof COST_BASES)[number];

export const UNKNOWN_COST_REASONS = [
  /** The quantity is recorded, but no price exists for it anywhere in Vibe. */
  "no_price_available",
  /** The quantity itself was never recorded for this run. */
  "not_measured",
  /** The stage did not happen, so there is nothing to price. */
  "stage_not_run",
] as const;
export type UnknownCostReason = (typeof UNKNOWN_COST_REASONS)[number];

export type CostAmount =
  | { known: true; nanoUsd: number; basis: CostBasis }
  | { known: false; reason: UnknownCostReason };

export function measured(nanoUsd: number): CostAmount {
  return { known: true, nanoUsd, basis: "measured" };
}

export function estimated(nanoUsd: number): CostAmount {
  return { known: true, nanoUsd, basis: "estimated" };
}

export function unknown(reason: UnknownCostReason): CostAmount {
  return { known: false, reason };
}

/**
 * A total that refuses to hide what it is missing.
 *
 * `knownFloorNanoUsd` is the sum of the components that *are* known, and it is
 * named a floor rather than a total because that is what it is: the true cost is
 * this plus an unpriced remainder. A reader who sees `complete: false` and a
 * floor of $0.25 knows both that $0.25 was really spent and that the number is
 * not the answer.
 *
 * `missing` names the components rather than counting them, so a later reader
 * can tell "we never measured the sandbox" apart from "we measured it and have
 * no price", which are different problems with different fixes.
 */
export type CostTotal = {
  complete: boolean;
  knownFloorNanoUsd: number;
  /** Component labels whose cost could not be resolved, in input order. */
  missing: readonly string[];
  /** Why each missing component is missing. */
  missingReasons: Readonly<Record<string, UnknownCostReason>>;
};

export function sumCosts(components: readonly (readonly [string, CostAmount])[]): CostTotal {
  let knownFloorNanoUsd = 0;
  const missing: string[] = [];
  const missingReasons: Record<string, UnknownCostReason> = {};

  for (const [label, amount] of components) {
    if (amount.known) {
      knownFloorNanoUsd += amount.nanoUsd;
      continue;
    }

    // A stage that did not run is not a gap in our knowledge — there is
    // genuinely nothing to price, and counting it as missing would make every
    // unvalidated change look under-measured.
    if (amount.reason === "stage_not_run") continue;

    missing.push(label);
    missingReasons[label] = amount.reason;
  }

  return { complete: missing.length === 0, knownFloorNanoUsd, missing, missingReasons };
}

/** Nanodollars to a display string. Integer arithmetic in, formatting out. */
export function formatNanoUsd(nanoUsd: number, fractionDigits = 4): string {
  return `$${(nanoUsd / 1e9).toFixed(fractionDigits)}`;
}
