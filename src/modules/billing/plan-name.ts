import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlan } from "@/modules/billing/catalog";
import { findActiveSubscription } from "@/modules/billing/store";

/**
 * What plan this account is on, as one customer-facing word (UI-14).
 *
 * ## Why the rail needs its own function for this
 *
 * `getBillingOverview` answers the same question and eleven others — the
 * wallet, its active lots, the next expiry, the monthly allowance, the recent
 * activity. The rail renders on every signed-in screen, and a frame is not a
 * place to pay for a page. This is the one subscription row and nothing else.
 *
 * ## Why a failure is `Free` rather than nothing
 *
 * Because that is what the absence of a live subscription means, and it is the
 * same answer `getBillingOverview` gives for it. A read that fails is a
 * different fact, and the honest thing there would be to say nothing — but a
 * badge that sometimes vanishes teaches a founder that the plan is something
 * the product is unsure about. The failure is swallowed to the true default
 * and the account's real plan remains one click away on Billing, which reads
 * it properly.
 */
export async function activePlanName(supabase: SupabaseClient, userId: string): Promise<string> {
  try {
    const subscription = await findActiveSubscription(supabase, userId);
    return getPlan(subscription?.planKey ?? "free").name;
  } catch {
    return getPlan("free").name;
  }
}
