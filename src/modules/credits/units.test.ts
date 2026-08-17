import { describe, expect, it } from "vitest";
import {
  addCredits,
  CREDIT_UNITS_PER_CREDIT,
  CreditPrecisionError,
  creditsToUnits,
  creditUnits,
  formatCreditUnits,
  subtractCredits,
  sumCredits,
  ZERO_CREDITS,
} from "./units";

/**
 * Exact credit arithmetic (BILLING CORE-1 §7).
 *
 * The rule being defended: no floating-point value ever becomes financial
 * authority. These tests exist because the failure they prevent is silent —
 * a balance that is off by a fraction of a unit looks correct in every log
 * and only surfaces as an accounting discrepancy months later.
 */

/*
 * Each guard is asserted by its *message*, not merely by the error type.
 *
 * Found by mutation testing: deleting the integer check entirely left this
 * suite green, because `Number.isSafeInteger(1.5)` is also false and the
 * range guard threw instead — the same error class, via the wrong rule, with
 * a misleading message ("exceeds exact integer range" for 1.5). Asserting the
 * type alone proved only that *something* rejected it.
 */
describe("exactness", () => {
  it("rejects a fractional unit count rather than rounding it", () => {
    expect(() => creditUnits(1.5)).toThrow(CreditPrecisionError);
    expect(() => creditUnits(1.5)).toThrow(/whole number of credit units/);
  });

  it("rejects non-finite values", () => {
    expect(() => creditUnits(Number.NaN)).toThrow(/must be finite/);
    expect(() => creditUnits(Number.POSITIVE_INFINITY)).toThrow(/must be finite/);
  });

  it("rejects magnitudes beyond exact integer range", () => {
    expect(() => creditUnits(Number.MAX_SAFE_INTEGER + 2)).toThrow(/exact integer range/);
  });

  /**
   * The canonical float failure, asserted directly: 0.1 + 0.2 must not be
   * able to enter the ledger.
   */
  it("refuses the classic 0.1 + 0.2 value", () => {
    expect(() => creditsToUnits(0.1 + 0.2)).not.toThrow();
    // 0.30000000000000004 * 1000 rounds to exactly 300 units — the point is
    // that the *stored* value is the integer 300, never the float.
    expect(creditsToUnits(0.1 + 0.2)).toBe(300);
    expect(Number.isInteger(creditsToUnits(0.1 + 0.2))).toBe(true);
  });

  it("accepts a fraction that lands exactly on a subunit boundary", () => {
    expect(creditsToUnits(0.5)).toBe(500);
    expect(creditsToUnits(1)).toBe(CREDIT_UNITS_PER_CREDIT);
    expect(creditsToUnits(0.001)).toBe(1);
  });

  it("rejects a fraction finer than the subunit", () => {
    expect(() => creditsToUnits(0.0001)).toThrow(CreditPrecisionError);
  });

  /** Negative zero is meaningless for money and must not survive construction. */
  it("normalizes negative zero", () => {
    expect(Object.is(creditUnits(-0), 0)).toBe(true);
    expect(Object.is(subtractCredits(creditUnits(5), creditUnits(5)), 0)).toBe(true);
  });
});

describe("arithmetic", () => {
  it("adds, subtracts and sums exactly", () => {
    expect(addCredits(creditUnits(700), creditUnits(300))).toBe(1000);
    expect(subtractCredits(creditUnits(700), creditUnits(300))).toBe(400);
    expect(sumCredits([creditUnits(1), creditUnits(2), creditUnits(3)])).toBe(6);
    expect(sumCredits([])).toBe(ZERO_CREDITS);
  });

  it("permits a negative result, because a charge is negative", () => {
    expect(subtractCredits(ZERO_CREDITS, creditUnits(450))).toBe(-450);
  });

  /**
   * Aggregating many tiny amounts must not accumulate error — the future
   * agent case, where one run produces dozens of small usage events.
   */
  it("sums a thousand small amounts with no drift", () => {
    const many = Array.from({ length: 1000 }, () => creditUnits(1));
    expect(sumCredits(many)).toBe(1000);
  });
});

describe("display", () => {
  it("renders whole credits without decimals and fractions trimmed", () => {
    expect(formatCreditUnits(creditUnits(2000))).toBe("2");
    expect(formatCreditUnits(creditUnits(1500))).toBe("1.5");
    expect(formatCreditUnits(creditUnits(1))).toBe("0.001");
    expect(formatCreditUnits(ZERO_CREDITS)).toBe("0");
  });

  it("preserves the sign of a refund or charge", () => {
    expect(formatCreditUnits(creditUnits(-1500))).toBe("-1.5");
  });
});
