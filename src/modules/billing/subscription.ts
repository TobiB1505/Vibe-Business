import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { findActiveSubscription } from "./store";
import { getStripeClient } from "./stripe/client";

/**
 * Cancelling a subscription because the account is going away (ADR 0056 §9).
 *
 * ## Why this exists at all
 *
 * Nothing in this module cancelled a subscription before. That is the defect
 * ADR 0056 §9 names in one sentence: **deleting the Vibe identity does not stop
 * the card being charged — it only removes Vibe's ability to see that it is
 * happening.** So the rule is stated as a prohibition, because that is how it
 * gets checked:
 *
 * > Never delete the local identity while Stripe can continue charging it.
 *
 * ## Why it is immediate rather than at period end
 *
 * `cancel_at_period_end` keeps the subscription alive until the period closes,
 * which is the correct default for somebody who changed their mind about a
 * plan. It is the wrong one for somebody who asked to be erased: the local
 * record that would let Vibe reconcile the remaining period is about to be
 * tombstoned, and a subscription that renews after the identity is gone is the
 * exact outcome §9 forbids. Vibe does not refund the unused part of the period,
 * and the erasure copy has to say so.
 *
 * ## Why a missing subscription is success
 *
 * The postcondition is "Stripe cannot charge this account", not "a cancellation
 * was performed". An account that never subscribed already satisfies it, and so
 * does one whose subscription was cancelled by an earlier attempt — which is
 * what makes this safe to re-enter after a partial erasure.
 */

export type CancelSubscriptionsResult =
  | { ok: true; cancelled: number }
  | { ok: false; reason: "stripe_cancel_failed" };

export async function cancelSubscriptionsForErasure(
  supabase: SupabaseClient,
  userId: string,
): Promise<CancelSubscriptionsResult> {
  let subscription;
  try {
    subscription = await findActiveSubscription(supabase, userId);
  } catch {
    // A read failure is not a cancellation failure, but it is equally a reason
    // not to proceed: erasure must never continue on the *assumption* that
    // there is nothing to cancel.
    return { ok: false, reason: "stripe_cancel_failed" };
  }

  if (!subscription) return { ok: true, cancelled: 0 };

  try {
    await getStripeClient().subscriptions.cancel(subscription.stripeSubscriptionId);
  } catch (error) {
    // Already cancelled at Stripe is the postcondition, not a failure. Stripe
    // reports it as `resource_missing`, and treating it as an error would make
    // a re-entered erasure permanently unable to get past step 2.
    if (isAlreadyGone(error)) return { ok: true, cancelled: 0 };

    // The provider's message is never shown to a user and never stored. It goes
    // to server logs, where an operator can act on it (VB-003).
    console.error("[billing] failed to cancel subscription for erasure", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, reason: "stripe_cancel_failed" };
  }

  return { ok: true, cancelled: 1 };
}

/** Stripe's "this object does not exist", which for a cancellation is success. */
function isAlreadyGone(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "resource_missing"
  );
}
