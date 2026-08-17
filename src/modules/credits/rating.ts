import {
  NON_CHARGEABLE_SKUS,
  type BillableUsage,
  type RatingStatus,
  type UsageRating,
  type UsageSku,
} from "./schema";
import { creditUnits, type CreditUnits, ZERO_CREDITS } from "./units";

/**
 * Credit rating (BILLING CORE-1 §6, §20, §21, §22, §24).
 *
 * ## Two price layers, deliberately not bound together
 *
 * ```
 * provider cost   what Vibe pays Anthropic/Vercel/Browserbase   ai/pricing.ts
 * credit rate     what a customer is charged in Credits         this file
 * ```
 *
 * They move independently on purpose. Anthropic raising its Sonnet price on
 * 1 September (which `MODEL_PRICING` already encodes) must not silently
 * re-price every customer, and a change to Vibe's commercial policy must not
 * require touching provider cost. Both are effective-dated, and neither is
 * allowed to reach back in time.
 *
 * ## Why this lives in code rather than a table
 *
 * Exactly the reasoning `ai/pricing.ts` records for provider prices, applied
 * one layer up. A rate card is commercial policy, it is reviewed, and it must
 * be diffable — a table row edited in a SQL console has no review and no
 * history. It also makes the current state *structural*: {@link CREDIT_RATE_CARDS}
 * is empty, so "no production Credit rate exists" is something the type system
 * and the tests can see, not a fact about which rows someone happened to insert.
 *
 * ## The current state, stated plainly
 *
 * There is **no approved production Credit rate**. `ARCHITECTURE.md §3.11`
 * records it as an open decision and `PRODUCT.md §12.1` forbids inventing one
 * ("No price is shown, no balance is invented"). So rating returns
 * `rate_card_not_configured` for real usage, and the registry below stays
 * empty until a commercial decision fills it. Tests supply their own fixture
 * cards; a fixture must never be added here.
 */

/** What one SKU costs, in credit units per single provider unit. */
export type CreditRateLine = {
  sku: UsageSku;
  /**
   * Credit units per **one** provider unit — per token, per millisecond, per
   * byte. Fractional on purpose: a token can legitimately be worth a tiny
   * fraction of a credit unit, and rounding is applied once at the end of an
   * aggregation rather than here (§24).
   */
  creditUnitsPerUnit: number;
};

/**
 * A versioned, effective-dated Credit policy.
 *
 * Mirrors `ModelPricing` in `ai/pricing.ts` field for field, including the
 * half-open `[effectiveFrom, effectiveTo)` interval, so the two layers behave
 * identically at a boundary instant and neither can develop its own subtly
 * different date semantics.
 */
export type CreditRateCard = {
  version: string;
  /** Inclusive ISO instant. */
  effectiveFrom: string;
  /** Exclusive ISO instant; null means "current". */
  effectiveTo: string | null;
  lines: readonly CreditRateLine[];
};

/**
 * Every approved production Credit rate card.
 *
 * **Deliberately empty.** Adding an entry here is a commercial decision, not an
 * implementation detail — it is the moment Vibe starts charging customers, and
 * it requires an approved conversion rate that does not exist yet. A test
 * fixture must never be added to this array; tests pass their own card to
 * {@link rateUsage} instead.
 */
export const CREDIT_RATE_CARDS: readonly CreditRateCard[] = [];

/**
 * The card in force at an instant, or null when none is (§21).
 *
 * Half-open interval, matching `resolvePricing`: an instant exactly on a
 * boundary belongs to the newer card.
 */
export function resolveRateCard(
  at: Date = new Date(),
  cards: readonly CreditRateCard[] = CREDIT_RATE_CARDS,
): CreditRateCard | null {
  const timestamp = at.getTime();

  for (const card of cards) {
    const from = Date.parse(card.effectiveFrom);
    const to = card.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(card.effectiveTo);
    if (timestamp >= from && timestamp < to) return card;
  }

  return null;
}

/**
 * The rounding rule, defined exactly once (§24).
 *
 * ## Aggregate, then round — never round per event
 *
 * A future agent run produces many small usage events: several inference
 * turns, a sandbox build, a repair loop. Rounding each one up to a whole credit
 * unit would systematically overcharge a customer in direct proportion to how
 * finely Vibe happens to have split its own work, which is both unfair and
 * completely invisible to them. So fractional credit units accumulate exactly
 * and rounding happens once, at the end.
 *
 * ## Half-up, and why not banker's rounding
 *
 * Half-up is what a person checking the arithmetic by hand expects. Banker's
 * rounding is better for large statistical aggregates and worse for a single
 * customer-visible number that someone may recompute themselves.
 *
 * Rounding is toward zero-magnitude-preserving on negatives so a refund of the
 * same fractional amount as a charge returns exactly what was taken.
 */
export function roundToCreditUnits(exact: number): CreditUnits {
  if (!Number.isFinite(exact)) {
    throw new TypeError(`Cannot round a non-finite credit amount: ${exact}.`);
  }
  const rounded = exact < 0 ? -Math.round(-exact) : Math.round(exact);
  return creditUnits(rounded);
}

/** A rated line, kept so a report can show which SKU contributed what. */
export type RatedLine = {
  sku: UsageSku;
  quantity: number;
  /** Exact, unrounded contribution in credit units. */
  exactCreditUnits: number;
};

export type RatingBreakdown = {
  status: RatingStatus;
  credits: CreditUnits | null;
  rateCardVersion: string | null;
  lines: RatedLine[];
  /** SKUs present in the usage that the card prices no line for. */
  unpricedSkus: UsageSku[];
};

/**
 * Rates a set of usage into Credits under one policy version (§21, §23).
 *
 * Takes the whole set rather than one event because that is what makes
 * aggregate-then-round meaningful (§24, §63): every usage event belonging to
 * one economic operation rates together, so a run split across six provider
 * calls costs the same as the identical work done in one.
 *
 * Never partially rates. If any SKU present has no priced line, the result is
 * `sku_not_priced` with a null Credit amount — because a customer charge that
 * silently omitted the sandbox half of a run would be wrong in the direction
 * that is hardest to notice.
 */
export function rateUsage(
  usage: readonly BillableUsage[],
  options: { at?: Date; cards?: readonly CreditRateCard[]; card?: CreditRateCard } = {},
): RatingBreakdown {
  const card =
    options.card ?? resolveRateCard(options.at ?? new Date(), options.cards ?? CREDIT_RATE_CARDS);

  if (!card) {
    // The honest Core 1 answer. Not zero credits, not free — unrated.
    return {
      status: "rate_card_not_configured",
      credits: null,
      rateCardVersion: null,
      lines: [],
      unpricedSkus: [],
    };
  }

  const priced = new Map(card.lines.map((line) => [line.sku, line.creditUnitsPerUnit]));
  const lines: RatedLine[] = [];
  const unpricedSkus: UsageSku[] = [];
  let exactTotal = 0;

  for (const event of usage) {
    // Informational SKUs are skipped rather than treated as unpriced: thinking
    // tokens are already inside the output count, so pricing them would double
    // charge and refusing to rate because of them would block every run.
    if (NON_CHARGEABLE_SKUS.includes(event.sku)) continue;

    const rate = priced.get(event.sku);
    if (rate === undefined) {
      if (!unpricedSkus.includes(event.sku)) unpricedSkus.push(event.sku);
      continue;
    }

    const exact = event.quantity * rate;
    exactTotal += exact;
    lines.push({ sku: event.sku, quantity: event.quantity, exactCreditUnits: exact });
  }

  if (unpricedSkus.length > 0) {
    return { status: "sku_not_priced", credits: null, rateCardVersion: card.version, lines, unpricedSkus };
  }

  return {
    status: "rated",
    // One rounding, applied to the aggregate.
    credits: lines.length === 0 ? ZERO_CREDITS : roundToCreditUnits(exactTotal),
    rateCardVersion: card.version,
    lines,
    unpricedSkus: [],
  };
}

/** The narrow result shape stored beside a usage row or a charge. */
export function toUsageRating(breakdown: RatingBreakdown): UsageRating {
  return {
    status: breakdown.status,
    credits: breakdown.credits,
    rateCardVersion: breakdown.rateCardVersion,
  };
}
