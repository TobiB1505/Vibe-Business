import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaidPlanKey } from "./catalog";

/**
 * Stripe-facing persistence (BILLING CORE-2 §24, §27, §28, §33, §67).
 *
 * Every table here is written by the service role only — none has an insert or
 * update policy, so a browser that reached one of these functions still could
 * not write. Ownership is resolved from the authenticated session or from
 * Vibe's own customer mapping, never from a value a caller supplied (§65).
 */

const POSTGRES_UNIQUE_VIOLATION = "23505";

/* ---------------------------------------------------------------------------
 * Stripe customers
 * ------------------------------------------------------------------------ */

export type StripeCustomerLink = {
  id: string;
  /** Null once the identity is erased — the mapping is tombstoned (ADR 0056 §9). */
  userId: string | null;
  stripeCustomerId: string;
  livemode: boolean;
};

type CustomerRow = {
  id: string;
  user_id: string | null;
  stripe_customer_id: string;
  livemode: boolean;
};

const CUSTOMER_COLUMNS = "id, user_id, stripe_customer_id, livemode";

function mapCustomer(row: CustomerRow): StripeCustomerLink {
  return {
    id: row.id,
    userId: row.user_id,
    stripeCustomerId: row.stripe_customer_id,
    livemode: row.livemode,
  };
}

export async function findStripeCustomerByUser(
  supabase: SupabaseClient,
  params: { userId: string; livemode: boolean },
): Promise<StripeCustomerLink | null> {
  const { data, error } = await supabase
    .from("billing_stripe_customers")
    .select(CUSTOMER_COLUMNS)
    .eq("user_id", params.userId)
    .eq("livemode", params.livemode)
    .maybeSingle();

  if (error) throw error;
  return data ? mapCustomer(data as CustomerRow) : null;
}

/**
 * The Vibe owner behind a Stripe customer id (§65).
 *
 * The webhook's ownership hop. A payment event names a Stripe customer, and
 * this is the only thing that turns it into a Vibe user — a mapping Vibe wrote
 * itself when it created the customer, not a claim carried in the payload.
 */
export async function findUserByStripeCustomer(
  supabase: SupabaseClient,
  stripeCustomerId: string,
): Promise<StripeCustomerLink | null> {
  const { data, error } = await supabase
    .from("billing_stripe_customers")
    .select(CUSTOMER_COLUMNS)
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapCustomer(data as CustomerRow) : null;
}

/**
 * Records the Stripe customer for a Vibe owner.
 *
 * Idempotent under concurrency: the unique index on `(user_id, livemode)` turns
 * a race into a constraint violation and the loser re-reads the winner's row.
 * Two simultaneous first purchases must not create two Stripe customers for one
 * person — that splits their payment history in half.
 */
export async function linkStripeCustomer(
  supabase: SupabaseClient,
  params: { userId: string; stripeCustomerId: string; livemode: boolean },
): Promise<StripeCustomerLink> {
  const existing = await findStripeCustomerByUser(supabase, params);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("billing_stripe_customers")
    .insert({
      user_id: params.userId,
      stripe_customer_id: params.stripeCustomerId,
      livemode: params.livemode,
    })
    .select(CUSTOMER_COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      const raced = await findStripeCustomerByUser(supabase, params);
      if (raced) return raced;
    }
    throw error;
  }

  return mapCustomer(data as CustomerRow);
}

/* ---------------------------------------------------------------------------
 * Subscriptions
 * ------------------------------------------------------------------------ */

export type SubscriptionSnapshot = {
  id: string;
  /** Null once the identity is erased — the mapping is tombstoned (ADR 0056 §9). */
  userId: string | null;
  stripeSubscriptionId: string;
  planKey: PaidPlanKey;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
};

type SubscriptionRow = {
  id: string;
  user_id: string | null;
  stripe_subscription_id: string;
  plan_key: PaidPlanKey;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
};

const SUBSCRIPTION_COLUMNS =
  "id, user_id, stripe_subscription_id, plan_key, status, current_period_start, current_period_end, cancel_at_period_end, canceled_at";

function mapSubscription(row: SubscriptionRow): SubscriptionSnapshot {
  return {
    id: row.id,
    userId: row.user_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    planKey: row.plan_key,
    status: row.status,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    canceledAt: row.canceled_at,
  };
}

/**
 * Stripe statuses that mean "this customer is currently on this plan".
 *
 * `past_due` is deliberately included: the customer has not been downgraded and
 * Stripe is still retrying their payment. It does not authorize a grant —
 * only a paid invoice does that (§29) — it only decides what plan the billing
 * page shows.
 */
const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

/** The plan a customer is currently on, if any. */
export async function findActiveSubscription(
  supabase: SupabaseClient,
  userId: string,
): Promise<SubscriptionSnapshot | null> {
  const { data, error } = await supabase
    .from("billing_subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("user_id", userId)
    .in("status", [...LIVE_SUBSCRIPTION_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapSubscription(data as SubscriptionRow) : null;
}

export async function findSubscriptionByStripeId(
  supabase: SupabaseClient,
  stripeSubscriptionId: string,
): Promise<SubscriptionSnapshot | null> {
  const { data, error } = await supabase
    .from("billing_subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapSubscription(data as SubscriptionRow) : null;
}

/**
 * Records the current state of a Stripe subscription (§33).
 *
 * A snapshot, never an authorization. Cancellation is recorded so future grants
 * stop; historical grants, past charges and purchased Credits are untouched,
 * and the row itself is never deleted — a customer who cancels and returns
 * still has their billing history.
 */
export async function upsertSubscriptionSnapshot(
  supabase: SupabaseClient,
  params: {
    userId: string;
    stripeSubscriptionId: string;
    stripeCustomerId: string;
    planKey: PaidPlanKey;
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    livemode: boolean;
  },
): Promise<SubscriptionSnapshot> {
  const { data, error } = await supabase
    .from("billing_subscriptions")
    .upsert(
      {
        user_id: params.userId,
        stripe_subscription_id: params.stripeSubscriptionId,
        stripe_customer_id: params.stripeCustomerId,
        plan_key: params.planKey,
        status: params.status,
        current_period_start: params.currentPeriodStart,
        current_period_end: params.currentPeriodEnd,
        cancel_at_period_end: params.cancelAtPeriodEnd,
        canceled_at: params.canceledAt,
        livemode: params.livemode,
      },
      { onConflict: "stripe_subscription_id" },
    )
    .select(SUBSCRIPTION_COLUMNS)
    .single();

  if (error) throw error;
  return mapSubscription(data as SubscriptionRow);
}

/* ---------------------------------------------------------------------------
 * Stripe events
 * ------------------------------------------------------------------------ */

export type StripeEventClaim =
  /** This caller owns processing for this event. */
  | { claimed: true }
  /** Another delivery already has it, or already finished it. */
  | { claimed: false; existingStatus: string };

/**
 * Claims an event for processing, exactly once (§28).
 *
 * ## Why an insert rather than a status check
 *
 * "If status is not processed, process it" is a race: two concurrent deliveries
 * of the same event both read "not processed" and both grant. The claim here
 * *is* the insert, and `billing_stripe_events_stripe_id_idx` is unique — so the
 * second delivery loses the index and is told what the first is doing.
 *
 * The unique index is the guarantee, not this function. Underneath it, the
 * ledger's own idempotency index would still collapse a duplicate grant to one
 * entry even if this claim were bypassed entirely: two independent structures
 * enforcing the same rule (§28).
 */
export async function claimStripeEvent(
  supabase: SupabaseClient,
  params: { stripeEventId: string; eventType: string; livemode: boolean },
): Promise<StripeEventClaim> {
  const { error } = await supabase.from("billing_stripe_events").insert({
    stripe_event_id: params.stripeEventId,
    event_type: params.eventType,
    livemode: params.livemode,
    status: "processing",
  });

  if (!error) return { claimed: true };

  if (error.code === POSTGRES_UNIQUE_VIOLATION) {
    const { data } = await supabase
      .from("billing_stripe_events")
      .select("status")
      .eq("stripe_event_id", params.stripeEventId)
      .maybeSingle();

    const existingStatus = (data as { status: string } | null)?.status ?? "processing";
    if (existingStatus !== "processing") return { claimed: false, existingStatus };

    // VB-013. A claim stuck at `processing` is what a crash between the insert
    // and either completion or release leaves behind — and it is worse than it
    // looks. Every later Stripe retry loses the unique index, reads
    // `processing`, and is answered `duplicate`, which is a 2xx. Stripe stops
    // retrying. The customer paid and the grant never posted, and nothing is
    // red anywhere.
    return (await reclaimStaleStripeEvent(supabase, params.stripeEventId))
      ? { claimed: true }
      : { claimed: false, existingStatus };
  }

  throw error;
}

/**
 * How long a claim may sit at `processing` before another delivery may take it.
 *
 * Bounded from both sides, and the lower bound is the dangerous one: re-claiming
 * an event whose original handler is **still running** processes it twice, which
 * is the double-grant this table exists to prevent. So the window has to exceed
 * the longest a handler can possibly take — a Vercel function is killed long
 * before this — rather than merely the longest one usually takes.
 *
 * The upper bound is Stripe's retry schedule: it retries a failed delivery for
 * about three days, so a window measured in minutes leaves many retries to
 * carry the re-claim. Fifteen sits far from both edges.
 */
const STALE_CLAIM_MINUTES = 15;

/**
 * Takes a claim that has been abandoned, or reports that it has not.
 *
 * A compare-and-swap for the same reason the original claim is an insert: two
 * retries arriving together must not both decide the claim is stale. The
 * predicate is part of the `UPDATE`, so PostgreSQL picks the winner and the
 * loser is told by an empty result rather than by a read it could have raced.
 *
 * The row is re-stamped rather than deleted and re-inserted. Deleting would
 * discard `received_at` — when the event first arrived — which is the one fact
 * that makes a stuck claim diagnosable afterwards. `updated_at` moves because
 * the table's `set_updated_at` trigger fires on any update, so a re-claimed
 * event starts its own fresh window.
 */
async function reclaimStaleStripeEvent(
  supabase: SupabaseClient,
  stripeEventId: string,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();

  const { data, error } = await supabase
    .from("billing_stripe_events")
    .update({ status: "processing" })
    .eq("stripe_event_id", stripeEventId)
    .eq("status", "processing")
    .lt("updated_at", staleBefore)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

/** Records how an event finished. Never stores a payload, an error body or a signature. */
export async function completeStripeEvent(
  supabase: SupabaseClient,
  params: {
    stripeEventId: string;
    status: "processed" | "ignored" | "failed";
    outcomeReason?: string | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from("billing_stripe_events")
    .update({
      status: params.status,
      outcome_reason: params.outcomeReason ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq("stripe_event_id", params.stripeEventId);

  if (error) throw error;
}

/**
 * Releases a claim so Stripe's next retry can try again.
 *
 * Used when processing threw. A transient database failure must not permanently
 * consume the event's one claim — that would turn a retryable blip into a
 * payment the customer paid for and never received Credits for.
 */
export async function releaseStripeEventClaim(
  supabase: SupabaseClient,
  stripeEventId: string,
): Promise<void> {
  const { error } = await supabase
    .from("billing_stripe_events")
    .delete()
    .eq("stripe_event_id", stripeEventId)
    .eq("status", "processing");

  if (error) throw error;
}
