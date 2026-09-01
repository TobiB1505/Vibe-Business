import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { findNextExpiry } from "@/modules/credits/grants";
import {
  listActiveLots,
  listAllocationsForGrants,
  reconcileAndRepairLotAllocations,
} from "@/modules/credits/lot-store";
import { remainingCapacity, spendableCapacity, spendableLots, type CreditLot } from "@/modules/credits/lots";
import { reconcileAndRepairBalance } from "@/modules/credits/service";
import { findOrphanedHolds } from "@/modules/credits/orphaned-holds";
import { listOperationRunsByIds } from "@/modules/operations/store";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { alertOperator } from "@/lib/observability/alert";
import {
  findCreditAccountByUser,
  listActiveReservations,
  hasLedgerEntryWithKey,
  listLedgerEntries,
  listReservationsByIds,
  sumLedgerDeltas,
  type LedgerEntry,
} from "@/modules/credits/store";
import {
  creditUnits,
  formatCreditsForDisplay,
  type CreditUnits,
  ZERO_CREDITS,
} from "@/modules/credits/units";
import { DEEP_SCAN_RESERVATION_PREFIX } from "@/modules/authenticated-product-intelligence/billing";
import { GRANT_KEY_PREFIXES, welcomeGrantIdempotencyKey, type PlanKey } from "./catalog";
import { findActiveSubscription } from "./store";

/**
 * The customer billing read model (BILLING CORE-2 §49–§53, §94).
 *
 * ## The questions this exists to answer
 *
 * ```
 * How many Credits do I have?
 * How much of my included monthly allowance is left, and when does it renew?
 * Is anything holding Credits right now?
 * What plan am I on?
 * When do my expiring Credits expire?
 * How can I get more?
 * What did I recently spend Credits on?
 * ```
 *
 * And nothing else. There is no lot breakdown, no allocation view, no provider
 * cost, no token count and no nanodollar — not because they are hidden, but
 * because there is no field here that could carry them (§50, §52). A customer's
 * mental model is "I have Credits and things cost Credits", and the type is
 * shaped to keep it that way.
 *
 * `reservedCredits` is the one figure that comes close to the line, and it is
 * here because of what a customer sees without it: a balance lower than their
 * own history explains, with nothing on the page accounting for the difference.
 * It is reported as *Credits held by work that is running*, never as a
 * reservation, an allocation or a hold — the fact is the customer's, the
 * vocabulary is not.
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
 * The label a movement falls back to when nothing more specific resolves.
 *
 * Deliberately coarse, and deliberately still here. Everything below tries to
 * name *what the Credits were for*; this is what remains true when that fails —
 * a charge whose operation row has been erased, a manual adjustment, a grant
 * from a source that predates the key prefixes. A vague label that is true
 * beats a specific one that was guessed.
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
 * What a charge bought, in the words the rest of the product uses.
 *
 * Keyed by `operation_runs.operation_type`, and matching the names on the
 * billing page's own price table — the point of the line is that a founder can
 * put "Business Audit · -35" next to "Business Audit · 35 Credits" and see the
 * same two words.
 *
 * ## Why this was dead code until now
 *
 * It existed, exported "for the activity view's tests", and no renderer ever
 * called it: every charge went through {@link LEDGER_LABELS} and came out as
 * "Credits used". The browser fixtures meanwhile said "Agent improvement", so
 * the suite asserted a label production could not produce — rule 69's failure
 * mode running backwards, a screen *less* honest than the test of it.
 *
 * Only operations a customer actually pays for are listed. An operation type
 * absent here has no customer-facing name because it has no customer-facing
 * price, and it falls back rather than inventing one.
 */
const OPERATION_LABELS: Record<string, string> = {
  business_audit: "Business Audit",
  opportunity_generation: "Next moves",
  action_plan: "Action Plan",
  agent_execution: "Agent improvement",
};

/** The one paid operation with no `operation_runs` row to read a name from. */
const DEEP_SCAN_LABEL = "Deep Scan";

/**
 * Where added Credits came from, by the key that wrote them.
 *
 * A `grant` row records an amount and an idempotency key and no source kind, so
 * this is the only thing that separates "your plan renewed" from "you bought a
 * pack" — a distinction a customer reading their history plainly cares about,
 * and the difference between one meaningful line and three identical ones.
 *
 * Prefix order matters only in that it must not be ambiguous; the three
 * prefixes in `GRANT_KEY_PREFIXES` share no common start.
 */
const GRANT_LABELS: readonly { prefix: string; label: string }[] = [
  { prefix: GRANT_KEY_PREFIXES.subscription, label: "Monthly Credits" },
  { prefix: GRANT_KEY_PREFIXES.topUp, label: "Credit Pack" },
  { prefix: GRANT_KEY_PREFIXES.welcome, label: "Welcome Credits" },
];

export type BillingPlanView = {
  key: PlanKey;
  name: string;
  /** Present only when a paid subscription is live. */
  renewsAt: string | null;
  /** True when the customer has asked to stop at the end of the period. */
  endingAtPeriodEnd: boolean;
};

/**
 * What this month's included Credits have left in them.
 *
 * ## Why "remaining" and not "used"
 *
 * Because a lot's `allocatedCreditUnits` merges two different things — Credits
 * already charged, and Credits a *live reservation* is holding — and there is
 * no third figure that separates them per lot. "540 of 3,000 used" would
 * therefore count an agent run that is still running as spent: the number would
 * jump when the run started and then not move when it settled, which is a
 * billing screen telling a customer something happened that did not.
 *
 * `remaining` conflates nothing. It is exactly what {@link spendableCapacity}
 * would fund out of this lot, and what is held rather than spent is reported
 * separately as {@link BillingOverview.reservedCredits}.
 *
 * Null on Free, and null for a subscriber whose period lot has lapsed — in both
 * cases there is no monthly allowance to be a fraction of.
 */
export type MonthlyAllowanceView = {
  remaining: CreditUnits;
  initial: CreditUnits;
  displayRemaining: string;
  displayInitial: string;
};

export type BillingOverview = {
  /** Credits that can fund new work right now. The only number §50 shows. */
  availableCredits: CreditUnits;
  /** Already formatted, e.g. `"2,480"`. */
  displayAvailable: string;
  /**
   * Credits held by work that is still running, when there is any.
   *
   * Already excluded from `availableCredits` — a hold reduces what a new
   * operation can use, which is the whole point of one. Surfaced separately
   * only so that a balance which dropped without a charge appearing in the
   * history has a visible explanation, and shown on the page only when it is
   * non-zero: a permanent "0 Credits reserved" line teaches a customer about
   * reservations, which is precisely what §52 says not to do.
   */
  reservedCredits: CreditUnits;
  displayReserved: string;
  /** The next tranche to lapse, when one exists (§50). */
  nextExpiry: { credits: CreditUnits; displayCredits: string; expiresAt: string } | null;
  /** This subscription period's included Credits. Null when there is no plan. */
  monthlyAllowance: MonthlyAllowanceView | null;
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

  /*
   * Two independent questions, asked together (PERF-017).
   *
   * Neither read needs the other's answer, and they were sequential only
   * because they were written on consecutive lines. An account that does not
   * exist yet pays for one subscription read it will not use — a state that
   * ends the moment anything charges the wallet, and cheaper than a round trip
   * on every render for everyone else.
   */
  const [account, subscription] = await Promise.all([
    findCreditAccountByUser(supabase, params.userId),
    findActiveSubscription(supabase, params.userId),
  ]);

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
      reservedCredits: ZERO_CREDITS,
      displayReserved: "0",
      nextExpiry: null,
      monthlyAllowance: null,
      plan,
      recentActivity: [],
      welcomeGranted: false,
    };
  }

  const welcomeKey = welcomeGrantIdempotencyKey(params.userId);

  const [lots, entries, postedFromLedger, expiry, reservations, welcomeGranted] = await Promise.all([
    listActiveLots(supabase, account.id),
    // What the page *shows*: the most recent movements, capped (VB-025).
    listLedgerEntries(supabase, account.id),
    // What reconciliation *needs*: one number over the whole ledger. Two reads
    // now, because they were always two questions — and asking both of them
    // with one unbounded transfer is what made this page degrade with age.
    sumLedgerDeltas(supabase, account.id),
    findNextExpiry(supabase, account.id, now),
    listActiveReservations(supabase, account.id),
    // Asked of the database rather than derived from `entries`, which is
    // capped and newest-first while this row is the oldest one an account has.
    hasLedgerEntryWithKey(supabase, account.id, welcomeKey),
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
      postedFromLedger,
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

  /*
   * What live work is holding, from the reservations this call already read.
   *
   * They were fetched for `reconcileAndRepairBalance` and then discarded. One
   * sum over an array in memory is the entire cost of answering "why is my
   * balance lower than my history explains?".
   */
  const reservedCredits = creditUnits(
    reservations.reduce((total, reservation) => total + reservation.reservedCredits, 0),
  );

  const shown = entries.slice(0, limit);

  return {
    availableCredits,
    displayAvailable: formatCredits(availableCredits),
    reservedCredits,
    displayReserved: formatCredits(reservedCredits),
    nextExpiry: expiry
      ? {
          credits: expiry.credits,
          displayCredits: formatCredits(expiry.credits),
          expiresAt: expiry.expiresAt,
        }
      : null,
    monthlyAllowance: monthlyAllowance(lotReconciliation.lots, now),
    plan,
    recentActivity: await describeActivity(supabase, shown),
    welcomeGranted,
  };
}

/**
 * This period's included Credits, from the subscription lot funding them.
 *
 * A subscription grant is written per invoice and expires at the period end, so
 * at most one is spendable at any instant — which is what makes "of 3,000" a
 * fact rather than a sum over an unknown number of tranches. Two would mean a
 * grant outlived its period, and taking the newest is the honest reading of
 * that: it is the one the customer is currently inside.
 *
 * Purchased packs are deliberately not counted. They are not part of a monthly
 * allowance and adding them would make the denominator move when somebody
 * topped up.
 */
function monthlyAllowance(lots: readonly CreditLot[], now: Date): MonthlyAllowanceView | null {
  const subscriptionLots = spendableLots(lots, now)
    .filter((lot) => lot.sourceKind === "subscription")
    .sort((a, b) => Date.parse(b.grantedAt) - Date.parse(a.grantedAt));

  const lot = subscriptionLots[0];
  if (!lot) return null;

  const remaining = remainingCapacity(lot);

  return {
    remaining,
    initial: lot.initialCreditUnits,
    displayRemaining: formatCredits(remaining),
    displayInitial: formatCredits(lot.initialCreditUnits),
  };
}

/**
 * Names each movement, in as few reads as the names require.
 *
 * ## The rule every branch obeys
 *
 * A label is *resolved* from a record or it is not claimed. Nothing here
 * guesses from an amount, from a position in the list, or from what an entry
 * probably was — an activity line is the only account a customer will ever get
 * of where their Credits went, and a plausible wrong label is worse than a
 * vague right one. Unresolved falls back to {@link LEDGER_LABELS}.
 *
 * ## Two reads, both batched, both over the rows actually displayed
 *
 * Charges name their operation through `operation_runs`. Deep Scan is the one
 * paid operation with no row there — it is not a durable operation and
 * `credits/store.ts` records `operationRunId: null` for it deliberately — so
 * its reservations are read instead and matched on the prefix that identifies
 * them. Grants and purchases need no read at all: the key that wrote them
 * already says where they came from.
 *
 * ## Never fails the page
 *
 * Same reasoning as `reportOrphanedHolds` below, and it matters more here
 * because this runs on the happy path: if naming a charge throws, the customer
 * loses their *balance* — the one thing they opened this page for — to a lookup
 * that only decorates it. So both reads degrade to no records, every line falls
 * back to {@link LEDGER_LABELS}, and the history renders in the vaguer
 * vocabulary rather than not at all.
 */
async function describeActivity(
  supabase: SupabaseClient,
  entries: readonly LedgerEntry[],
): Promise<CreditActivityEntry[]> {
  const operationIds = [
    ...new Set(
      entries
        .filter((entry) => entry.kind === "charge" && entry.operationRunId !== null)
        .map((entry) => entry.operationRunId as string),
    ),
  ];

  const reservationIds = [
    ...new Set(
      entries
        .filter((entry) => entry.kind === "charge" && entry.operationRunId === null)
        .map((entry) => entry.reservationId)
        .filter((id): id is string => id !== null),
    ),
  ];

  const [operations, reservations] = await Promise.all([
    listOperationRunsByIds(supabase, operationIds).catch(namingFailed("operation_runs")),
    listReservationsByIds(supabase, reservationIds).catch(namingFailed("reservations")),
  ]);

  const operationTypeById = new Map(operations.map((run) => [run.id, run.operationType]));
  const reservationKeyById = new Map(reservations.map((held) => [held.id, held.idempotencyKey]));

  return entries.map((entry) => toActivityEntry(entry, { operationTypeById, reservationKeyById }));
}

/** Logs, then yields nothing to name entries with. Never rethrows. */
function namingFailed(source: string): (error: unknown) => never[] {
  return (error: unknown) => {
    console.error("[billing] could not name recent Credit activity", { source, error });
    return [];
  };
}

/** The label for one entry, or null when nothing in the record names it. */
function resolveLabel(
  entry: LedgerEntry,
  records: {
    operationTypeById: ReadonlyMap<string, string>;
    reservationKeyById: ReadonlyMap<string, string>;
  },
): string | null {
  if (entry.kind === "charge") {
    if (entry.operationRunId !== null) {
      const operationType = records.operationTypeById.get(entry.operationRunId);
      return operationType ? (OPERATION_LABELS[operationType] ?? null) : null;
    }

    const key = entry.reservationId ? records.reservationKeyById.get(entry.reservationId) : undefined;
    return key?.startsWith(DEEP_SCAN_RESERVATION_PREFIX) ? DEEP_SCAN_LABEL : null;
  }

  if (entry.kind === "grant" || entry.kind === "purchase") {
    return GRANT_LABELS.find(({ prefix }) => entry.idempotencyKey.startsWith(prefix))?.label ?? null;
  }

  return null;
}

function toActivityEntry(
  entry: LedgerEntry,
  records: {
    operationTypeById: ReadonlyMap<string, string>;
    reservationKeyById: ReadonlyMap<string, string>;
  },
): CreditActivityEntry {
  return {
    id: entry.id,
    label: resolveLabel(entry, records) ?? LEDGER_LABELS[entry.kind] ?? "Credits",
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
