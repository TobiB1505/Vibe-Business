import {
  getCreditPack,
  getPlan,
  parseCreditPackKey,
  parsePaidPlanKey,
  subscriptionGrantIdempotencyKey,
  topUpGrantIdempotencyKey,
  type CreditPackKey,
  type PaidPlanKey,
} from "../catalog";
import type { CreditUnits } from "@/modules/credits/units";

/**
 * Turning a verified Stripe event into a Vibe billing decision
 * (BILLING CORE-2 §22, §23, §29, §30, §31, §32, §34).
 *
 * ## Pure, and deliberately so
 *
 * This file imports no SDK, touches no database and reads no clock. It takes a
 * plain description of what Stripe said and returns what Vibe should do about
 * it. That is what makes the rules below testable exhaustively — including the
 * ones that matter most and are hardest to reproduce against a live Stripe
 * account: a replayed event, an out-of-order event, a proration event, and a
 * forged Price id.
 *
 * ## The rule that prevents most of the damage
 *
 * **Stripe says what was paid. Vibe says what that is worth.**
 *
 * The Credit amount is never read from the event. It is looked up in Vibe's own
 * catalog from a SKU key, and the event's Price id is then checked *against*
 * the catalog's configured Price for that SKU. So an event naming an unknown or
 * mismatched Price grants nothing, and there is no path by which a number
 * carried in a payload becomes a number of Credits.
 */

/* ---------------------------------------------------------------------------
 * The normalized shapes this module reasons about
 * ------------------------------------------------------------------------ */

/**
 * The Stripe metadata Vibe writes when it creates a Checkout Session.
 *
 * Round-trips through Stripe and comes back on the event. Trustworthy only
 * because the webhook signature was verified first — and even then it is used
 * to name a *SKU*, never an amount (§23).
 */
export const VIBE_SKU_METADATA_KEY = "vibe_sku";
export const VIBE_USER_METADATA_KEY = "vibe_user_id";

export type NormalizedCheckoutSession = {
  id: string;
  /**
   * Stripe's session mode. Typed as `string` rather than a union because
   * Stripe's own types include an open `OtherString` member — the API may grow
   * a mode this integration has never heard of, and a narrowed type would make
   * that a compile error instead of what it should be: an event Vibe ignores.
   */
  mode: string;
  /** Stripe's own word for whether the money actually arrived. Open, as above. */
  paymentStatus: string;
  customerId: string | null;
  subscriptionId: string | null;
  metadata: Record<string, string>;
  /** The Price ids the session actually charged, as Stripe reports them. */
  priceIds: string[];
};

export type NormalizedInvoice = {
  id: string;
  status: string;
  /** Why Stripe created this invoice. The proration guard depends on it. */
  billingReason: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  /** The paid period, taken from the invoice's own line items. */
  periodStart: number | null;
  periodEnd: number | null;
  priceIds: string[];
  subscriptionMetadata: Record<string, string>;
};

export type NormalizedSubscription = {
  id: string;
  customerId: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  canceledAt: number | null;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  priceIds: string[];
  metadata: Record<string, string>;
};

export type NormalizedStripeEvent = {
  id: string;
  type: string;
  livemode: boolean;
  checkoutSession?: NormalizedCheckoutSession;
  invoice?: NormalizedInvoice;
  subscription?: NormalizedSubscription;
};

/** The configured Stripe Price id for each catalog SKU, resolved server-side. */
export type CatalogPriceIds = {
  builder: string | undefined;
  pro: string | undefined;
  pack_500: string | undefined;
  pack_1500: string | undefined;
  pack_5000: string | undefined;
};

/* ---------------------------------------------------------------------------
 * Intents
 * ------------------------------------------------------------------------ */

/**
 * What Vibe should do about an event.
 *
 * `ignored` is a first-class outcome rather than an error. Stripe sends many
 * event types Vibe has no opinion about, and a webhook that treated "nothing to
 * do" as a failure would retry forever.
 */
export type BillingIntent =
  | {
      kind: "grant_top_up";
      packKey: CreditPackKey;
      creditUnits: CreditUnits;
      /** Bound to the Checkout Session — one purchase, one grant (§72). */
      idempotencyKey: string;
      externalReference: string;
      stripeCustomerId: string | null;
      claimedUserId: string | null;
    }
  | {
      kind: "grant_subscription_period";
      planKey: PaidPlanKey;
      creditUnits: CreditUnits;
      /** Bound to the invoice — one paid period, one grant (§30, §71). */
      idempotencyKey: string;
      externalReference: string;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      periodStart: number;
      periodEnd: number;
      claimedUserId: string | null;
    }
  | {
      kind: "sync_subscription";
      stripeSubscriptionId: string;
      stripeCustomerId: string | null;
      planKey: PaidPlanKey | null;
      status: string;
      cancelAtPeriodEnd: boolean;
      canceledAt: number | null;
      currentPeriodStart: number | null;
      currentPeriodEnd: number | null;
      claimedUserId: string | null;
    }
  | { kind: "ignored"; reason: IgnoreReason };

export type IgnoreReason =
  | "unhandled_event_type"
  | "payment_not_completed"
  | "not_a_paid_period"
  | "proration_or_plan_change"
  | "unknown_sku"
  | "price_not_in_catalog"
  | "price_mismatch"
  | "missing_period"
  | "checkout_subscription_handled_by_invoice";

/* ---------------------------------------------------------------------------
 * Catalog validation
 * ------------------------------------------------------------------------ */

/**
 * Confirms a SKU's configured Stripe Price is among the ones actually charged
 * (§22, §23, §102.5).
 *
 * This is the check that makes a forged Price id worthless. The browser chose a
 * SKU; the server chose the Price; and this asserts that the money Stripe
 * actually took corresponds to the Price the server chose. A payload naming
 * some other Price — including a real Price for a more generous pack — matches
 * nothing and grants nothing.
 *
 * An unconfigured Price fails closed. "We never set up that SKU" must never
 * read as "any Price is acceptable for that SKU".
 */
function priceMatchesCatalog(
  configuredPriceId: string | undefined,
  chargedPriceIds: readonly string[],
): { ok: true } | { ok: false; reason: "price_not_in_catalog" | "price_mismatch" } {
  if (!configuredPriceId) return { ok: false, reason: "price_not_in_catalog" };
  if (!chargedPriceIds.includes(configuredPriceId)) return { ok: false, reason: "price_mismatch" };
  return { ok: true };
}

function readMetadata(metadata: Record<string, string>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/* ---------------------------------------------------------------------------
 * Interpretation
 * ------------------------------------------------------------------------ */

/**
 * Decides what a verified Stripe event means for Vibe's Credit ledger.
 *
 * The event must already have passed signature verification — this function
 * assumes authenticity and reasons only about meaning.
 */
export function interpretStripeEvent(
  event: NormalizedStripeEvent,
  catalogPriceIds: CatalogPriceIds,
): BillingIntent {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return interpretCheckoutSession(event.checkoutSession, catalogPriceIds);

    // Both are emitted for a paid invoice. Handling both is safe rather than
    // duplicative: they resolve to the same idempotency key, so whichever
    // arrives first grants and the other posts nothing (§28).
    case "invoice.payment_succeeded":
    case "invoice.paid":
      return interpretInvoice(event.invoice, catalogPriceIds);

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return interpretSubscription(event.subscription, catalogPriceIds);

    default:
      return { kind: "ignored", reason: "unhandled_event_type" };
  }
}

function interpretCheckoutSession(
  session: NormalizedCheckoutSession | undefined,
  catalogPriceIds: CatalogPriceIds,
): BillingIntent {
  if (!session) return { kind: "ignored", reason: "unhandled_event_type" };

  /*
   * A subscription Checkout grants nothing here, deliberately (§31).
   *
   * The subscription's first month is granted by its first paid invoice, like
   * every subsequent month. Granting on the Checkout return as well would be
   * the classic double-grant: one signup, two allowances. There is exactly one
   * grant per paid period and the invoice is what identifies a paid period.
   */
  if (session.mode === "subscription") {
    return { kind: "ignored", reason: "checkout_subscription_handled_by_invoice" };
  }

  if (session.mode !== "payment") return { kind: "ignored", reason: "unhandled_event_type" };

  // Stripe's own statement that the money arrived. A completed session with an
  // asynchronous payment method can still be unpaid, and granting on
  // "completed" alone would hand out Credits for a payment that may yet fail.
  if (session.paymentStatus !== "paid") {
    return { kind: "ignored", reason: "payment_not_completed" };
  }

  const packKey = parseCreditPackKey(readMetadata(session.metadata, VIBE_SKU_METADATA_KEY));
  if (!packKey) return { kind: "ignored", reason: "unknown_sku" };

  const pack = getCreditPack(packKey);
  const priceCheck = priceMatchesCatalog(catalogPriceIds[packKey], session.priceIds);
  if (!priceCheck.ok) return { kind: "ignored", reason: priceCheck.reason };

  return {
    kind: "grant_top_up",
    packKey,
    // From Vibe's catalog. Never from the event.
    creditUnits: pack.creditUnits,
    idempotencyKey: topUpGrantIdempotencyKey(session.id),
    externalReference: session.id,
    stripeCustomerId: session.customerId,
    claimedUserId: readMetadata(session.metadata, VIBE_USER_METADATA_KEY),
  };
}

/**
 * Billing reasons that represent a genuinely paid subscription period.
 *
 * `subscription_create` is the first period; `subscription_cycle` is each
 * renewal. Everything else is deliberately excluded — most importantly
 * `subscription_update`, which is what Stripe emits for a mid-cycle plan
 * change and its proration invoice. Granting on that would mint Credits for a
 * partial period nobody approved a Credit allowance for, which is exactly the
 * accidental proration economics §34 forbids.
 */
const PAID_PERIOD_BILLING_REASONS = ["subscription_create", "subscription_cycle"] as const;

function interpretInvoice(
  invoice: NormalizedInvoice | undefined,
  catalogPriceIds: CatalogPriceIds,
): BillingIntent {
  if (!invoice) return { kind: "ignored", reason: "unhandled_event_type" };

  // A subscription's status being `active` is not a reason to grant (§29). A
  // *paid invoice* is, and this is that check.
  if (invoice.status !== "paid") return { kind: "ignored", reason: "not_a_paid_period" };

  if (!invoice.billingReason) return { kind: "ignored", reason: "not_a_paid_period" };

  if (!(PAID_PERIOD_BILLING_REASONS as readonly string[]).includes(invoice.billingReason)) {
    return { kind: "ignored", reason: "proration_or_plan_change" };
  }

  const planKey = parsePaidPlanKey(readMetadata(invoice.subscriptionMetadata, VIBE_SKU_METADATA_KEY));
  if (!planKey) return { kind: "ignored", reason: "unknown_sku" };

  const plan = getPlan(planKey);
  const priceCheck = priceMatchesCatalog(catalogPriceIds[planKey], invoice.priceIds);
  if (!priceCheck.ok) return { kind: "ignored", reason: priceCheck.reason };

  // The grant's expiry is the period end, so a missing period cannot be
  // defaulted — a subscription lot with no expiry would silently become a
  // permanent one (§10, §58).
  if (invoice.periodStart === null || invoice.periodEnd === null) {
    return { kind: "ignored", reason: "missing_period" };
  }

  return {
    kind: "grant_subscription_period",
    planKey,
    creditUnits: plan.monthlyCreditUnits,
    idempotencyKey: subscriptionGrantIdempotencyKey(invoice.id),
    externalReference: invoice.id,
    stripeCustomerId: invoice.customerId,
    stripeSubscriptionId: invoice.subscriptionId,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    claimedUserId: readMetadata(invoice.subscriptionMetadata, VIBE_USER_METADATA_KEY),
  };
}

/**
 * A subscription lifecycle change updates the stored snapshot and grants
 * nothing (§29, §33).
 *
 * This is the out-of-order defence. Subscription events carry no payment
 * information and Stripe does not guarantee their order relative to invoices,
 * so treating one as evidence of a paid period would grant Credits on a stale
 * replay. The snapshot exists to show a plan and to stop future grants after
 * cancellation — never to authorize one.
 */
function interpretSubscription(
  subscription: NormalizedSubscription | undefined,
  catalogPriceIds: CatalogPriceIds,
): BillingIntent {
  if (!subscription) return { kind: "ignored", reason: "unhandled_event_type" };

  // Resolved from the charged Price rather than from metadata, so a snapshot
  // still names the right plan even if metadata was never written. Null is an
  // acceptable answer — the snapshot is not a grant, so an unrecognized plan
  // costs nothing and is better recorded than dropped.
  const planKey =
    (["builder", "pro"] as const).find((key) => {
      const configured = catalogPriceIds[key];
      return configured !== undefined && subscription.priceIds.includes(configured);
    }) ?? null;

  return {
    kind: "sync_subscription",
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: subscription.customerId,
    planKey,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    canceledAt: subscription.canceledAt,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    claimedUserId: readMetadata(subscription.metadata, VIBE_USER_METADATA_KEY),
  };
}
