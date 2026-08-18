"use server";

import { redirect } from "next/navigation";
import { hasStripeConfiguration } from "@/lib/env/stripe";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { parseCreditPackKey, parsePaidPlanKey } from "@/modules/billing/catalog";
import {
  startCreditPackCheckout,
  startCustomerPortal,
  startPlanCheckout,
} from "@/modules/billing/checkout";
import { ensureWelcomeGrant } from "@/modules/credits/grants";

/**
 * Billing Server Actions (BILLING CORE-2 §25, §26, §52, §65, §95, §99).
 *
 * ## Every one of these is a POST
 *
 * Financial state is never moved by a page render. Next.js Server Actions are
 * POSTs with built-in origin checks, which is the CSRF protection this
 * repository already relies on everywhere else — no state moves on a GET, and
 * no state moves without a session.
 *
 * ## The browser names a SKU and nothing else
 *
 * Each action reads one form field, narrows it against the approved catalog,
 * and refuses anything that does not match. There is no field for a price, a
 * currency, a Credit amount, a Stripe Price id or a user id — so `credits=500000`
 * and a forged `priceId` have nowhere to land (§23).
 */

export type BillingActionState = { error: string } | null;

/**
 * Customer-safe failure copy (§95).
 *
 * Never a Stripe error, never a database error, never a stack trace. Each says
 * what happened and, where it is true, what to do about it.
 */
const MESSAGES = {
  unavailable: "Payments aren't set up yet. Please try again later.",
  unknown_sku: "That option isn't available.",
  sku_not_configured: "That option isn't available for purchase yet.",
  failed: "We couldn't start checkout. Please try again in a moment.",
  no_customer: "There's nothing to manage yet — buy Credits or start a plan first.",
} as const;

/** Starts Checkout for an approved Credit pack. */
export async function startCreditPackCheckoutAction(
  _previous: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const session = await requireSession();
  if (!hasStripeConfiguration()) return { error: MESSAGES.unavailable };

  const packKey = parseCreditPackKey(formData.get("pack"));
  if (!packKey) return { error: MESSAGES.unknown_sku };

  const supabase = await createClient();

  let destination: string;
  try {
    const result = await startCreditPackCheckout(supabase, {
      userId: session.userId,
      email: session.email ?? null,
      packKey,
    });

    if (!result.ok) {
      return { error: result.refusal === "sku_not_configured" ? MESSAGES.sku_not_configured : MESSAGES.failed };
    }
    destination = result.url;
  } catch {
    // Deliberately swallowing the provider error. A Stripe failure message can
    // carry account and request detail that has no business on a customer's
    // screen or in a log line (§21, §95).
    return { error: MESSAGES.failed };
  }

  // Outside the try: `redirect` signals by throwing, and catching it here would
  // turn a successful checkout into "we couldn't start checkout".
  redirect(destination);
}

/** Starts Checkout for Builder or Pro. */
export async function startPlanCheckoutAction(
  _previous: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const session = await requireSession();
  if (!hasStripeConfiguration()) return { error: MESSAGES.unavailable };

  // `free` is rejected here too: it has no Stripe Price and no Checkout.
  const planKey = parsePaidPlanKey(formData.get("plan"));
  if (!planKey) return { error: MESSAGES.unknown_sku };

  const supabase = await createClient();

  let destination: string;
  try {
    const result = await startPlanCheckout(supabase, {
      userId: session.userId,
      email: session.email ?? null,
      planKey,
    });

    if (!result.ok) {
      return { error: result.refusal === "sku_not_configured" ? MESSAGES.sku_not_configured : MESSAGES.failed };
    }
    destination = result.url;
  } catch {
    return { error: MESSAGES.failed };
  }

  redirect(destination);
}

/** Opens the Stripe Customer Portal for payment methods, invoices and cancellation. */
export async function openBillingPortalAction(
  _previous: BillingActionState,
  _formData: FormData,
): Promise<BillingActionState> {
  const session = await requireSession();
  if (!hasStripeConfiguration()) return { error: MESSAGES.unavailable };

  const supabase = await createClient();

  let destination: string;
  try {
    const result = await startCustomerPortal(supabase, { userId: session.userId });
    if (!result.ok) return { error: MESSAGES.no_customer };
    destination = result.url;
  } catch {
    return { error: MESSAGES.failed };
  }

  redirect(destination);
}

/**
 * Issues the Welcome allowance to an account that predates Billing Core-2 (§6).
 *
 * ## Why this is a button rather than something the page does on load
 *
 * Because the page is a GET, and financial state does not move on a GET (§99).
 * §6 names "create grants on every page load" as a thing not to do, and an
 * idempotent grant attempted on every render is still exactly that.
 *
 * New accounts never see this: their Welcome Credits are issued when they
 * connect their first repository, which is a real server-side provisioning
 * moment. This exists only for accounts that already existed when Core-2
 * shipped, and it disappears the moment it succeeds.
 *
 * Pressing it twice, or a hundred times, issues one grant. The identity is
 * `welcome-credit-v1:<userId>` and the ledger's unique index is what enforces
 * that — not this action, and not the button's disabled state.
 */
export async function claimWelcomeCreditsAction(
  _previous: BillingActionState,
  _formData: FormData,
): Promise<BillingActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  try {
    // Ownership is the session's own user id, never a form field (§65).
    await ensureWelcomeGrant(supabase, { userId: session.userId });
  } catch {
    return { error: MESSAGES.failed };
  }

  redirect("/app/billing");
}
