import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { normalizeSubscription } from "./normalize";

/**
 * Stripe SDK object -> `NormalizedSubscription` (BILLING CORE-2 §29, §33).
 *
 * ## Why this file exists
 *
 * `normalizeSubscription` was never exercised against a realistic raw Stripe
 * object — every other test in this module builds a `NormalizedSubscription`
 * directly and starts downstream of this function. That gap is exactly what
 * let a real bug reach production: the Customer Portal cancelled a live
 * subscription by setting `cancel_at` to the period end timestamp, while
 * `cancel_at_period_end` stayed `false` for the entire event. The billing
 * page kept showing "Renews on..." for a subscription Stripe itself had
 * already scheduled to end, because this function read only the boolean.
 *
 * The fixture below is the real webhook payload for that cancellation
 * (`evt_1U5l54Rvj6TDqUcpIIYLQM6n`, trimmed to the fields this function
 * reads), not an invented shape.
 */

function fakeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_1U5kZWRvj6TDqUcp4YKNIctu",
    customer: "cus_V5wEkySpmS781q",
    status: "active",
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    items: {
      object: "list",
      data: [
        {
          price: { id: "price_1U5bwBRvj6TDqUcpb5YHMXaP" },
          current_period_start: 1787050124,
          current_period_end: 1789728524,
        },
      ],
    },
    metadata: { vibe_sku: "builder", vibe_user_id: "bc494e6e-d052-4ea0-92c0-9c19e1ea279a" },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe("normalizeSubscription", () => {
  it("reads a plain renewing subscription as not ending", () => {
    const normalized = normalizeSubscription(fakeSubscription());
    expect(normalized.cancelAtPeriodEnd).toBe(false);
  });

  it("reads the boolean cancellation as ending", () => {
    const normalized = normalizeSubscription(fakeSubscription({ cancel_at_period_end: true }));
    expect(normalized.cancelAtPeriodEnd).toBe(true);
  });

  /**
   * The bug, pinned. `evt_1U5l54Rvj6TDqUcpIIYLQM6n`'s `previous_attributes`
   * showed `cancel_at` moving from `null` to the period end and
   * `cancel_at_period_end` not appearing at all — it never changed, and it
   * was `false` throughout. A subscription cancelled this way must still
   * read as ending.
   */
  it("reads a cancel_at timestamp as ending, even though cancel_at_period_end stays false", () => {
    const normalized = normalizeSubscription(
      fakeSubscription({ cancel_at: 1789728524, cancel_at_period_end: false, canceled_at: 1787052081 }),
    );
    expect(normalized.cancelAtPeriodEnd).toBe(true);
  });

  it("still reports the current period from the subscription item", () => {
    const normalized = normalizeSubscription(fakeSubscription());
    expect(normalized.currentPeriodStart).toBe(1787050124);
    expect(normalized.currentPeriodEnd).toBe(1789728524);
  });
});
