import { describe, expect, it } from "vitest";
import { creditsToUnits } from "@/modules/credits/units";
import {
  VIBE_SKU_METADATA_KEY,
  VIBE_USER_METADATA_KEY,
  interpretStripeEvent,
  type CatalogPriceIds,
  type NormalizedStripeEvent,
} from "./events";

/**
 * What a verified Stripe event is allowed to mean (BILLING CORE-2 §71, §72,
 * §102).
 *
 * Every adversarial case in §102 that a payment provider could carry is here:
 * a replayed grant, a proration event, a forged Price id, a fabricated Credit
 * amount, and a Checkout return standing in for a payment. They are testable
 * exhaustively precisely because this layer is pure — reproducing them against
 * a live Stripe account would be slow, flaky, and in several cases impossible.
 */

const PRICES: CatalogPriceIds = {
  builder: "price_builder_monthly",
  pro: "price_pro_monthly",
  pack_500: "price_pack_500",
  pack_1500: "price_pack_1500",
  pack_5000: "price_pack_5000",
};

function checkoutEvent(overrides: Partial<NonNullable<NormalizedStripeEvent["checkoutSession"]>> = {}): NormalizedStripeEvent {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    livemode: false,
    checkoutSession: {
      id: "cs_test_1",
      mode: "payment",
      paymentStatus: "paid",
      customerId: "cus_1",
      subscriptionId: null,
      metadata: { [VIBE_SKU_METADATA_KEY]: "pack_500", [VIBE_USER_METADATA_KEY]: "user-1" },
      priceIds: ["price_pack_500"],
      ...overrides,
    },
  };
}

function invoiceEvent(overrides: Partial<NonNullable<NormalizedStripeEvent["invoice"]>> = {}): NormalizedStripeEvent {
  return {
    id: "evt_2",
    type: "invoice.payment_succeeded",
    livemode: false,
    invoice: {
      id: "in_1",
      status: "paid",
      billingReason: "subscription_cycle",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      periodStart: 1_756_684_800,
      periodEnd: 1_759_276_800,
      priceIds: ["price_builder_monthly"],
      subscriptionMetadata: { [VIBE_SKU_METADATA_KEY]: "builder", [VIBE_USER_METADATA_KEY]: "user-1" },
      ...overrides,
    },
  };
}

describe("top-up purchases (§26, §72)", () => {
  it("grants exactly the catalog's Credits for an approved pack", () => {
    const intent = interpretStripeEvent(checkoutEvent(), PRICES);

    expect(intent).toMatchObject({
      kind: "grant_top_up",
      packKey: "pack_500",
      creditUnits: creditsToUnits(500),
      idempotencyKey: "topup-v1:cs_test_1",
      externalReference: "cs_test_1",
    });
  });

  it("produces the same identity every time, so five deliveries grant once", () => {
    // The §72 gate. Replaying the same purchase must resolve to one key; the
    // ledger's unique index does the rest.
    const keys = Array.from({ length: 5 }, () => interpretStripeEvent(checkoutEvent(), PRICES)).map((intent) =>
      intent.kind === "grant_top_up" ? intent.idempotencyKey : null,
    );

    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("topup-v1:cs_test_1");
  });

  it("gives distinct purchases distinct identities", () => {
    const first = interpretStripeEvent(checkoutEvent({ id: "cs_a" }), PRICES);
    const second = interpretStripeEvent(checkoutEvent({ id: "cs_b" }), PRICES);

    expect(first.kind === "grant_top_up" && first.idempotencyKey).not.toBe(
      second.kind === "grant_top_up" && second.idempotencyKey,
    );
  });

  it("grants nothing when the payment has not completed (§25)", () => {
    expect(interpretStripeEvent(checkoutEvent({ paymentStatus: "unpaid" }), PRICES)).toEqual({
      kind: "ignored",
      reason: "payment_not_completed",
    });
  });

  it("grants nothing for a session with no payment required", () => {
    expect(interpretStripeEvent(checkoutEvent({ paymentStatus: "no_payment_required" }), PRICES)).toEqual({
      kind: "ignored",
      reason: "payment_not_completed",
    });
  });
});

describe("a payload cannot decide how many Credits are granted (§23, §102.4, §102.5)", () => {
  it("ignores a fabricated Credit amount carried in metadata", () => {
    /*
     * The browser-changes-500-into-500000 attack. The amount is looked up from
     * Vibe's catalog by SKU; there is no field here that could carry it.
     *
     * The forged values are deliberately chosen so none of them can collide
     * with the correct answer in *either* unit. `creditsToUnits(500)` is
     * 500,000 internal units — so a naive fixture using `credits: "500000"`
     * asserts nothing, because a mutation that trusted the metadata would
     * produce exactly the expected number. A mutation test found precisely
     * that, which is why these values are all far outside the range.
     */
    const intent = interpretStripeEvent(
      checkoutEvent({
        metadata: {
          [VIBE_SKU_METADATA_KEY]: "pack_500",
          [VIBE_USER_METADATA_KEY]: "user-1",
          credits: "987654321",
          creditUnits: "987654321",
          credit_units: "987654321",
          amount: "987654321",
          quantity: "987654321",
        },
      }),
      PRICES,
    );

    expect(intent).toMatchObject({ kind: "grant_top_up", creditUnits: creditsToUnits(500) });
  });

  it("grants the catalog amount for every pack, whatever the metadata claims", () => {
    // Proves the lookup is by SKU rather than incidentally correct for one
    // pack: each SKU yields its own catalog figure while carrying the same
    // fabricated metadata.
    for (const [sku, credits] of [
      ["pack_500", 500],
      ["pack_1500", 1_500],
      ["pack_5000", 5_000],
    ] as const) {
      const intent = interpretStripeEvent(
        checkoutEvent({
          metadata: { [VIBE_SKU_METADATA_KEY]: sku, credits: "987654321" },
          priceIds: [PRICES[sku]!],
        }),
        PRICES,
      );

      expect(intent).toMatchObject({ kind: "grant_top_up", creditUnits: creditsToUnits(credits) });
    }
  });

  it("refuses a forged Price id that does not match the SKU's configured Price", () => {
    // Claims pack_500 but was actually charged the 5,000-Credit Price.
    expect(
      interpretStripeEvent(checkoutEvent({ priceIds: ["price_pack_5000"] }), PRICES),
    ).toEqual({ kind: "ignored", reason: "price_mismatch" });
  });

  it("refuses an entirely unknown Price id", () => {
    expect(
      interpretStripeEvent(checkoutEvent({ priceIds: ["price_attacker_controlled"] }), PRICES),
    ).toEqual({ kind: "ignored", reason: "price_mismatch" });
  });

  it("refuses a SKU that is not in the catalog", () => {
    expect(
      interpretStripeEvent(
        checkoutEvent({ metadata: { [VIBE_SKU_METADATA_KEY]: "pack_1000000" } }),
        PRICES,
      ),
    ).toEqual({ kind: "ignored", reason: "unknown_sku" });
  });

  it("refuses a session carrying no SKU at all", () => {
    expect(interpretStripeEvent(checkoutEvent({ metadata: {} }), PRICES)).toEqual({
      kind: "ignored",
      reason: "unknown_sku",
    });
  });

  it("fails closed when a SKU has no configured Price", () => {
    // "We never set up that SKU" must never read as "any Price is acceptable".
    expect(
      interpretStripeEvent(checkoutEvent(), { ...PRICES, pack_500: undefined }),
    ).toEqual({ kind: "ignored", reason: "price_not_in_catalog" });
  });
});

describe("subscription period grants (§30, §31, §71)", () => {
  it("grants Builder's 1,000 Credits for a paid renewal", () => {
    expect(interpretStripeEvent(invoiceEvent(), PRICES)).toMatchObject({
      kind: "grant_subscription_period",
      planKey: "builder",
      creditUnits: creditsToUnits(1_000),
      idempotencyKey: "subscription-period-v1:in_1",
    });
  });

  it("grants Pro's 3,000 Credits for a paid Pro period", () => {
    expect(
      interpretStripeEvent(
        invoiceEvent({
          priceIds: ["price_pro_monthly"],
          subscriptionMetadata: { [VIBE_SKU_METADATA_KEY]: "pro", [VIBE_USER_METADATA_KEY]: "user-1" },
        }),
        PRICES,
      ),
    ).toMatchObject({ kind: "grant_subscription_period", planKey: "pro", creditUnits: creditsToUnits(3_000) });
  });

  it("grants the first period from subscription_create, not from the Checkout (§31)", () => {
    expect(interpretStripeEvent(invoiceEvent({ billingReason: "subscription_create" }), PRICES)).toMatchObject({
      kind: "grant_subscription_period",
      planKey: "builder",
    });
  });

  it("never grants twice for one paid period, however many times it is delivered (§71)", () => {
    // The §71 gate: five deliveries of the same paid period.
    const keys = Array.from({ length: 5 }, () => interpretStripeEvent(invoiceEvent(), PRICES)).map((intent) =>
      intent.kind === "grant_subscription_period" ? intent.idempotencyKey : null,
    );

    expect(new Set(keys).size).toBe(1);
  });

  it("resolves invoice.paid and invoice.payment_succeeded to the same grant identity", () => {
    // Both events fire for one paid invoice. Handling both is safe only because
    // they collapse to one key.
    const succeeded = interpretStripeEvent(invoiceEvent(), PRICES);
    const paid = interpretStripeEvent({ ...invoiceEvent(), id: "evt_3", type: "invoice.paid" }, PRICES);

    expect(succeeded.kind === "grant_subscription_period" && succeeded.idempotencyKey).toBe(
      paid.kind === "grant_subscription_period" && paid.idempotencyKey,
    );
  });

  it("carries the period this payment bought, for the grant's expiry", () => {
    const intent = interpretStripeEvent(invoiceEvent(), PRICES);

    expect(intent).toMatchObject({ periodStart: 1_756_684_800, periodEnd: 1_759_276_800 });
  });

  it("refuses to grant with no period rather than creating a never-expiring lot", () => {
    expect(interpretStripeEvent(invoiceEvent({ periodEnd: null }), PRICES)).toEqual({
      kind: "ignored",
      reason: "missing_period",
    });
  });

  it("refuses a plan whose charged Price does not match the catalog", () => {
    expect(interpretStripeEvent(invoiceEvent({ priceIds: ["price_pro_monthly"] }), PRICES)).toEqual({
      kind: "ignored",
      reason: "price_mismatch",
    });
  });
});

describe("a failed or unpaid period grants nothing (§32)", () => {
  it("ignores an unpaid invoice", () => {
    expect(interpretStripeEvent(invoiceEvent({ status: "open" }), PRICES)).toEqual({
      kind: "ignored",
      reason: "not_a_paid_period",
    });
  });

  it("ignores an uncollectible invoice", () => {
    expect(interpretStripeEvent(invoiceEvent({ status: "uncollectible" }), PRICES)).toEqual({
      kind: "ignored",
      reason: "not_a_paid_period",
    });
  });

  it("ignores an invoice with no billing reason", () => {
    expect(interpretStripeEvent(invoiceEvent({ billingReason: null }), PRICES)).toEqual({
      kind: "ignored",
      reason: "not_a_paid_period",
    });
  });
});

describe("plan changes cannot mint Credits (§34)", () => {
  it("ignores a proration invoice from a mid-cycle plan change", () => {
    // The §34 gate. A `subscription_update` invoice is a proration, not a paid
    // period — granting on it would invent proportional Credit economics
    // nobody approved.
    expect(interpretStripeEvent(invoiceEvent({ billingReason: "subscription_update" }), PRICES)).toEqual({
      kind: "ignored",
      reason: "proration_or_plan_change",
    });
  });

  it("ignores a manually created invoice", () => {
    expect(interpretStripeEvent(invoiceEvent({ billingReason: "manual" }), PRICES)).toEqual({
      kind: "ignored",
      reason: "proration_or_plan_change",
    });
  });

  it("ignores a threshold invoice", () => {
    expect(interpretStripeEvent(invoiceEvent({ billingReason: "subscription_threshold" }), PRICES)).toEqual({
      kind: "ignored",
      reason: "proration_or_plan_change",
    });
  });
});

describe("subscription status is never a reason to grant (§29)", () => {
  const subscriptionEvent: NormalizedStripeEvent = {
    id: "evt_4",
    type: "customer.subscription.updated",
    livemode: false,
    subscription: {
      id: "sub_1",
      customerId: "cus_1",
      status: "active",
      cancelAtPeriodEnd: false,
      canceledAt: null,
      currentPeriodStart: 1_756_684_800,
      currentPeriodEnd: 1_759_276_800,
      priceIds: ["price_builder_monthly"],
      metadata: { [VIBE_USER_METADATA_KEY]: "user-1" },
    },
  };

  it("syncs a snapshot rather than granting, even when active", () => {
    // A subscription stays `active` for a month. If `active` granted, a
    // customer would receive Credits on every incidental update.
    expect(interpretStripeEvent(subscriptionEvent, PRICES)).toMatchObject({
      kind: "sync_subscription",
      planKey: "builder",
      status: "active",
    });
  });

  it("records a cancellation so future grants stop (§33)", () => {
    expect(
      interpretStripeEvent(
        {
          ...subscriptionEvent,
          type: "customer.subscription.deleted",
          subscription: { ...subscriptionEvent.subscription!, status: "canceled", canceledAt: 1_759_276_800 },
        },
        PRICES,
      ),
    ).toMatchObject({ kind: "sync_subscription", status: "canceled", canceledAt: 1_759_276_800 });
  });

  it("records a scheduled cancellation without ending the current period", () => {
    expect(
      interpretStripeEvent(
        {
          ...subscriptionEvent,
          subscription: { ...subscriptionEvent.subscription!, cancelAtPeriodEnd: true },
        },
        PRICES,
      ),
    ).toMatchObject({ kind: "sync_subscription", status: "active", cancelAtPeriodEnd: true });
  });

  it("names the plan from the charged Price rather than from metadata", () => {
    expect(
      interpretStripeEvent(
        {
          ...subscriptionEvent,
          subscription: { ...subscriptionEvent.subscription!, priceIds: ["price_pro_monthly"] },
        },
        PRICES,
      ),
    ).toMatchObject({ kind: "sync_subscription", planKey: "pro" });
  });
});

describe("a Checkout return is not a payment (§25, §102.16)", () => {
  it("grants nothing for a completed subscription Checkout — the invoice does that", () => {
    // Granting here as well as on the invoice is the classic double-grant: one
    // signup, two allowances.
    expect(
      interpretStripeEvent(checkoutEvent({ mode: "subscription", subscriptionId: "sub_1" }), PRICES),
    ).toEqual({ kind: "ignored", reason: "checkout_subscription_handled_by_invoice" });
  });

  it("grants nothing for a setup-mode session", () => {
    expect(interpretStripeEvent(checkoutEvent({ mode: "setup" }), PRICES)).toEqual({
      kind: "ignored",
      reason: "unhandled_event_type",
    });
  });

  it("ignores event types Vibe has no opinion about", () => {
    for (const type of [
      "payment_intent.succeeded",
      "charge.succeeded",
      "customer.created",
      "invoice.upcoming",
      "payment_method.attached",
    ]) {
      expect(interpretStripeEvent({ id: "evt_x", type, livemode: false }, PRICES)).toEqual({
        kind: "ignored",
        reason: "unhandled_event_type",
      });
    }
  });

  it("ignores a handled event type whose object is missing", () => {
    expect(
      interpretStripeEvent({ id: "evt_x", type: "invoice.payment_succeeded", livemode: false }, PRICES),
    ).toEqual({ kind: "ignored", reason: "unhandled_event_type" });
  });
});
