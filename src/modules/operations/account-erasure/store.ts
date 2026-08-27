import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role reads and writes behind account erasure (ADR 0056 §4).
 *
 * Every query here filters on a `userId` the caller took from the persisted
 * operation row, never from an argument that originated outside the server —
 * rule 53's obligation, restated because this module deletes an identity and
 * getting it wrong deletes somebody else's.
 *
 * Nothing in this file decides anything. The order of the eleven steps, and
 * what stops the erasure, live in `execution.ts` where they can be read as one
 * sequence.
 */

/**
 * Whether the account still holds money nobody has finished accounting for.
 *
 * ADR 0056 §10: **deletion is refused while consequential work can still
 * complete, and billing is finalized rather than cancelled by deletion.** An
 * erasure never releases or settles a hold — that authority belongs to the
 * CAS-gated finalizers, and moving it would risk the `charge_without_hold`
 * class four sprints of billing work went into eliminating. So this asks a
 * question and returns an answer; it changes nothing.
 *
 * ## What §4 step 3's second half asks for, and why it is not here
 *
 * Step 3 also says no `billing_stripe_events` claim may be outstanding. That
 * table carries `stripe_event_id`, `event_type`, `livemode` and a status — and
 * **no owner column at all**. A claim therefore cannot be attributed to an
 * account, so the only gate expressible would be "no Stripe event is being
 * processed anywhere, for anybody", which blocks one user's erasure on another
 * user's payment and cannot pass at all under load.
 *
 * It is left out rather than approximated, because what it was protecting
 * against is now covered where it can be covered precisely: a payment event
 * that lands after step 8 finds a tombstoned mapping and refuses as
 * `owner_erased` (ADR 0056 §9, M3′) instead of minting an ownerless wallet, and
 * step 2 has already stopped new ones from being generated. An event landing
 * *before* step 8 grants to an account that is still live, which is correct.
 */
export async function findUnfinalizedHold(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const account = await supabase
    .from("billing_credit_accounts")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (account.error) throw account.error;
  if (!account.data) return false;

  const reservation = await supabase
    .from("billing_credit_reservations")
    .select("id")
    .eq("credit_account_id", (account.data as { id: string }).id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (reservation.error) throw reservation.error;

  return reservation.data !== null;
}

/** Every project this identity owns, oldest first so a retry keeps its order. */
export async function listOwnedProjectIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => (row as { id: string }).id);
}

/**
 * Steps 5 and 6: the free-audit grant and the GitHub identity rows.
 *
 * `github_connections` before `github_installations` because the connection
 * references the installation. The installations are unreferenced by now —
 * step 4 removed every `repository_connections` row with its project — which is
 * precisely what F3's RESTRICT was objecting to.
 */
export async function deleteIdentityRows(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  for (const table of ["free_audit_grants", "github_connections", "github_installations"] as const) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    if (error) throw error;
  }
}

/**
 * Steps 7, 8 and 9: everything that survives with its owner removed.
 *
 * One list rather than three functions, because the rule is one rule — ADR 0056
 * §6's "retained whole or not at all", applied to the billing graph, the Stripe
 * mapping and the metering that priced the charges. `DELETE` is never a legal
 * verb for any of these tables.
 *
 * The metering rows are tombstoned here even though the `on delete set null`
 * from step 11 would reach them anyway. Stating it explicitly means the
 * function's postcondition does not depend on a cascade firing, and a partial
 * erasure re-entered at this step converges to the same state either way.
 */
const TOMBSTONED_TABLES = [
  "billing_credit_accounts",
  "billing_stripe_customers",
  "billing_subscriptions",
  "ai_usage_events",
  "billing_usage_events",
  "review_browser_usage",
  "sandbox_usage_events",
] as const;

export async function tombstoneOwnership(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  for (const table of TOMBSTONED_TABLES) {
    const { error } = await supabase.from(table).update({ user_id: null }).eq("user_id", userId);
    if (error) throw error;
  }
}

/** Step 10: the in-place anonymization, run by the privileged routine (§8). */
export async function scrubAuditMetadata(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("erase_account_audit_metadata", {
    p_user_id: userId,
  });

  if (error) throw error;
  return typeof data === "number" ? data : Number(data ?? 0);
}

/**
 * Step 11: the identity itself.
 *
 * `auth.users` is not reachable through PostgREST, so this is the one write in
 * the erasure that goes through the Admin API rather than the Data API. The
 * outcome is verified by an independent read rather than taken from the call's
 * own response (rule 73), and a user who is already gone is success: the
 * postcondition is "this identity does not exist", not "a deletion happened".
 */
export async function deleteIdentity(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: "identity_delete_failed" }> {
  const { error } = await supabase.auth.admin.deleteUser(userId);

  if (error && error.status !== 404) {
    console.error("[erasure] failed to delete identity", { message: error.message });
    return { ok: false, reason: "identity_delete_failed" };
  }

  const { data, error: readError } = await supabase.auth.admin.getUserById(userId);
  if (readError && readError.status !== 404) return { ok: false, reason: "identity_delete_failed" };
  if (data?.user) return { ok: false, reason: "identity_delete_failed" };

  return { ok: true };
}
