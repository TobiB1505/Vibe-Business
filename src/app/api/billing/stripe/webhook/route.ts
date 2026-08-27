import { NextResponse, type NextRequest } from "next/server";
import { alertOperator } from "@/lib/observability/alert";
import type Stripe from "stripe";
import { hasStripeConfiguration } from "@/lib/env/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { catalogPriceIds } from "@/modules/billing/checkout";
import { getStripeClient, verifyStripeWebhook } from "@/modules/billing/stripe/client";
import { normalizeStripeEvent, normalizeSubscription } from "@/modules/billing/stripe/normalize";
import { processStripeEvent } from "@/modules/billing/webhook-service";

/**
 * The Stripe webhook (BILLING CORE-2 §27, §28, §66, §67).
 *
 * The only path by which real money becomes Vibe Credits.
 *
 * ## Authentication is the signature, and nothing else
 *
 * There is no session here and there must not be — Stripe is a server, not a
 * browser, and it authenticates by signing the request body with a shared
 * secret. So this endpoint is deliberately unauthenticated in the session sense
 * and completely closed in every other: an unsigned or wrongly-signed request
 * is refused before its body is parsed, let alone believed.
 *
 * There is no environment check, no development bypass and no debug flag that
 * skips verification (§66). A signature check that configuration can disable is
 * an open endpoint that mints Credits.
 *
 * ## Node runtime, raw body
 *
 * `request.text()`, never `request.json()`. Stripe signs the exact bytes it
 * sent; parsing and re-serializing produces an identical object and a different
 * string, and the HMAC no longer matches. That is the single most common cause
 * of a failed signature check and it is a silent one — the payload looks fine.
 */

export const runtime = "nodejs";
// A financial endpoint must never be served from a cache, and must never have
// its response reused for a different event.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!hasStripeConfiguration()) {
    // Nothing is configured, so nothing can be verified. 503 rather than 400:
    // this is Vibe's problem, and Stripe should retry after it is fixed rather
    // than treat the event as permanently rejected.
    return NextResponse.json({ error: "billing_unavailable" }, { status: 503 });
  }

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  const verified = await verifyStripeWebhook({ payload, signature });
  if (!verified.ok) {
    // 400 is correct and deliberate: an unverifiable event is permanently
    // rejected, not retried. The reason is a fixed enum — never the signature,
    // never the payload, never a Stripe error body (§21, §95).
    return NextResponse.json({ error: verified.reason }, { status: 400 });
  }

  const event = verified.event;

  /*
   * Stripe omits `line_items` from webhook payloads, and the catalog check
   * cannot be skipped just because they are inconvenient to obtain (§22): the
   * Price a session actually charged is what proves a purchase corresponds to
   * the SKU it claims. So they are fetched for Checkout events specifically.
   */
  let checkoutPriceIds: string[] = [];
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as { id: string };
    try {
      const lineItems = await getStripeClient().checkout.sessions.listLineItems(session.id, { limit: 100 });
      checkoutPriceIds = lineItems.data.map((item) => item.price?.id).filter((id): id is string => Boolean(id));
    } catch {
      // Could not confirm what was charged, so nothing is granted. Returning
      // 500 lets Stripe retry, which is the safe direction — the alternative is
      // silently dropping a real purchase.
      return NextResponse.json({ error: "line_items_unavailable" }, { status: 500 });
    }
  }

  /*
   * Subscription events are re-fetched live rather than trusted from the
   * webhook payload (§29, §33).
   *
   * Stripe does not guarantee delivery order between two subscription events
   * fired close together — a "cancel at period end" click can produce two
   * `customer.subscription.updated` deliveries whose *payloads* disagree about
   * which one is current, because each is a snapshot from the instant Stripe
   * built it. Trusting whichever payload happens to finish processing last is
   * exactly the out-of-order bug this guards against: it already produced a
   * stored subscription with `canceled_at` set but `cancel_at_period_end`
   * false, a combination Stripe itself never produces.
   *
   * The fix is not to guess which payload is newer. It is to never trust a
   * payload for this at all — a live `retrieve` by id returns Stripe's current
   * truth regardless of which delivery triggered it, so two deliveries for the
   * same subscription now always converge on writing the same, correct row.
   */
  let liveSubscription: Stripe.Subscription | undefined;
  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object as { id: string };
    try {
      liveSubscription = await getStripeClient().subscriptions.retrieve(subscription.id);
    } catch {
      // Could not confirm the subscription's current state, so nothing is
      // synced from a possibly-stale payload. 500 lets Stripe retry.
      return NextResponse.json({ error: "subscription_unavailable" }, { status: 500 });
    }
  }

  const supabase = createServiceClient();

  try {
    const normalized = normalizeStripeEvent(event, checkoutPriceIds);

    const result = await processStripeEvent(supabase, {
      event: liveSubscription
        ? { ...normalized, subscription: normalizeSubscription(liveSubscription) }
        : normalized,
      catalogPriceIds: catalogPriceIds(),
    });

    // 200 for processed, ignored and duplicate alike. All three mean "Vibe has
    // dealt with this event"; a non-2xx would make Stripe retry an event that
    // is already resolved, forever.
    return NextResponse.json({ received: true, status: result.status });
  } catch (error) {
    // Observable, but never in a way that echoes payment data. The event id is
    // safe and is the only thing needed to find the event in Stripe's own
    // dashboard, where the details belong (§68).
    // VB-012 — a webhook that keeps failing is money that was taken and never
    // became Credits, and Stripe gives up retrying eventually.
    await alertOperator("[billing] stripe webhook processing failed", {
      stripeEventId: event.id,
      eventType: event.type,
      error: error instanceof Error ? error.name : "unknown",
    });

    // 500 so Stripe retries. The event's claim was released by the service, so
    // the retry can genuinely re-run rather than being turned away as a
    // duplicate.
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
