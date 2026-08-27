import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { grantCreditLot } from "@/modules/credits/grants";
import {
  claimStripeEvent,
  completeStripeEvent,
  findUserByStripeCustomer,
  linkStripeCustomer,
  releaseStripeEventClaim,
  upsertSubscriptionSnapshot,
} from "./store";
import { interpretStripeEvent, type BillingIntent, type CatalogPriceIds, type NormalizedStripeEvent } from "./stripe/events";

/**
 * Turning verified Stripe events into Credits (BILLING CORE-2 §18, §27–§34).
 *
 * ## The direction money flows, stated once
 *
 * ```
 * Stripe payment truth → verified event → idempotent grant → Vibe Credit ledger
 * ```
 *
 * And never the other way. Vibe does not ask Stripe at runtime whether a
 * customer can afford an audit; that question is answered by the Credit
 * balance, which this file is the only funding path into (§18).
 *
 * ## Three independent structures make a replay harmless
 *
 * 1. `billing_stripe_events` — the event id is claimed by a unique insert, so
 *    a second delivery never enters the handler.
 * 2. `billing_credit_ledger` — the grant's idempotency key is unique per
 *    account, so even a handler that ran twice posts one entry.
 * 3. `billing_credit_grants` — one ledger entry owns at most one lot.
 *
 * Any one of them alone would be enough for the common case. All three exist
 * because "delivered five times, granted once" (§71) is the kind of guarantee
 * that should not rest on a single index being correct.
 */

export type ProcessStripeEventResult = {
  status: "processed" | "ignored" | "duplicate" | "failed";
  reason?: string;
};

/**
 * Processes one verified Stripe event.
 *
 * `supabase` must be the service-role client: these writes bypass RLS by
 * necessity, because a webhook has no session. Ownership is therefore resolved
 * explicitly here rather than by a policy — from Vibe's own Stripe customer
 * mapping, never from the event's own claim about who it belongs to.
 */
export async function processStripeEvent(
  supabase: SupabaseClient,
  params: { event: NormalizedStripeEvent; catalogPriceIds: CatalogPriceIds },
): Promise<ProcessStripeEventResult> {
  const { event } = params;

  const claim = await claimStripeEvent(supabase, {
    stripeEventId: event.id,
    eventType: event.type,
    livemode: event.livemode,
  });

  // Already claimed by another delivery. Reporting success is correct: Stripe
  // asked whether the event was handled, and it was — retrying would achieve
  // nothing, and a non-2xx would make Stripe retry forever.
  if (!claim.claimed) return { status: "duplicate", reason: claim.existingStatus };

  try {
    const intent = interpretStripeEvent(event, params.catalogPriceIds);
    const outcome = await applyBillingIntent(supabase, intent, event.livemode);

    await completeStripeEvent(supabase, {
      stripeEventId: event.id,
      status: outcome.status === "processed" ? "processed" : "ignored",
      outcomeReason: outcome.reason ?? null,
    });

    return outcome;
  } catch (error) {
    // The claim is released rather than marked failed, so Stripe's next retry
    // can genuinely retry. A transient database error must never turn into a
    // payment the customer made and never received Credits for.
    await releaseStripeEventClaim(supabase, event.id);
    throw error;
  }
}

async function applyBillingIntent(
  supabase: SupabaseClient,
  intent: BillingIntent,
  /**
   * Which Stripe world this event came from.
   *
   * Threaded from the event rather than assumed. Test-mode and live-mode
   * objects share an id namespace but are entirely separate, and a row that
   * recorded the wrong one would let a test-mode customer be treated as a live
   * one — the exact mixing `billing_stripe_customers.livemode` exists to
   * prevent.
   */
  livemode: boolean,
): Promise<ProcessStripeEventResult> {
  switch (intent.kind) {
    case "ignored":
      return { status: "ignored", reason: intent.reason };

    case "grant_top_up":
      return grantTopUp(supabase, intent);

    case "grant_subscription_period":
      return grantSubscriptionPeriod(supabase, intent);

    case "sync_subscription":
      return syncSubscription(supabase, intent, livemode);
  }
}

/**
 * Resolves the Vibe owner behind a Stripe customer (§24, §65).
 *
 * The mapping Vibe wrote when it created the customer is the authority. The
 * event's own `vibe_user_id` metadata is used only as a fallback for the
 * narrow window before the mapping exists, and when both are present they must
 * agree — a mismatch means something is wrong enough that granting Credits to
 * either candidate would be a guess.
 *
 * ## A tombstoned mapping resolves to nobody
 *
 * Erasure keeps the Stripe mapping and nulls its owner (ADR 0056 §9), so a
 * mapping row can outlive the identity behind it. An event arriving afterwards
 * is not unresolvable — it is resolved, to an identity that no longer exists —
 * and it must never fall through to the `claimedUserId` fallback. That fallback
 * exists for the window *before* a mapping is written, and reaching it here
 * would grant Credits from erased-account metadata into a brand-new wallet.
 * §9's cancel-Stripe-first rule makes this rare; it does not make it
 * impossible, because webhooks are asynchronous and can arrive after the
 * cancellation that caused them.
 */
async function resolveOwner(
  supabase: SupabaseClient,
  params: { stripeCustomerId: string | null; claimedUserId: string | null },
): Promise<{ ok: true; userId: string } | { ok: false; reason: string }> {
  if (params.stripeCustomerId) {
    const linked = await findUserByStripeCustomer(supabase, params.stripeCustomerId);

    if (linked) {
      if (linked.userId === null) return { ok: false, reason: "owner_erased" };
      if (params.claimedUserId && params.claimedUserId !== linked.userId) {
        return { ok: false, reason: "owner_mismatch" };
      }
      return { ok: true, userId: linked.userId };
    }
  }

  if (params.claimedUserId) return { ok: true, userId: params.claimedUserId };

  return { ok: false, reason: "owner_unresolved" };
}

async function grantTopUp(
  supabase: SupabaseClient,
  intent: Extract<BillingIntent, { kind: "grant_top_up" }>,
): Promise<ProcessStripeEventResult> {
  const owner = await resolveOwner(supabase, {
    stripeCustomerId: intent.stripeCustomerId,
    claimedUserId: intent.claimedUserId,
  });
  if (!owner.ok) return { status: "ignored", reason: owner.reason };

  const granted = await grantCreditLot(supabase, {
    userId: owner.userId,
    sourceKind: "purchase",
    credits: intent.creditUnits,
    reason: `Credit purchase (${intent.packKey})`,
    idempotencyKey: intent.idempotencyKey,
    // Purchased Credits carry no normal monthly expiration (§10). Null rather
    // than a far-future date: "does not expire monthly" and "expires in 2099"
    // are different promises and only one is true.
    expiresAt: null,
    externalReference: intent.externalReference,
  });

  return { status: "processed", reason: granted.alreadyGranted ? "already_granted" : intent.packKey };
}

async function grantSubscriptionPeriod(
  supabase: SupabaseClient,
  intent: Extract<BillingIntent, { kind: "grant_subscription_period" }>,
): Promise<ProcessStripeEventResult> {
  const owner = await resolveOwner(supabase, {
    stripeCustomerId: intent.stripeCustomerId,
    claimedUserId: intent.claimedUserId,
  });
  if (!owner.ok) return { status: "ignored", reason: owner.reason };

  const periodStart = new Date(intent.periodStart * 1000).toISOString();
  const periodEnd = new Date(intent.periodEnd * 1000).toISOString();

  const granted = await grantCreditLot(supabase, {
    userId: owner.userId,
    sourceKind: "subscription",
    credits: intent.creditUnits,
    reason: `${intent.planKey} monthly Credits`,
    idempotencyKey: intent.idempotencyKey,
    // The period this payment bought — not whichever period happens to be
    // current when the webhook is handled (§29).
    expiresAt: periodEnd,
    externalReference: intent.externalReference,
    periodStart,
    periodEnd,
  });

  return { status: "processed", reason: granted.alreadyGranted ? "already_granted" : intent.planKey };
}

async function syncSubscription(
  supabase: SupabaseClient,
  intent: Extract<BillingIntent, { kind: "sync_subscription" }>,
  livemode: boolean,
): Promise<ProcessStripeEventResult> {
  // An unrecognized plan is recorded as nothing rather than guessed. A snapshot
  // is not a grant, so being unable to name the plan costs nothing.
  if (!intent.planKey) return { status: "ignored", reason: "unknown_plan" };

  const owner = await resolveOwner(supabase, {
    stripeCustomerId: intent.stripeCustomerId,
    claimedUserId: intent.claimedUserId,
  });
  if (!owner.ok) return { status: "ignored", reason: owner.reason };

  if (intent.stripeCustomerId) {
    await linkStripeCustomer(supabase, {
      userId: owner.userId,
      stripeCustomerId: intent.stripeCustomerId,
      livemode,
    }).catch(() => {
      // A mapping that already exists for this user is the normal case and not
      // an error worth failing a webhook over.
    });
  }

  await upsertSubscriptionSnapshot(supabase, {
    userId: owner.userId,
    stripeSubscriptionId: intent.stripeSubscriptionId,
    stripeCustomerId: intent.stripeCustomerId ?? "",
    planKey: intent.planKey,
    status: intent.status,
    currentPeriodStart:
      intent.currentPeriodStart === null ? null : new Date(intent.currentPeriodStart * 1000).toISOString(),
    currentPeriodEnd:
      intent.currentPeriodEnd === null ? null : new Date(intent.currentPeriodEnd * 1000).toISOString(),
    cancelAtPeriodEnd: intent.cancelAtPeriodEnd,
    canceledAt: intent.canceledAt === null ? null : new Date(intent.canceledAt * 1000).toISOString(),
    livemode,
  });

  await recordAuditEvent(supabase, {
    userId: owner.userId,
    eventType: "billing.subscription_updated",
    metadata: {
      plan: intent.planKey,
      status: intent.status,
      cancelAtPeriodEnd: intent.cancelAtPeriodEnd,
    },
  });

  return { status: "processed", reason: `subscription_${intent.status}` };
}
