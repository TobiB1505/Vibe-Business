/**
 * The Vibe Credit unit (BILLING CORE-1 §3, §7).
 *
 * ## What a Credit is, and what it is deliberately not
 *
 * A Vibe Credit is the **customer-facing** economic unit. It is not an
 * Anthropic token, not a dollar, and not a fixed multiple of either. That
 * separation is the whole point: a future operation may combine inference,
 * sandbox compute and browser time in one run, and Vibe may change model or
 * provider without changing what a customer thinks they are buying
 * (PRODUCT.md §12 — "Credits must **not** be directly equated with underlying
 * provider tokens").
 *
 * ## Why an integer subunit
 *
 * Balances are financial authority, so they are never floating point. The same
 * reasoning `ai/pricing.ts` already applies to provider cost — it computes in
 * whole nanodollars and only renders a decimal at the very end — applies here
 * one layer up. `0.1 + 0.2` must never be able to appear in a balance.
 *
 * One displayed Credit is {@link CREDIT_UNITS_PER_CREDIT} internal **credit
 * units**. The subunit exists because rating a single cheap operation may
 * legitimately land below one whole Credit: Product Understanding runs on
 * Haiku inside the free onboarding flow, and a rating system that could only
 * express whole Credits would have to round it to 0 (understating) or 1
 * (overstating by a large multiple). Three decimal places is enough to rate
 * every operation Vibe currently performs without either distortion.
 *
 * Everything in this file is integer-only. A value that cannot be represented
 * exactly is a programming error and throws rather than silently rounding.
 */

/**
 * Internal units per displayed Credit.
 *
 * 1000 — three decimal places. Chosen against real measured cost rather than
 * as a round number: the cheapest current operation is a Haiku product
 * understanding run, and the most expensive a Sonnet audit, and this subunit
 * separates them cleanly whatever conversion rate is eventually chosen.
 */
export const CREDIT_UNITS_PER_CREDIT = 1_000;

/**
 * An exact quantity of Credits, in integer internal units.
 *
 * A branded number rather than a bare one, so a raw provider token count or a
 * nanodollar figure cannot be passed where Credits are expected. The brand is
 * erased at runtime — this costs nothing and catches the one class of mistake
 * that would be invisible in review.
 */
export type CreditUnits = number & { readonly __brand: "CreditUnits" };

export class CreditPrecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditPrecisionError";
  }
}

/** Asserts a value is a safe, exact integer before it becomes financial authority. */
function assertExactInteger(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new CreditPrecisionError(`${what} must be finite, received ${value}.`);
  }
  if (!Number.isInteger(value)) {
    throw new CreditPrecisionError(`${what} must be a whole number of credit units, received ${value}.`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new CreditPrecisionError(`${what} exceeds exact integer range, received ${value}.`);
  }
}

/**
 * Builds credit units from an integer count of units. Throws on anything inexact.
 *
 * Normalizes negative zero to zero. `-0` arises naturally from negating a
 * zero charge, is a valid JS number that passes every integer check, and then
 * fails `Object.is(-0, 0)` and serializes inconsistently — a distinction that
 * is meaningless for money and would eventually be mistaken for a real one.
 */
export function creditUnits(units: number): CreditUnits {
  assertExactInteger(units, "credit units");
  return (units === 0 ? 0 : units) as CreditUnits;
}

export const ZERO_CREDITS: CreditUnits = 0 as CreditUnits;

/**
 * Converts whole displayed Credits to internal units.
 *
 * Accepts a fractional Credit figure only when it lands exactly on a subunit
 * boundary — `0.5` is fine, `0.0001` is not, and the difference throws rather
 * than quietly truncating someone's money.
 */
export function creditsToUnits(credits: number): CreditUnits {
  if (!Number.isFinite(credits)) {
    throw new CreditPrecisionError(`credits must be finite, received ${credits}.`);
  }
  // Multiply and round to the nearest unit first, then prove the rounding
  // changed nothing. Comparing `credits * N` to its own rounding directly
  // would fail on values like 0.29 that are inexact in binary floating point
  // yet perfectly representable as units.
  const scaled = Math.round(credits * CREDIT_UNITS_PER_CREDIT);
  if (Math.abs(credits * CREDIT_UNITS_PER_CREDIT - scaled) > 1e-6) {
    throw new CreditPrecisionError(
      `${credits} credits cannot be represented exactly in units of 1/${CREDIT_UNITS_PER_CREDIT}.`,
    );
  }
  return creditUnits(scaled);
}

export function addCredits(a: CreditUnits, b: CreditUnits): CreditUnits {
  return creditUnits(a + b);
}

export function subtractCredits(a: CreditUnits, b: CreditUnits): CreditUnits {
  return creditUnits(a - b);
}

export function sumCredits(values: readonly CreditUnits[]): CreditUnits {
  return values.reduce<CreditUnits>((total, value) => addCredits(total, value), ZERO_CREDITS);
}

/**
 * Renders credit units for display, e.g. `1500` → `"1.5"`.
 *
 * Presentation only. Never parse this back into authority — the integer is the
 * money, the string is a label. Trailing zeros are trimmed so a whole Credit
 * reads `"2"` rather than `"2.000"`, and the sign is preserved so a refund
 * renders correctly.
 */
export function formatCreditUnits(units: CreditUnits): string {
  const negative = units < 0;
  const magnitude = Math.abs(units);
  const whole = Math.trunc(magnitude / CREDIT_UNITS_PER_CREDIT);
  const fraction = magnitude % CREDIT_UNITS_PER_CREDIT;

  const body =
    fraction === 0
      ? String(whole)
      : `${whole}.${String(fraction).padStart(3, "0").replace(/0+$/, "")}`;

  return negative ? `-${body}` : body;
}
