import type { Metadata } from "next";
import { hasStripeConfiguration } from "@/lib/env/stripe";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getBillingOverview } from "@/modules/billing/overview";
import { BillingView } from "./billing-view";

/**
 * The customer billing surface (BILLING CORE-2 §49–§53).
 *
 * Assembly only: this resolves the session, reads the overview, and hands both
 * to `BillingView`. The screen itself is a prop-driven component so the browser
 * suite renders the same one the product does, rather than a re-implementation
 * that could agree with the tests and disagree with production.
 *
 * ## Read-only
 *
 * A Server Component render is a GET, and no GET moves financial state (§99).
 * Nothing here grants, expires, reserves or charges; everything that changes
 * anything on this screen is a Server Action POST.
 */

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const session = await requireSession("/app/billing");
  const supabase = await createClient();

  const [overview, params] = await Promise.all([
    getBillingOverview(supabase, { userId: session.userId }),
    searchParams,
  ]);

  return (
    <>
      <BillingView
        overview={overview}
        stripeReady={hasStripeConfiguration()}
        checkoutState={params.checkout}
      />
    </>
  );
}
