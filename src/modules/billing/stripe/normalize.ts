import type Stripe from "stripe";
import type {
  NormalizedCheckoutSession,
  NormalizedInvoice,
  NormalizedStripeEvent,
  NormalizedSubscription,
} from "./events";

/**
 * Stripe SDK objects → the plain shapes `events.ts` reasons about
 * (BILLING CORE-2 §19, §29).
 *
 * The whole point of this file is that every field-location decision Stripe's
 * API version imposes lives *here*, in one adapter, rather than being scattered
 * through the billing rules. When Stripe next moves a field, this is the file
 * that changes and the decision logic does not.
 *
 * Two such decisions are already load-bearing, and both were verified against
 * `stripe@22.5.0`'s own type definitions for API version `2026-07-29.dahlia`
 * rather than from recollection:
 *
 * - The subscription for an invoice is
 *   `invoice.parent.subscription_details.subscription`. `invoice.subscription`
 *   was removed in `2025-03-31.basil`.
 * - A subscription's current period lives on its **items**
 *   (`subscription.items.data[].current_period_start` / `_end`), not on the
 *   subscription. Those fields were removed from the subscription in the same
 *   release.
 *
 * Both would have read `undefined` rather than failing, and `undefined` flowing
 * into a grant expiry is a subscription lot that never expires. Reading them
 * from the wrong place is not a crash; it is a silent commercial error, which
 * is why they are pinned here with the reasoning attached.
 */

/** Stripe returns `string | Object | null` for every expandable field. */
function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function metadataOf(metadata: Stripe.Metadata | null | undefined): Record<string, string> {
  if (!metadata) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Checkout Session
 * ------------------------------------------------------------------------ */

/**
 * @param lineItemPriceIds Price ids from an expanded `line_items`, which
 * Stripe does not include on a webhook payload by default. The caller fetches
 * them; passing them in keeps this function total rather than async.
 */
export function normalizeCheckoutSession(
  session: Stripe.Checkout.Session,
  lineItemPriceIds: readonly string[],
): NormalizedCheckoutSession {
  return {
    id: session.id,
    mode: session.mode,
    paymentStatus: session.payment_status,
    customerId: idOf(session.customer),
    subscriptionId: idOf(session.subscription),
    metadata: metadataOf(session.metadata),
    priceIds: [...lineItemPriceIds],
  };
}

/* ---------------------------------------------------------------------------
 * Invoice
 * ------------------------------------------------------------------------ */

/**
 * The subscription an invoice belongs to.
 *
 * `invoice.parent.subscription_details.subscription` under `basil` and later.
 * A quote-generated invoice has a `parent` of a different type and correctly
 * yields null.
 */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  if (!parent || parent.type !== "subscription_details") return null;
  return idOf(parent.subscription_details?.subscription);
}

function invoiceSubscriptionMetadata(invoice: Stripe.Invoice): Record<string, string> {
  const parent = invoice.parent;
  if (!parent || parent.type !== "subscription_details") return {};

  const details = parent.subscription_details;
  if (!details) return {};

  // Stripe snapshots subscription metadata onto the invoice at finalization,
  // which is the value that matters: it describes the subscription as it was
  // when this period was billed, not as it is now.
  const snapshot = metadataOf(details.metadata);
  if (Object.keys(snapshot).length > 0) return snapshot;

  // Falls back to the expanded subscription's live metadata when the snapshot
  // is absent — it is only populated for invoices created after June 2023.
  return typeof details.subscription === "object" && details.subscription !== null
    ? metadataOf(details.subscription.metadata)
    : {};
}

/**
 * The period an invoice actually paid for, taken from its line items.
 *
 * The invoice's own lines are the authority here rather than the subscription's
 * current period: a renewal invoice may be processed after the subscription has
 * already rolled forward, and the grant must expire at the end of the period
 * *this payment bought*, not whichever period happens to be current when the
 * webhook is handled. That is the out-of-order guarantee (§29) expressed as a
 * field choice.
 *
 * Widest span across the lines, so a multi-line invoice yields the period the
 * customer actually paid to cover.
 */
function invoicePeriod(invoice: Stripe.Invoice): { start: number | null; end: number | null } {
  const lines = invoice.lines?.data ?? [];
  let start: number | null = null;
  let end: number | null = null;

  for (const line of lines) {
    const period = line.period;
    if (!period) continue;
    if (start === null || period.start < start) start = period.start;
    if (end === null || period.end > end) end = period.end;
  }

  return { start, end };
}

function invoicePriceIds(invoice: Stripe.Invoice): string[] {
  const ids = new Set<string>();

  for (const line of invoice.lines?.data ?? []) {
    const price = line.pricing?.price_details?.price;
    if (typeof price === "string" && price.length > 0) ids.add(price);
  }

  return [...ids];
}

export function normalizeInvoice(invoice: Stripe.Invoice): NormalizedInvoice {
  const period = invoicePeriod(invoice);

  return {
    // Stripe types `Invoice.id` as optional because a preview invoice has none.
    // A preview never reaches a webhook, and an empty id would produce an
    // idempotency key that collides with every other id-less invoice — so it is
    // normalized to a value that cannot be mistaken for a real one and is
    // refused downstream.
    id: invoice.id ?? "",
    status: invoice.status ?? "",
    billingReason: invoice.billing_reason ?? null,
    customerId: idOf(invoice.customer),
    subscriptionId: invoiceSubscriptionId(invoice),
    periodStart: period.start,
    periodEnd: period.end,
    priceIds: invoicePriceIds(invoice),
    subscriptionMetadata: invoiceSubscriptionMetadata(invoice),
  };
}

/* ---------------------------------------------------------------------------
 * Subscription
 * ------------------------------------------------------------------------ */

/**
 * The current period, read from the subscription's items.
 *
 * Removed from the subscription itself in `2025-03-31.basil`. Widest span
 * across items, which for Vibe's single-item subscriptions is simply that
 * item's period.
 */
function subscriptionPeriod(subscription: Stripe.Subscription): {
  start: number | null;
  end: number | null;
} {
  let start: number | null = null;
  let end: number | null = null;

  for (const item of subscription.items?.data ?? []) {
    if (typeof item.current_period_start === "number") {
      if (start === null || item.current_period_start < start) start = item.current_period_start;
    }
    if (typeof item.current_period_end === "number") {
      if (end === null || item.current_period_end > end) end = item.current_period_end;
    }
  }

  return { start, end };
}

export function normalizeSubscription(subscription: Stripe.Subscription): NormalizedSubscription {
  const period = subscriptionPeriod(subscription);

  const priceIds = new Set<string>();
  for (const item of subscription.items?.data ?? []) {
    if (item.price?.id) priceIds.add(item.price.id);
  }

  return {
    id: subscription.id,
    customerId: idOf(subscription.customer),
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    canceledAt: subscription.canceled_at ?? null,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    priceIds: [...priceIds],
    metadata: metadataOf(subscription.metadata),
  };
}

/* ---------------------------------------------------------------------------
 * Event
 * ------------------------------------------------------------------------ */

/**
 * Maps a verified Stripe event to the shape the decision logic consumes.
 *
 * @param checkoutLineItemPriceIds Price ids for a Checkout Session event, which
 * the caller must fetch separately — Stripe omits `line_items` from webhook
 * payloads, and the catalog check in `events.ts` cannot be skipped just because
 * they are inconvenient to obtain (§22).
 */
export function normalizeStripeEvent(
  event: Stripe.Event,
  checkoutLineItemPriceIds: readonly string[] = [],
): NormalizedStripeEvent {
  const base = { id: event.id, type: event.type, livemode: event.livemode };
  const object = event.data.object as { object?: string };

  switch (object?.object) {
    case "checkout.session":
      return {
        ...base,
        checkoutSession: normalizeCheckoutSession(
          event.data.object as Stripe.Checkout.Session,
          checkoutLineItemPriceIds,
        ),
      };
    case "invoice":
      return { ...base, invoice: normalizeInvoice(event.data.object as Stripe.Invoice) };
    case "subscription":
      return { ...base, subscription: normalizeSubscription(event.data.object as Stripe.Subscription) };
    default:
      return base;
  }
}
