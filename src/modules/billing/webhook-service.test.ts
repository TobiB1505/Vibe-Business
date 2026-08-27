import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { listActiveLots, listAllLots } from "@/modules/credits/lot-store";
import { getBillingBalance } from "@/modules/credits/service";
import { ensureCreditAccount, listLedgerEntries } from "@/modules/credits/store";
import { creditsToUnits } from "@/modules/credits/units";
import { findActiveSubscription, linkStripeCustomer } from "./store";
import { VIBE_SKU_METADATA_KEY, VIBE_USER_METADATA_KEY, type CatalogPriceIds, type NormalizedStripeEvent } from "./stripe/events";
import { processStripeEvent } from "./webhook-service";

/**
 * Verified Stripe events becoming Credits, end to end
 * (BILLING CORE-2 §71, §72, §28, §32, §33, §34).
 *
 * `events.test.ts` proves what an event *means*; this proves what happens to
 * the ledger when it arrives — including arriving five times. The two halves
 * matter separately: a correct interpretation posted twice is still a double
 * grant.
 *
 * `FakeDatabase` models the unique indexes all three idempotency structures
 * rely on, so "delivered five times, granted once" is enforced here by the same
 * shape Postgres would enforce it by.
 */

const db = { current: new FakeDatabase() };
const supabase = () => fakeSupabase(db.current);

const USER = "11111111-1111-1111-1111-111111111111";
const CUSTOMER = "cus_test_1";

const PRICES: CatalogPriceIds = {
  builder: "price_builder_monthly",
  pro: "price_pro_monthly",
  pack_500: "price_pack_500",
  pack_1500: "price_pack_1500",
  pack_5000: "price_pack_5000",
};

beforeEach(async () => {
  db.current = new FakeDatabase();
  // The ownership mapping Vibe wrote when it created the Stripe customer. This
  // is what turns a payment event into a Vibe user (§24, §65).
  await linkStripeCustomer(supabase(), {
    userId: USER,
    stripeCustomerId: CUSTOMER,
    livemode: false,
  });
});

async function accountId(): Promise<string> {
  const { account } = await ensureCreditAccount(supabase(), USER);
  return account.id;
}

function topUpEvent(id = "evt_topup_1", sessionId = "cs_test_1"): NormalizedStripeEvent {
  return {
    id,
    type: "checkout.session.completed",
    livemode: false,
    checkoutSession: {
      id: sessionId,
      mode: "payment",
      paymentStatus: "paid",
      customerId: CUSTOMER,
      subscriptionId: null,
      metadata: { [VIBE_SKU_METADATA_KEY]: "pack_500", [VIBE_USER_METADATA_KEY]: USER },
      priceIds: ["price_pack_500"],
    },
  };
}

function invoiceEvent(id = "evt_inv_1", invoiceId = "in_test_1"): NormalizedStripeEvent {
  return {
    id,
    type: "invoice.payment_succeeded",
    livemode: false,
    invoice: {
      id: invoiceId,
      status: "paid",
      billingReason: "subscription_cycle",
      customerId: CUSTOMER,
      subscriptionId: "sub_test_1",
      periodStart: 1_756_684_800,
      periodEnd: 1_759_276_800,
      priceIds: ["price_builder_monthly"],
      subscriptionMetadata: { [VIBE_SKU_METADATA_KEY]: "builder", [VIBE_USER_METADATA_KEY]: USER },
    },
  };
}

async function process(event: NormalizedStripeEvent) {
  return processStripeEvent(supabase(), { event, catalogPriceIds: PRICES });
}

describe("top-up purchases (§72)", () => {
  it("grants exactly 500 Credits, with no expiry", async () => {
    expect(await process(topUpEvent())).toMatchObject({ status: "processed" });

    const lots = await listActiveLots(supabase(), await accountId());
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      sourceKind: "purchase",
      initialCreditUnits: creditsToUnits(500),
      // Purchased Credits do not reset monthly.
      expiresAt: null,
    });

    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(500));
  });

  it("grants 500 once when the same event is delivered five times (§72)", async () => {
    // The §72 merge gate. Not 1000, not 1500, not 2500.
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await process(topUpEvent()));

    expect(results[0].status).toBe("processed");
    expect(results.slice(1).every((result) => result.status === "duplicate")).toBe(true);

    expect(await listAllLots(supabase(), await accountId())).toHaveLength(1);
    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(500));
  });

  it("grants once even when Stripe re-sends the purchase under a new event id", async () => {
    // A different event id defeats the event-claim index, so this is the layer
    // underneath it: the grant's own idempotency key is derived from the
    // Checkout Session, and the ledger's unique index catches it.
    await process(topUpEvent("evt_a", "cs_test_1"));
    await process(topUpEvent("evt_b", "cs_test_1"));

    expect(await listAllLots(supabase(), await accountId())).toHaveLength(1);
    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(500));
  });

  it("grants separately for two genuinely different purchases", async () => {
    await process(topUpEvent("evt_a", "cs_a"));
    await process(topUpEvent("evt_b", "cs_b"));

    expect(await listAllLots(supabase(), await accountId())).toHaveLength(2);
    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(1_000));
  });

  it("grants nothing for an unpaid session", async () => {
    const event = topUpEvent();
    event.checkoutSession!.paymentStatus = "unpaid";

    expect(await process(event)).toMatchObject({ status: "ignored", reason: "payment_not_completed" });
    expect(await listAllLots(supabase(), await accountId())).toHaveLength(0);
  });

  it("grants nothing when the charged Price does not match the claimed SKU", async () => {
    const event = topUpEvent();
    event.checkoutSession!.priceIds = ["price_pack_5000"];

    expect(await process(event)).toMatchObject({ status: "ignored", reason: "price_mismatch" });
    expect((await getBillingBalance(supabase(), USER))?.balance.posted ?? 0).toBe(0);
  });
});

describe("subscription period grants (§71)", () => {
  it("grants Builder's 1,000 Credits expiring at the period end", async () => {
    expect(await process(invoiceEvent())).toMatchObject({ status: "processed" });

    const lots = await listActiveLots(supabase(), await accountId());
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      sourceKind: "subscription",
      initialCreditUnits: creditsToUnits(1_000),
      // The period this payment bought.
      expiresAt: new Date(1_759_276_800 * 1000).toISOString(),
    });
  });

  it("grants 1,000 once when the same paid period is delivered five times (§71)", async () => {
    // The §71 merge gate. Never 5,000 because of retries.
    for (let i = 0; i < 5; i += 1) await process(invoiceEvent());

    expect(await listAllLots(supabase(), await accountId())).toHaveLength(1);
    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(1_000));
  });

  it("grants once across invoice.paid and invoice.payment_succeeded for one invoice", async () => {
    // Both fire for a paid invoice; they resolve to the same grant identity.
    await process(invoiceEvent("evt_a", "in_1"));
    await process({ ...invoiceEvent("evt_b", "in_1"), type: "invoice.paid" });

    expect(await listAllLots(supabase(), await accountId())).toHaveLength(1);
    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(1_000));
  });

  it("grants again for the next paid period", async () => {
    await process(invoiceEvent("evt_a", "in_month_1"));
    await process(invoiceEvent("evt_b", "in_month_2"));

    expect(await listAllLots(supabase(), await accountId())).toHaveLength(2);
    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(2_000));
  });

  it("grants 3,000 for a paid Pro period", async () => {
    const event = invoiceEvent();
    event.invoice!.priceIds = ["price_pro_monthly"];
    event.invoice!.subscriptionMetadata = {
      [VIBE_SKU_METADATA_KEY]: "pro",
      [VIBE_USER_METADATA_KEY]: USER,
    };

    await process(event);
    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(3_000));
  });
});

describe("failed payments and plan changes grant nothing (§32, §34)", () => {
  it("grants nothing for an unpaid invoice", async () => {
    const event = invoiceEvent();
    event.invoice!.status = "open";

    expect(await process(event)).toMatchObject({ status: "ignored", reason: "not_a_paid_period" });
    expect(await listAllLots(supabase(), await accountId())).toHaveLength(0);
  });

  it("grants nothing for a mid-cycle proration invoice (§34)", async () => {
    const event = invoiceEvent();
    event.invoice!.billingReason = "subscription_update";

    expect(await process(event)).toMatchObject({
      status: "ignored",
      reason: "proration_or_plan_change",
    });
    expect(await listAllLots(supabase(), await accountId())).toHaveLength(0);
  });

  it("keeps Credits from an earlier paid period after a later payment fails (§32)", async () => {
    await process(invoiceEvent("evt_a", "in_month_1"));

    const failed = invoiceEvent("evt_b", "in_month_2");
    failed.invoice!.status = "open";
    await process(failed);

    // The earlier period's Credits are untouched — no clawback.
    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(1_000));
  });
});

describe("subscription lifecycle (§29, §33)", () => {
  function subscriptionEvent(
    status: string,
    overrides: Partial<NonNullable<NormalizedStripeEvent["subscription"]>> = {},
  ): NormalizedStripeEvent {
    return {
      id: `evt_sub_${status}`,
      type: "customer.subscription.updated",
      livemode: false,
      subscription: {
        id: "sub_test_1",
        customerId: CUSTOMER,
        status,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        currentPeriodStart: 1_756_684_800,
        currentPeriodEnd: 1_759_276_800,
        priceIds: ["price_builder_monthly"],
        metadata: { [VIBE_USER_METADATA_KEY]: USER },
        ...overrides,
      },
    };
  }

  it("records the plan without granting anything (§29)", async () => {
    expect(await process(subscriptionEvent("active"))).toMatchObject({ status: "processed" });

    expect(await findActiveSubscription(supabase(), USER)).toMatchObject({
      planKey: "builder",
      status: "active",
    });
    // An active subscription is not a paid period.
    expect(await listAllLots(supabase(), await accountId())).toHaveLength(0);
  });

  it("updates one row rather than accumulating one per webhook", async () => {
    await process(subscriptionEvent("active"));
    await process({ ...subscriptionEvent("past_due"), id: "evt_2" });

    expect(await findActiveSubscription(supabase(), USER)).toMatchObject({ status: "past_due" });
  });

  it("stops showing a plan once cancelled, keeping the Credits already granted (§33)", async () => {
    await process(invoiceEvent());
    await process(subscriptionEvent("active"));

    await process({
      ...subscriptionEvent("canceled", { canceledAt: 1_759_276_800 }),
      id: "evt_cancel",
      type: "customer.subscription.deleted",
    });

    // No live plan…
    expect(await findActiveSubscription(supabase(), USER)).toBeNull();
    // …and the period's Credits survive, per their own expiry.
    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(1_000));
    expect(await listAllLots(supabase(), await accountId())).toHaveLength(1);
  });

  it("records which Stripe world the event came from, rather than assuming test", async () => {
    /*
     * Test-mode and live-mode objects share an id namespace but are entirely
     * separate. A hardcoded `false` here would let a live customer be recorded
     * as a test one — which is precisely the mixing the `livemode` column
     * exists to prevent, and it would not bite until the day live mode is
     * switched on.
     */
    await process({ ...subscriptionEvent("active"), livemode: true });

    expect(db.current.rows("billing_subscriptions")[0]).toMatchObject({ livemode: true });
  });

  it("records a scheduled cancellation while the plan is still live", async () => {
    await process(subscriptionEvent("active", { cancelAtPeriodEnd: true }));

    expect(await findActiveSubscription(supabase(), USER)).toMatchObject({
      status: "active",
      cancelAtPeriodEnd: true,
    });
  });
});

describe("ownership (§24, §65)", () => {
  it("grants nothing for a Stripe customer Vibe does not know", async () => {
    const event = topUpEvent();
    event.checkoutSession!.customerId = "cus_someone_else";
    event.checkoutSession!.metadata = { [VIBE_SKU_METADATA_KEY]: "pack_500" };

    expect(await process(event)).toMatchObject({ status: "ignored", reason: "owner_unresolved" });
    expect(await listAllLots(supabase(), await accountId())).toHaveLength(0);
  });

  it("refuses when the event claims a different owner than the mapping (§65)", async () => {
    // A payload claiming to belong to somebody else resolves to nothing, not to
    // that somebody else.
    const event = topUpEvent();
    event.checkoutSession!.metadata = {
      [VIBE_SKU_METADATA_KEY]: "pack_500",
      [VIBE_USER_METADATA_KEY]: "99999999-9999-9999-9999-999999999999",
    };

    expect(await process(event)).toMatchObject({ status: "ignored", reason: "owner_mismatch" });
    expect(await listAllLots(supabase(), await accountId())).toHaveLength(0);
  });

  it("grants nothing once the mapping is tombstoned by erasure (ADR 0056 §9)", async () => {
    // Erasure keeps the Stripe mapping and nulls its owner, so a webhook that
    // arrives afterwards finds a row whose `user_id` is null. Before this was
    // handled the null flowed straight into `grantCreditLot`, which would have
    // opened a *second*, ownerless wallet and granted purchased Credits into
    // it — silently, and with no owner who could ever spend or dispute them.
    for (const row of db.current.rows("billing_stripe_customers")) row.user_id = null;

    const event = topUpEvent();
    event.checkoutSession!.metadata = { [VIBE_SKU_METADATA_KEY]: "pack_500" };

    expect(await process(event)).toMatchObject({ status: "ignored", reason: "owner_erased" });
    expect(db.current.rows("billing_credit_accounts")).toHaveLength(0);
  });

  it("does not fall back to payload metadata for a tombstoned mapping", async () => {
    // The `claimedUserId` fallback exists for the window *before* a mapping is
    // written. Reaching it here would resurrect an erased identity from the
    // payment processor's own copy of its id.
    for (const row of db.current.rows("billing_stripe_customers")) row.user_id = null;

    const event = topUpEvent();
    event.checkoutSession!.metadata = {
      [VIBE_SKU_METADATA_KEY]: "pack_500",
      [VIBE_USER_METADATA_KEY]: USER,
    };

    expect(await process(event)).toMatchObject({ status: "ignored", reason: "owner_erased" });
    expect(db.current.rows("billing_credit_accounts")).toHaveLength(0);
  });

  it("resolves the owner from Vibe's own mapping, not from the payload", async () => {
    // No metadata at all, and it still lands in the right account.
    const event = topUpEvent();
    event.checkoutSession!.metadata = { [VIBE_SKU_METADATA_KEY]: "pack_500" };

    expect(await process(event)).toMatchObject({ status: "processed" });
    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(500));
  });
});

describe("event bookkeeping (§67)", () => {
  it("stores only an identity and an outcome — never a payload", async () => {
    await process(topUpEvent());

    const rows = db.current.rows("billing_stripe_events");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      stripe_event_id: "evt_topup_1",
      event_type: "checkout.session.completed",
      status: "processed",
    });

    // Nothing resembling a payload, a customer detail or an amount of money.
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain("price_pack_500");
    expect(serialized).not.toContain("cus_test_1");
  });

  it("records why an event was ignored, for debugging", async () => {
    const event = topUpEvent();
    event.checkoutSession!.paymentStatus = "unpaid";
    await process(event);

    expect(db.current.rows("billing_stripe_events")[0]).toMatchObject({
      status: "ignored",
      outcome_reason: "payment_not_completed",
    });
  });

  it("releases its claim when processing throws, so Stripe's retry can re-run", async () => {
    // A transient failure must not permanently consume the event's one claim —
    // that would be a payment the customer made and never received Credits for.
    db.current.failNextWriteWith = {
      table: "billing_credit_ledger",
      code: "XX000",
      message: "connection lost",
    };

    await expect(process(topUpEvent())).rejects.toThrow();
    expect(db.current.rows("billing_stripe_events")).toHaveLength(0);

    // The retry succeeds and grants exactly once.
    expect(await process(topUpEvent())).toMatchObject({ status: "processed" });
    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(500));
  });

  it("posts no ledger entry for an ignored event", async () => {
    const event = topUpEvent();
    event.invoice = undefined;
    event.checkoutSession!.mode = "subscription";

    await process(event);
    expect(await listLedgerEntries(supabase(), await accountId())).toHaveLength(0);
  });
});
