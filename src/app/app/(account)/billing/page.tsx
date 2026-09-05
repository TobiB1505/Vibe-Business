import type { Metadata } from "next";
import { hasStripeConfiguration } from "@/lib/env/stripe";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getBillingOverview } from "@/modules/billing/overview";
import { listAuditEventsForAccount } from "@/modules/audit-log/queries";
import { buildActivityFeed } from "@/modules/audit-log/view";
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

  const [overview, params, accountActivity] = await Promise.all([
    getBillingOverview(supabase, { userId: session.userId }),
    searchParams,
    /*
     * The account's own record (audit R24).
     *
     * `audit_events` is written per user, and the rows with no project — a
     * Credit purchase, a GitHub account connected or disconnected — could not
     * be read by the project-scoped query, which filters on exactly the column
     * they have nothing in. They were written and displayed nowhere.
     */
    listAuditEventsForAccount(supabase, { userId: session.userId }),
  ]);

  return (
    <>
      <BillingView
        overview={overview}
        stripeReady={hasStripeConfiguration()}
        checkoutState={params.checkout}
        accountActivity={buildActivityFeed(accountActivity.events)}
      />
    </>
  );
}
