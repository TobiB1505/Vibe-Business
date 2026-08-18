import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import {
  WELCOME_CREDIT_UNITS,
  WELCOME_CREDIT_VALIDITY_DAYS,
  welcomeGrantIdempotencyKey,
} from "@/modules/billing/catalog";
import type { CreditSourceKind } from "./lots";
import {
  findLotsToExpire,
  insertGrantLot,
  listActiveLots,
  markLotExpired,
  readLotAllocated,
} from "./lot-store";
import { ensureCreditAccount, postLedgerEntry } from "./store";
import { creditUnits, type CreditUnits } from "./units";

/**
 * Issuing and expiring Credits (BILLING CORE-2 §5, §6, §10, §13, §30, §59, §61).
 *
 * ## Server-only, and unreachable from a browser
 *
 * Nothing here is a Server Action, a route handler, or reachable from one
 * without a verified Stripe signature or an authenticated provisioning path.
 * The tables it writes have no insert policy at all, so even if a call site
 * were added by mistake a browser could not reach it (§64). There is
 * deliberately no "add credits" endpoint of any kind.
 *
 * ## Every grant is a ledger entry first
 *
 * A lot is not a second wallet. Credits come into existence as an append-only
 * ledger entry — which is what moves the balance and what
 * `reconcileBalance` proves — and the lot records where that entry came from
 * and when it dies. That ordering is why a replayed webhook cannot double-grant
 * without any new idempotency machinery: the ledger's existing unique index
 * collapses the retry to one entry, and one entry can own at most one lot.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type GrantLotParams = {
  userId: string;
  sourceKind: CreditSourceKind;
  credits: CreditUnits;
  reason: string;
  idempotencyKey: string;
  /** Absolute expiry. Null means no normal expiration — purchased Credits. */
  expiresAt?: string | null;
  externalReference?: string | null;
  subscriptionId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
};

export type GrantLotResult = {
  creditAccountId: string;
  lotId: string;
  /**
   * True when the Credits were already durable before this call — a retry, a
   * webhook replay, or a losing caller in a race. Exactly one caller across any
   * number of concurrent attempts sees `false`.
   */
  alreadyGranted: boolean;
};

/**
 * Issues one immutable Credit lot.
 *
 * The single path by which Credits come into existence. Welcome grants,
 * subscription periods and purchases all funnel through it so the ledger entry,
 * the lot, the audit event and the idempotency guarantee are written the same
 * way every time.
 *
 * `purchase` is posted under the ledger's `purchase` kind and everything else
 * under `grant`, matching Core-1's vocabulary: the distinction is whether real
 * money was exchanged, which an accountant will eventually need to separate.
 */
export async function grantCreditLot(
  supabase: SupabaseClient,
  params: GrantLotParams,
): Promise<GrantLotResult> {
  if (params.credits <= 0) throw new Error("A grant must be positive.");
  if (params.reason.trim().length === 0) throw new Error("A grant must state a reason.");

  const { account } = await ensureCreditAccount(supabase, params.userId);

  const { entry, alreadyPosted } = await postLedgerEntry(supabase, {
    creditAccountId: account.id,
    kind: params.sourceKind === "purchase" ? "purchase" : "grant",
    creditDelta: params.credits,
    idempotencyKey: params.idempotencyKey,
    reason: params.reason,
  });

  // Runs even on a retry: a crash between the ledger insert and the lot insert
  // would otherwise leave posted Credits with no provenance, and this is what
  // repairs that on the next attempt.
  const { lot } = await insertGrantLot(supabase, {
    creditAccountId: account.id,
    ledgerEntryId: entry.id,
    sourceKind: params.sourceKind,
    creditUnits: params.credits,
    expiresAt: params.expiresAt ?? null,
    externalReference: params.externalReference ?? null,
    subscriptionId: params.subscriptionId ?? null,
    periodStart: params.periodStart ?? null,
    periodEnd: params.periodEnd ?? null,
  });

  if (!alreadyPosted) {
    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "billing.credit_lot_granted",
      metadata: {
        creditAccountId: account.id,
        lotId: lot.id,
        sourceKind: params.sourceKind,
        credits: params.credits,
        expiresAt: params.expiresAt ?? null,
        // An identifier only — never an amount of money, a card, or a customer
        // detail (§68).
        externalReference: params.externalReference ?? null,
      },
    });
  }

  return {
    creditAccountId: account.id,
    lotId: lot.id,
    // The **ledger entry** is what decides whether Credits came into existence,
    // so it alone decides this flag. The lot is provenance: a caller that lost
    // the ledger's unique index but happened to win the lot insert (a real
    // interleaving, and the shape a crash-recovery repair also takes) granted
    // nothing, and must not report that it did.
    alreadyGranted: alreadyPosted,
  };
}

/* ---------------------------------------------------------------------------
 * Welcome Credits
 * ------------------------------------------------------------------------ */

/**
 * Grants an account its one Welcome allowance (§5, §6, §57, §70).
 *
 * ## Account-scoped, exactly once, forever
 *
 * The idempotency identity is `welcome-credit-v1:<userId>`, so ten concurrent
 * provisioning attempts all compute the same key and the ledger's unique index
 * admits exactly one. Eligibility is never decided by a browser and never by a
 * flag anyone can flip — it is decided by whether that ledger entry exists.
 *
 * Scoped to the account rather than the project deliberately: a project-scoped
 * welcome grant would make creating projects a way to farm Credits, which is
 * the one abuse this design has to be structurally immune to.
 *
 * ## Safe to call from anywhere, as often as you like
 *
 * This is what makes reconciliation for pre-existing users work without a
 * migration that mints Credits (§6). It is called from the authenticated
 * billing surface, so a user who registered before Billing Core-2 existed
 * receives their grant the first time they are seen — and never a second time,
 * because the key is the same one a new user's provisioning would compute.
 *
 * Never called from a GET (§99). Financial state is not mutated by a page
 * render; the caller is an explicit server-side provisioning path.
 */
export async function ensureWelcomeGrant(
  supabase: SupabaseClient,
  params: { userId: string; now?: Date },
): Promise<GrantLotResult> {
  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + WELCOME_CREDIT_VALIDITY_DAYS * DAY_MS).toISOString();

  return grantCreditLot(supabase, {
    userId: params.userId,
    sourceKind: "welcome",
    credits: WELCOME_CREDIT_UNITS,
    reason: "Welcome Credits",
    idempotencyKey: welcomeGrantIdempotencyKey(params.userId),
    expiresAt,
  });
}

/* ---------------------------------------------------------------------------
 * Expiry
 * ------------------------------------------------------------------------ */

export type ExpirySweepResult = {
  expiredLotCount: number;
  expiredCredits: CreditUnits;
};

/**
 * Posts the compensating entries for Credits that have lapsed (§59, §60, §73).
 *
 * ## Why this is a sweep rather than a scheduled job
 *
 * Expiry is already derived at read and reserve time — `isSpendable` refuses a
 * lapsed lot whether or not anything has swept it, so no customer can spend
 * expired Credits regardless of when this runs. The sweep exists only to move
 * the *posted* balance so it stops overstating what someone has.
 *
 * That makes a cron unnecessary. Running it whenever an account is touched —
 * before a balance is shown, before a reservation is taken — is enough, and an
 * hourly job walking every account in the system to correct a number nobody is
 * looking at would be strictly worse. §59 asks for exactly this: derive it if
 * queries safely can, and reconcile rather than schedule.
 *
 * ## Never deletes anything
 *
 * The lot stays, with its original amount intact, and a negative `expiry` entry
 * records what lapsed. History remains answerable forever (§60).
 */
export async function sweepExpiredCredits(
  supabase: SupabaseClient,
  params: { userId: string; creditAccountId: string; now?: Date },
): Promise<ExpirySweepResult> {
  const now = params.now ?? new Date();
  const due = await findLotsToExpire(supabase, params.creditAccountId, now);

  let expiredLotCount = 0;
  let expiredCredits = 0;

  for (const lot of due) {
    // Re-read immediately before the claim so the compare-and-swap below is
    // guarded on the value the sweep is actually acting on.
    const allocated = await readLotAllocated(supabase, lot.lotId);
    if (allocated === null) continue;

    const claimed = await markLotExpired(supabase, {
      lotId: lot.lotId,
      expiringUnits: lot.expiringUnits,
      allocatedAtSweep: allocated,
    });

    // Lost the claim to a concurrent sweep, or the lot moved underneath us.
    // Either way this caller posts nothing — the winner already did, or the
    // next sweep will.
    if (!claimed) continue;

    await postLedgerEntry(supabase, {
      creditAccountId: params.creditAccountId,
      kind: "expiry",
      creditDelta: creditUnits(-lot.expiringUnits),
      // One expiry per lot, forever. A replayed sweep posts nothing.
      idempotencyKey: `expire:${lot.lotId}`,
      reason: `${lot.sourceKind} credits expired`,
    });

    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "billing.credits_expired",
      metadata: {
        creditAccountId: params.creditAccountId,
        lotId: lot.lotId,
        sourceKind: lot.sourceKind,
        credits: lot.expiringUnits,
      },
    });

    expiredLotCount += 1;
    expiredCredits += lot.expiringUnits;
  }

  return { expiredLotCount, expiredCredits: creditUnits(expiredCredits) };
}

/* ---------------------------------------------------------------------------
 * Reading
 * ------------------------------------------------------------------------ */

export type ExpiringSoon = { credits: CreditUnits; expiresAt: string };

/**
 * The next tranche of Credits to lapse, for the customer's balance surface.
 *
 * Returns the soonest expiry and how much lapses with it — enough for
 * "120 expire on Sep 1" (§50) without exposing lots, sources or allocation to
 * a customer who should never have to think about any of it (§94).
 */
export async function findNextExpiry(
  supabase: SupabaseClient,
  creditAccountId: string,
  now: Date = new Date(),
): Promise<ExpiringSoon | null> {
  const lots = await listActiveLots(supabase, creditAccountId);

  let soonest: string | null = null;
  let credits = 0;

  for (const lot of lots) {
    if (lot.expiresAt === null) continue;
    if (Date.parse(lot.expiresAt) <= now.getTime()) continue;

    const remaining = lot.initialCreditUnits - lot.allocatedCreditUnits - lot.expiredCreditUnits;
    if (remaining <= 0) continue;

    if (soonest === null || Date.parse(lot.expiresAt) < Date.parse(soonest)) {
      soonest = lot.expiresAt;
      credits = remaining;
      continue;
    }

    // Several lots sharing the same instant lapse together and are shown as one
    // number — the customer experiences a single expiry, not three.
    if (lot.expiresAt === soonest) credits += remaining;
  }

  return soonest === null ? null : { credits: creditUnits(credits), expiresAt: soonest };
}
