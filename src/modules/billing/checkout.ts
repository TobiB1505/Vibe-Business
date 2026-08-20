import "server-only";

import { getAppUrl } from "@/lib/env/app-url";
import { getStripeEnv } from "@/lib/env/stripe";
import { recordAuditEvent } from "@/modules/audit-log/events";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getCreditPack,
  getPlan,
  type CreditPackKey,
  type PaidPlanKey,
} from "./catalog";
import { findStripeCustomerByUser, linkStripeCustomer } from "./store";
import { getStripeClient } from "./stripe/client";
import { VIBE_SKU_METADATA_KEY, VIBE_USER_METADATA_KEY, type CatalogPriceIds } from "./stripe/events";

/**
 * Starting a Stripe Checkout (BILLING CORE-2 §22, §23, §25, §26, §65).
 *
 * ## What the browser is allowed to say
 *
 * One word: a SKU key. `"pack_500"`, or `"builder"`.
 *
 * Everything else — which Stripe Price, which currency, how much money, how
 * many Credits, and which Vibe account it lands in — is resolved on this side
 * from the approved catalog and the authenticated session. There is no
 * parameter on any function here that accepts an amount, a price id, or a user
 * id, so the attacks in §102 (`credits=500000`, a forged `priceId`, another
 * customer's account) have nothing to attach to.
 *
 * ## The success redirect proves nothing (§25, §26)
 *
 * A customer returning to `/success` means their browser followed a redirect.
 * It does not mean Stripe took their money — they may have hit back, the
 * payment may be asynchronous and still pending, or they may simply have typed
 * the URL. So no function in this module grants a Credit, and no Credit is ever
 * granted on the return path. Only a signature-verified webhook does that.
 */

/** The configured Stripe Price ids, read once from server-only configuration. */
export function catalogPriceIds(): CatalogPriceIds {
  const env = getStripeEnv();

  return {
    builder: env.STRIPE_PRICE_BUILDER_MONTHLY,
    pro: env.STRIPE_PRICE_PRO_MONTHLY,
    pack_500: env.STRIPE_PRICE_PACK_500,
    pack_1500: env.STRIPE_PRICE_PACK_1500,
    pack_5000: env.STRIPE_PRICE_PACK_5000,
  };
}

export type CheckoutRefusal =
  /** The SKU exists in the catalog but has no configured Stripe Price yet. */
  | "sku_not_configured"
  /** Stripe is not configured in this deployment at all. */
  | "stripe_not_configured";

export type CheckoutResult = { ok: true; url: string } | { ok: false; refusal: CheckoutRefusal };

/**
 * Finds or creates the one Stripe customer for a Vibe owner (§24).
 *
 * The Vibe user id travels in metadata so a Stripe-side investigation can find
 * its way back — but it is never how ownership is decided on the way in. That
 * is `billing_stripe_customers`, which Vibe wrote itself.
 */
async function resolveStripeCustomerId(
  supabase: SupabaseClient,
  params: { userId: string; email: string | null; livemode: boolean },
): Promise<string> {
  const existing = await findStripeCustomerByUser(supabase, {
    userId: params.userId,
    livemode: params.livemode,
  });
  if (existing) return existing.stripeCustomerId;

  const customer = await getStripeClient().customers.create(
    {
      email: params.email ?? undefined,
      metadata: { [VIBE_USER_METADATA_KEY]: params.userId },
    },
    // Stripe's own idempotency, so a retried creation returns the same customer
    // rather than a second one. Keyed on the Vibe owner, which is exactly the
    // uniqueness Vibe wants (§24).
    { idempotencyKey: `vibe-customer:${params.userId}` },
  );

  const link = await linkStripeCustomer(supabase, {
    userId: params.userId,
    stripeCustomerId: customer.id,
    livemode: params.livemode,
  });

  // A race may have linked a different customer first; that row wins, so one
  // owner never ends up with two customers in Vibe's mapping.
  return link.stripeCustomerId;
}

/**
 * Where Stripe returns the customer, in priority order.
 *
 * `STRIPE_BILLING_RETURN_URL` stays the explicit override it always was —
 * Stripe's own dashboard documentation shows it as a full URL an operator
 * configures once — but its fallback is now this deployment's own resolved
 * origin rather than a hardcoded `localhost`, so a Preview or Production
 * deployment with no `STRIPE_BILLING_RETURN_URL` set returns the customer
 * to itself instead of to a value that only ever worked locally.
 */
export function billingReturnBase(): string {
  const env = getStripeEnv();
  return env.STRIPE_BILLING_RETURN_URL ?? `${getAppUrl()}/app/billing`;
}

function returnUrls(): { success: string; cancel: string } {
  const base = billingReturnBase();

  return {
    // `checkout=complete` tells the page to say "your payment is being
    // confirmed", never to add Credits (§25, §95).
    success: `${base}?checkout=complete`,
    cancel: `${base}?checkout=cancelled`,
  };
}

/**
 * Starts Checkout for a one-time Credit pack (§26).
 *
 * The pack key selects a Price from configuration. The Credit amount is not
 * sent to Stripe at all — it is looked up again from the catalog when the
 * webhook arrives, so nothing that round-trips through a payment provider can
 * decide how many Credits Vibe issues.
 */
export async function startCreditPackCheckout(
  supabase: SupabaseClient,
  params: { userId: string; email: string | null; packKey: CreditPackKey },
): Promise<CheckoutResult> {
  const env = getStripeEnv();
  const pack = getCreditPack(params.packKey);
  const priceId = catalogPriceIds()[params.packKey];

  if (!priceId) return { ok: false, refusal: "sku_not_configured" };

  const customerId = await resolveStripeCustomerId(supabase, {
    userId: params.userId,
    email: params.email,
    livemode: env.livemode,
  });

  const urls = returnUrls();
  const session = await getStripeClient().checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: urls.success,
    cancel_url: urls.cancel,
    // The SKU, not the amount. This is what the webhook reads back, and it is
    // checked against the configured Price before anything is granted (§22).
    metadata: {
      [VIBE_SKU_METADATA_KEY]: params.packKey,
      [VIBE_USER_METADATA_KEY]: params.userId,
    },
  });

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "billing.checkout_started",
    // Identifiers and a SKU. No amount of money, no Price id, no customer
    // detail — a log line is not a payment record (§68).
    metadata: { sku: params.packKey, credits: pack.credits, mode: "payment" },
  });

  return session.url
    ? { ok: true, url: session.url }
    : { ok: false, refusal: "stripe_not_configured" };
}

/**
 * Starts Checkout for a subscription plan (§25).
 *
 * The Vibe owner and the selected plan are written into the **subscription's**
 * metadata rather than only the session's, because the invoice that eventually
 * grants Credits carries a snapshot of subscription metadata — and the invoice,
 * not the session, is what identifies a paid period (§30, §31).
 */
export async function startPlanCheckout(
  supabase: SupabaseClient,
  params: { userId: string; email: string | null; planKey: PaidPlanKey },
): Promise<CheckoutResult> {
  const env = getStripeEnv();
  const plan = getPlan(params.planKey);
  const priceId = catalogPriceIds()[params.planKey];

  if (!priceId) return { ok: false, refusal: "sku_not_configured" };

  const customerId = await resolveStripeCustomerId(supabase, {
    userId: params.userId,
    email: params.email,
    livemode: env.livemode,
  });

  const urls = returnUrls();
  const session = await getStripeClient().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: urls.success,
    cancel_url: urls.cancel,
    metadata: {
      [VIBE_SKU_METADATA_KEY]: params.planKey,
      [VIBE_USER_METADATA_KEY]: params.userId,
    },
    subscription_data: {
      metadata: {
        [VIBE_SKU_METADATA_KEY]: params.planKey,
        [VIBE_USER_METADATA_KEY]: params.userId,
      },
    },
  });

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "billing.checkout_started",
    metadata: { sku: params.planKey, credits: plan.monthlyCreditUnits, mode: "subscription" },
  });

  return session.url
    ? { ok: true, url: session.url }
    : { ok: false, refusal: "stripe_not_configured" };
}

/**
 * Opens the Stripe Customer Portal for payment methods, invoices and
 * cancellation (§35).
 *
 * Deliberately not a plan-switching surface. Mid-cycle upgrade and downgrade
 * economics are not approved — CREDIT_ECONOMICS.md defines no proration Credit
 * policy, and §34 forbids inventing one — so the portal is expected to be
 * configured without plan switching, and Vibe's own webhook refuses to grant on
 * a `subscription_update` invoice regardless of how the portal is configured.
 * The refusal is in code rather than only in a dashboard setting, because a
 * dashboard setting is not a guarantee.
 */
export async function startCustomerPortal(
  supabase: SupabaseClient,
  params: { userId: string },
): Promise<CheckoutResult> {
  const env = getStripeEnv();
  const link = await findStripeCustomerByUser(supabase, {
    userId: params.userId,
    livemode: env.livemode,
  });

  if (!link) return { ok: false, refusal: "sku_not_configured" };

  const session = await getStripeClient().billingPortal.sessions.create({
    customer: link.stripeCustomerId,
    return_url: billingReturnBase(),
  });

  return session.url ? { ok: true, url: session.url } : { ok: false, refusal: "stripe_not_configured" };
}
