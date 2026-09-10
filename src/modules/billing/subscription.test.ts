import { beforeEach, describe, expect, it, vi } from "vitest";

const cancel = vi.fn();
const findActiveSubscription = vi.fn();

vi.mock("./stripe/client", () => ({
  getStripeClient: () => ({ subscriptions: { cancel } }),
}));
vi.mock("./store", () => ({
  findActiveSubscription: (...args: unknown[]) => findActiveSubscription(...args),
}));

const { cancelSubscriptionsForErasure } = await import("./subscription");

/**
 * Cancelling before erasing (ADR 0056 §9).
 *
 * The rule these pin is a prohibition, because that is how it gets checked:
 * **never delete the local identity while Stripe can continue charging it.**
 * So the interesting cases are not the happy path — they are the three ways
 * this could wrongly report success and let the erasure proceed past a
 * subscription that is still live.
 */

const supabase = {} as never;
const USER = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  cancel.mockReset();
  findActiveSubscription.mockReset();
});

describe("when there is a subscription", () => {
  it("cancels it immediately", async () => {
    findActiveSubscription.mockResolvedValue({ stripeSubscriptionId: "sub_1" });
    cancel.mockResolvedValue({});

    expect(await cancelSubscriptionsForErasure(supabase, USER)).toEqual({ ok: true, cancelled: 1 });
    expect(cancel).toHaveBeenCalledWith("sub_1");
  });

  it("does not schedule the cancellation for the end of the period", async () => {
    // `cancel_at_period_end` is right for somebody changing plans and wrong for
    // somebody being erased: the local record that would let Vibe reconcile the
    // remaining period is about to be tombstoned, and a renewal after the
    // identity is gone is the outcome §9 forbids.
    findActiveSubscription.mockResolvedValue({ stripeSubscriptionId: "sub_1" });
    cancel.mockResolvedValue({});

    await cancelSubscriptionsForErasure(supabase, USER);

    expect(JSON.stringify(cancel.mock.calls)).not.toContain("period_end");
  });
});

describe("when it cannot be cancelled", () => {
  it("reports failure so the erasure stops", async () => {
    findActiveSubscription.mockResolvedValue({ stripeSubscriptionId: "sub_1" });
    cancel.mockRejectedValue(new Error("card network unavailable"));

    expect(await cancelSubscriptionsForErasure(supabase, USER)).toEqual({
      ok: false,
      reason: "stripe_cancel_failed",
    });
  });

  it("treats a failed read as a failure, never as nothing to cancel", async () => {
    // The dangerous shape: an unreadable subscription table looks exactly like
    // an account with no subscription, and proceeding on that assumption
    // deletes the identity while the card keeps being charged.
    findActiveSubscription.mockRejectedValue(new Error("connection reset"));

    expect(await cancelSubscriptionsForErasure(supabase, USER)).toEqual({
      ok: false,
      reason: "stripe_cancel_failed",
    });
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("when there is nothing to cancel", () => {
  it("succeeds for an account that never subscribed", async () => {
    findActiveSubscription.mockResolvedValue(null);

    expect(await cancelSubscriptionsForErasure(supabase, USER)).toEqual({ ok: true, cancelled: 0 });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("succeeds when Stripe says the subscription is already gone", async () => {
    // What makes a re-entered erasure able to get past step 2. Without this a
    // second attempt after a partial erasure would fail forever at the same
    // point, on a subscription the first attempt had already cancelled.
    findActiveSubscription.mockResolvedValue({ stripeSubscriptionId: "sub_1" });
    cancel.mockRejectedValue(Object.assign(new Error("No such subscription"), { code: "resource_missing" }));

    expect(await cancelSubscriptionsForErasure(supabase, USER)).toEqual({ ok: true, cancelled: 0 });
  });

  it("does not treat any other Stripe error code as already gone", async () => {
    findActiveSubscription.mockResolvedValue({ stripeSubscriptionId: "sub_1" });
    cancel.mockRejectedValue(Object.assign(new Error("nope"), { code: "api_error" }));

    expect(await cancelSubscriptionsForErasure(supabase, USER)).toEqual({
      ok: false,
      reason: "stripe_cancel_failed",
    });
  });
});
