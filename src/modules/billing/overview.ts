import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { findNextExpiry } from "@/modules/credits/grants";
import {
  listActiveLots,
  listAllocationsForGrants,
  reconcileAndRepairLotAllocations,
} from "@/modules/credits/lot-store";
import { spendableCapacity } from "@/modules/credits/lots";
import { reconcileAndRepairBalance } from "@/modules/credits/service";
import { findOrphanedHolds } from "@/modules/credits/orphaned-holds";
import { listOperationRunsByIds } from "@/modules/operations/store";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { alertOperator } from "@/lib/observability/alert";
import { findCreditAccountByUser, listActiveReservations, listLedgerEntries } from "@/modules/credits/store";
import { formatCreditsForDisplay, type CreditUnits, ZERO_CREDITS } from "@/modules/credits/units";
import { welcomeGrantIdempotencyKey, type PlanKey } from "./catalog";
import { findActiveSubscription } from "./store";

/**
 * The customer billing read model (BILLING CORE-2 §49–§53, §94).
 *
 * ## The five questions this exists to answer
 *
 * ```
 * How many Credits do I have?
 * What plan am I on?
 * When do my expiring Credits expire?
 * How can I get more?
 * What did I recently spend Credits on?
 * ```
 *
 * And nothing else. There is no lot breakdown, no allocation view, no reserved
 * figure, no provider cost, no token count and no nanodollar — not because
 * they are hidden, but because there is no field here that could carry them
 * (§50, §52). A customer's mental model is "I have Credits and things cost
 * Credits", and the type is shaped to keep it that way.
 *
 * ## Read-only, by construction
 *
 * Every function here reads. The billing page is a Server Component, which is
 * a GET, and a GET must never move financial state (§99) — so nothing in this
 * file grants, expires, reserves or charges. Expiry is *derived* for display
 * from `expiresAt` rather than swept, which is why a lapsed lot is already
 * excluded from the balance shown here whether or not a sweep has run.
 */

/* ---------------------------------------------------------------------------
 * Activity
 * ------------------------------------------------------------------------ */

/**
 * One line of Credit history, in the customer's language (§53, §94).
 *
 * `label` is human text, never a raw enum. "Business Audit", not
 * `operation_type=business_audit`; "Credits expired", not
 * `kind=expiry, source_kind=welcome`.
 */
export type CreditActivityEntry = {
  id: string;
  label: string;
  /** Signed, in credit units. Negative for a charge or an expiry. */
  creditDelta: CreditUnits;
  /** Already formatted for display, e.g. `"-35"`. */
  displayAmount: string;
  at: string;
};

/**
 * Human labels for what moved a balance.
 *
 * Deliberately coarse. A customer needs to recognize the line, not audit it —
 * "Business Audit · -35" is the whole requirement, and a more precise label
 * would mean exposing the internal vocabulary §94 forbids.
 */
const LEDGER_LABELS: Record<string, string> = {
  grant: "Credits added",
  purchase: "Credit purchase",
  charge: "Credits used",
  refund: "Refund",
  adjustment: "Adjustment",
  expiry: "Credits expired",
};

/**
 * Operation labels, keyed by the retail policy's own operation names.
 *
 * A charge records which operation it paid for through its reservation, and
 * this is where that becomes a sentence a founder recognizes.
 */
const OPERATION_LABELS: Record<string, string> = {
  business_audit: "Business Audit",
  opportunity_generation: "Next moves",
  action_plan: "Action Plan",
};

export type BillingPlanView = {
  key: PlanKey;
  name: string;
  /** Present only when a paid subscription is live. */
  renewsAt: string | null;
  /** True when the customer has asked to stop at the end of the period. */
  endingAtPeriodEnd: boolean;
};

export type BillingOverview = {
  /** Credits that can fund new work right now. The only number §50 shows. */
  availableCredits: CreditUnits;
  /** Already formatted, e.g. `"2,480"`. */
  displayAvailable: string;
  /** The next tranche to lapse, when one exists (§50). */
  nextExpiry: { credits: CreditUnits; displayCredits: string; expiresAt: string } | null;
  plan: BillingPlanView;
  recentActivity: CreditActivityEntry[];
  /**
   * Whether this account has ever received its Welcome allowance.
   *
   * Drives the one-time reconciliation affordance for accounts that existed
   * before Billing Core-2 (§6). New accounts are granted at project connect and
   * never see it.
   */
  welcomeGranted: boolean;
};

/**
 * Thousands separators, so a four-digit balance is readable at a glance.
 *
 * Moved to `credits/units.ts` so every customer-facing surface groups the same
 * way — the audit's credit notice used the ungrouped formatter and printed
 * "6080" beside this page's "6,080". Re-exported under the old local name so
 * this file reads unchanged.
 */
const formatCredits = formatCreditsForDisplay;

/**
 * Everything the billing page renders, in one pass.
 *
 * Returns a zero-balance Free view for an account with no wallet yet rather
 * than null: "you have 0 Credits and you're on Free" is true and renderable,
 * and a null would make the page handle a state that is not actually special.
 */
export async function getBillingOverview(
  supabase: SupabaseClient,
  params: { userId: string; now?: Date; activityLimit?: number },
): Promise<BillingOverview> {
  const now = params.now ?? new Date();
  const limit = params.activityLimit ?? 8;

  const account = await findCreditAccountByUser(supabase, params.userId);
  const subscription = await findActiveSubscription(supabase, params.userId);

  const plan: BillingPlanView = subscription
    ? {
        key: subscription.planKey,
        name: subscription.planKey === "pro" ? "Pro" : "Builder",
        renewsAt: subscription.currentPeriodEnd,
        endingAtPeriodEnd: subscription.cancelAtPeriodEnd,
      }
    : { key: "free", name: "Free", renewsAt: null, endingAtPeriodEnd: false };

  if (!account) {
    return {
      availableCredits: ZERO_CREDITS,
      displayAvailable: "0",
      nextExpiry: null,
      plan,
      recentActivity: [],
      welcomeGranted: false,
    };
  }

  const [lots, entries, expiry, reservations] = await Promise.all([
    listActiveLots(supabase, account.id),
    listLedgerEntries(supabase, account.id),
    findNextExpiry(supabase, account.id, now),
    listActiveReservations(supabase, account.id),
  ]);

  /*
   * Reconciliation and, when enabled, repair — for both materialized caches
   * this page's own numbers ultimately rest on (ADR 0042 §P3).
   *
   * This is the one place a customer deliberately looks at their balance, so
   * it is the read the ADR's own doctrine names as the trigger: repair fires
   * from a read a caller was already making, never from a schedule. Run
   * concurrently — neither reconciliation depends on the other's outcome —
   * and only the lot result is consumed further: `availableCredits` below is
   * derived from lots, never from the account's posted/reserved cache, so
   * correcting the account side here is a side effect (drift detection, the
   * audit trail, the underlying row) rather than something this page's own
   * return value needs.
   */
  const allocationsByGrant = await listAllocationsForGrants(supabase, lots.map((lot) => lot.id));

  const [lotReconciliation] = await Promise.all([
    reconcileAndRepairLotAllocations(supabase, { lots, allocationsByGrant, userId: params.userId }),
    reconcileAndRepairBalance(supabase, {
      account,
      entries: entries.map((entry) => ({ kind: entry.kind, creditDelta: entry.creditDelta })),
      reservations: reservations.map((reservation) => ({ reservedCredits: reservation.reservedCredits })),
      userId: params.userId,
    }),
    reportOrphanedHolds(supabase, { account, reservations, userId: params.userId, now }),
  ]);

  /*
   * Spendable capacity, not `posted - reserved` (§50).
   *
   * The two differ by any lot that has lapsed but not yet been swept, and this
   * is the honest one: it is exactly what a new operation could actually use.
   * Showing the posted figure would promise Credits that a reservation would
   * then refuse — the worst possible disagreement between a number and a
   * button. Computed from `lotReconciliation.lots`, not the raw `lots` read
   * above, so a repair this same call just made is reflected immediately.
   */
  const availableCredits = spendableCapacity(lotReconciliation.lots, now);

  const welcomeKey = welcomeGrantIdempotencyKey(params.userId);
  const welcomeGranted = entries.some((entry) => entry.idempotencyKey === welcomeKey);

  return {
    availableCredits,
    displayAvailable: formatCredits(availableCredits),
    nextExpiry: expiry
      ? {
          credits: expiry.credits,
          displayCredits: formatCredits(expiry.credits),
          expiresAt: expiry.expiresAt,
        }
      : null,
    plan,
    recentActivity: entries.slice(0, limit).map(toActivityEntry),
    welcomeGranted,
  };
}

function toActivityEntry(entry: {
  id: string;
  kind: string;
  creditDelta: CreditUnits;
  createdAt: string;
  operationRunId: string | null;
  rateCardVersion: string | null;
}): CreditActivityEntry {
  return {
    id: entry.id,
    label: LEDGER_LABELS[entry.kind] ?? "Credits",
    creditDelta: entry.creditDelta,
    displayAmount: `${entry.creditDelta > 0 ? "+" : ""}${formatCredits(entry.creditDelta)}`,
    at: entry.createdAt,
  };
}

/**
 * The balance alone, for the app-shell indicator (§54).
 *
 * A separate, deliberately minimal query: the header renders on every
 * signed-in page, and it must not pull a ledger history to draw one number
 * (§100). Reads the account row and its active lots, and nothing else.
 */
export async function getHeaderCreditBalance(
  supabase: SupabaseClient,
  params: { userId: string; now?: Date },
): Promise<{ availableCredits: CreditUnits; display: string } | null> {
  const account = await findCreditAccountByUser(supabase, params.userId);
  if (!account) return null;

  const lots = await listActiveLots(supabase, account.id);
  const availableCredits = spendableCapacity(lots, params.now ?? new Date());

  return { availableCredits, display: formatCredits(availableCredits) };
}

/** Exported for the activity view's tests, which pin the customer-facing labels. */
export const CREDIT_ACTIVITY_LABELS = { ledger: LEDGER_LABELS, operation: OPERATION_LABELS };

/**
 * Notices a Credit hold still standing over an operation that has finished
 * (VB-020).
 *
 * On the same read, and for the same reason, as the two reconciliations above:
 * this is the one place a customer deliberately looks at their balance, so it
 * is where an unspendable hold is worth noticing. Before this, the only thing
 * that could see one was a SQL query in a deployment checklist — run during an
 * activation and never again.
 *
 * It reports and does not repair, deliberately. What is owed differs by how the
 * operation ended, and only one of the two is performable from here — see
 * `credits/orphaned-holds.ts`. An automatic release for a *completed*
 * operation would refund work the customer received.
 *
 * Never throws into the page. A detector that can take down the billing screen
 * is worse than the condition it detects, and a customer who cannot see their
 * balance because something noticed a stuck hold is strictly worse off.
 */
async function reportOrphanedHolds(
  supabase: SupabaseClient,
  params: {
    account: { id: string };
    reservations: readonly { id: string; operationRunId: string | null; reservedCredits: CreditUnits }[];
    userId: string;
    now: Date;
  },
): Promise<void> {
  try {
    const operationIds = params.reservations
      .map((reservation) => reservation.operationRunId)
      .filter((id): id is string => id !== null);

    if (operationIds.length === 0) return;

    const operations = await listOperationRunsByIds(supabase, operationIds);
    const orphaned = findOrphanedHolds({
      reservations: params.reservations,
      operations: operations.map((operation) => ({
        id: operation.id,
        operationType: operation.operationType,
        status: operation.status,
        completedAt: operation.completedAt,
      })),
      now: params.now,
    });

    if (orphaned.length === 0) return;

    await alertOperator("[billing] credit holds are outliving their operations", {
      creditAccountId: params.account.id,
      orphanedCount: orphaned.length,
    });

    for (const hold of orphaned) {
      await recordAuditEvent(supabase, {
        userId: params.userId,
        eventType: "credit_hold.orphaned",
        metadata: {
          creditAccountId: params.account.id,
          reservationId: hold.reservationId,
          operationId: hold.operationId,
          operationType: hold.operationType,
          status: hold.operationStatus,
          reservedCredits: hold.reservedCredits,
          durationMs: hold.durationMs,
          owed: hold.owed,
        },
      });
    }
  } catch (error) {
    console.error("[billing] the orphaned-hold detector failed", { error });
  }
}
