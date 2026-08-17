import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type BillableUsage,
  type CreditBalance,
  type CreditLedgerKind,
  type ReservationRefusal,
  type ReservationStatus,
} from "./schema";
import type { ReleaseReason } from "./balance";
import { creditUnits, type CreditUnits, ZERO_CREDITS } from "./units";

/**
 * Billing persistence (BILLING CORE-1 §12, §26, §27, §33, §36).
 *
 * Takes a `SupabaseClient` rather than creating one, exactly as every other
 * store here does. Which client a caller supplies decides what is possible:
 * a request-scoped client can only ever *read* a user's own rows, because
 * these tables have select policies and no write policies at all. Every write
 * below therefore requires the service-role client, and that is enforced by
 * the database rather than by this comment.
 *
 * ## The one thing this file exists to get right
 *
 * Two concurrent operations must not both reserve the same credits. The
 * guarantee is not the balance read in {@link getCreditBalance} — by the time
 * a caller acts on that number it is already stale. It is the single
 * conditional UPDATE in {@link claimReservation}, which re-evaluates
 * `posted - reserved >= amount` while holding the account row, so the loser of
 * a race updates zero rows and is told so. Postgres serializes concurrent
 * updates to one row; the second transaction sees the first's committed value,
 * not the value either of them originally read.
 *
 * That is the same shape the rest of this codebase already uses for
 * concurrency — `operation_runs_single_active_idx` and the included-audit
 * claim guard both move the collision into the database rather than trusting
 * an application pre-check.
 */

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_CHECK_VIOLATION = "23514";

/* ---------------------------------------------------------------------------
 * Accounts
 * ------------------------------------------------------------------------ */

export type CreditAccount = {
  id: string;
  userId: string;
  status: "active" | "suspended" | "closed";
  postedCredits: CreditUnits;
  reservedCredits: CreditUnits;
};

type AccountRow = {
  id: string;
  user_id: string;
  status: CreditAccount["status"];
  posted_credits: number;
  reserved_credits: number;
};

const ACCOUNT_COLUMNS = "id, user_id, status, posted_credits, reserved_credits";

function mapAccount(row: AccountRow): CreditAccount {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    postedCredits: creditUnits(row.posted_credits),
    reservedCredits: creditUnits(row.reserved_credits),
  };
}

export async function findCreditAccountByUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<CreditAccount | null> {
  const { data, error } = await supabase
    .from("billing_credit_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapAccount(data as AccountRow) : null;
}

/**
 * Finds or creates the owner's single wallet.
 *
 * Idempotent under concurrency: the unique index on `user_id` turns a race
 * into a constraint violation, and the loser re-reads the winner's row rather
 * than surfacing an error. Two simultaneous first-time operations must not
 * produce two wallets — that would split a balance in half and make
 * "available" unanswerable.
 */
export async function ensureCreditAccount(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ account: CreditAccount; created: boolean }> {
  const existing = await findCreditAccountByUser(supabase, userId);
  if (existing) return { account: existing, created: false };

  const { data, error } = await supabase
    .from("billing_credit_accounts")
    // The opening balance is stated rather than left to the column defaults.
    // A wallet's initial state is a financial fact, and depending on a default
    // means the same insert produces different rows if a future migration
    // changes one.
    .insert({ user_id: userId, status: "active", posted_credits: 0, reserved_credits: 0 })
    .select(ACCOUNT_COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      const raced = await findCreditAccountByUser(supabase, userId);
      // The race loser reports `created: false`, so exactly one caller ever
      // sees the creation and only one audit event is written.
      if (raced) return { account: raced, created: false };
    }
    throw error;
  }

  return { account: mapAccount(data as AccountRow), created: true };
}

/**
 * The balance, read from the materialized figures on the account row.
 *
 * `available` is derived here rather than stored, so it cannot drift from the
 * two numbers that define it. The materialized figures themselves are proven
 * against the ledger by `reconcileBalance` — see `service.ts`.
 */
export async function getCreditBalance(
  supabase: SupabaseClient,
  userId: string,
): Promise<CreditBalance | null> {
  const account = await findCreditAccountByUser(supabase, userId);
  if (!account) return null;

  return {
    posted: account.postedCredits,
    reserved: account.reservedCredits,
    available: creditUnits(account.postedCredits - account.reservedCredits),
  };
}

/* ---------------------------------------------------------------------------
 * Ledger
 * ------------------------------------------------------------------------ */

export type LedgerEntry = {
  id: string;
  creditAccountId: string;
  kind: CreditLedgerKind;
  creditDelta: CreditUnits;
  operationRunId: string | null;
  reservationId: string | null;
  refundsLedgerEntryId: string | null;
  rateCardVersion: string | null;
  idempotencyKey: string;
  createdAt: string;
};

type LedgerRow = {
  id: string;
  credit_account_id: string;
  kind: CreditLedgerKind;
  credit_delta: number;
  operation_run_id: string | null;
  reservation_id: string | null;
  refunds_ledger_entry_id: string | null;
  rate_card_version: string | null;
  idempotency_key: string;
  created_at: string;
};

const LEDGER_COLUMNS =
  "id, credit_account_id, kind, credit_delta, operation_run_id, reservation_id, refunds_ledger_entry_id, rate_card_version, idempotency_key, created_at";

function mapLedgerEntry(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    creditAccountId: row.credit_account_id,
    kind: row.kind,
    creditDelta: creditUnits(row.credit_delta),
    operationRunId: row.operation_run_id,
    reservationId: row.reservation_id,
    refundsLedgerEntryId: row.refunds_ledger_entry_id,
    rateCardVersion: row.rate_card_version,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

export async function findLedgerEntryByIdempotencyKey(
  supabase: SupabaseClient,
  params: { creditAccountId: string; idempotencyKey: string },
): Promise<LedgerEntry | null> {
  const { data, error } = await supabase
    .from("billing_credit_ledger")
    .select(LEDGER_COLUMNS)
    .eq("credit_account_id", params.creditAccountId)
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  return data ? mapLedgerEntry(data as LedgerRow) : null;
}

export async function listLedgerEntries(
  supabase: SupabaseClient,
  creditAccountId: string,
): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from("billing_credit_ledger")
    .select(LEDGER_COLUMNS)
    .eq("credit_account_id", creditAccountId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as LedgerRow[]).map(mapLedgerEntry);
}

export type PostLedgerEntryParams = {
  creditAccountId: string;
  kind: CreditLedgerKind;
  creditDelta: CreditUnits;
  idempotencyKey: string;
  projectId?: string | null;
  operationRunId?: string | null;
  reservationId?: string | null;
  refundsLedgerEntryId?: string | null;
  rateCardVersion?: string | null;
  reason?: string | null;
};

/**
 * Posts one immutable ledger entry and moves the materialized balance.
 *
 * ## Ambiguous outcomes resolve by reading, never by retrying (§27)
 *
 * A duplicate key does not mean "try again" — it means the entry this call was
 * asked to write already exists, so the existing one is returned and the
 * balance is left alone. This is what makes a retried settlement, a replayed
 * workflow step or a double-clicked button post exactly one charge. The
 * guarantee is the unique index, not this check: two simultaneous callers both
 * pass any application-level lookup, and only one wins the index.
 */
export async function postLedgerEntry(
  supabase: SupabaseClient,
  params: PostLedgerEntryParams,
): Promise<{ entry: LedgerEntry; alreadyPosted: boolean }> {
  const { data, error } = await supabase
    .from("billing_credit_ledger")
    .insert({
      credit_account_id: params.creditAccountId,
      kind: params.kind,
      credit_delta: params.creditDelta,
      project_id: params.projectId ?? null,
      operation_run_id: params.operationRunId ?? null,
      reservation_id: params.reservationId ?? null,
      refunds_ledger_entry_id: params.refundsLedgerEntryId ?? null,
      rate_card_version: params.rateCardVersion ?? null,
      reason: params.reason ?? null,
      idempotency_key: params.idempotencyKey,
    })
    .select(LEDGER_COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      const existing = await findLedgerEntryByIdempotencyKey(supabase, {
        creditAccountId: params.creditAccountId,
        idempotencyKey: params.idempotencyKey,
      });
      // The write we were asked to make is already durable. Returning it —
      // rather than posting a second entry — is the whole exactly-once
      // contract.
      if (existing) return { entry: existing, alreadyPosted: true };
    }
    throw error;
  }

  const entry = mapLedgerEntry(data as LedgerRow);
  await applyPostedDelta(supabase, params.creditAccountId, params.creditDelta);
  return { entry, alreadyPosted: false };
}

/**
 * Moves the materialized posted balance by a signed delta.
 *
 * Read-modify-write on a single row, which Postgres serializes. Separated from
 * the ledger insert because the insert is the durable financial fact and this
 * is a cache: if this call were lost, `reconcileBalance` would detect the drift
 * and the ledger would still be the truth.
 */
async function applyPostedDelta(
  supabase: SupabaseClient,
  creditAccountId: string,
  delta: CreditUnits,
): Promise<void> {
  const { data, error } = await supabase
    .from("billing_credit_accounts")
    .select("posted_credits")
    .eq("id", creditAccountId)
    .single();

  if (error) throw error;

  const next = creditUnits((data as { posted_credits: number }).posted_credits + delta);
  const { error: updateError } = await supabase
    .from("billing_credit_accounts")
    .update({ posted_credits: next })
    .eq("id", creditAccountId);

  if (updateError) throw updateError;
}

/* ---------------------------------------------------------------------------
 * Reservations
 * ------------------------------------------------------------------------ */

export type CreditReservation = {
  id: string;
  creditAccountId: string;
  projectId: string | null;
  operationRunId: string | null;
  quoteId: string | null;
  reservedCredits: CreditUnits;
  status: ReservationStatus;
  settledCredits: CreditUnits | null;
  rateCardVersion: string | null;
  releaseReason: ReleaseReason | null;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string | null;
};

type ReservationRow = {
  id: string;
  credit_account_id: string;
  project_id: string | null;
  operation_run_id: string | null;
  quote_id: string | null;
  reserved_credits: number;
  status: ReservationStatus;
  settled_credits: number | null;
  rate_card_version: string | null;
  release_reason: ReleaseReason | null;
  idempotency_key: string;
  created_at: string;
  expires_at: string | null;
};

const RESERVATION_COLUMNS =
  "id, credit_account_id, project_id, operation_run_id, quote_id, reserved_credits, status, settled_credits, rate_card_version, release_reason, idempotency_key, created_at, expires_at";

function mapReservation(row: ReservationRow): CreditReservation {
  return {
    id: row.id,
    creditAccountId: row.credit_account_id,
    projectId: row.project_id,
    operationRunId: row.operation_run_id,
    quoteId: row.quote_id,
    reservedCredits: creditUnits(row.reserved_credits),
    status: row.status,
    // Nullish rather than `=== null`: a column that was never set comes back
    // undefined, and treating that as a number would crash the mapper on a row
    // that is perfectly valid — an unsettled reservation has no settled amount.
    settledCredits: row.settled_credits == null ? null : creditUnits(row.settled_credits),
    rateCardVersion: row.rate_card_version ?? null,
    releaseReason: row.release_reason ?? null,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function findReservationByIdempotencyKey(
  supabase: SupabaseClient,
  params: { creditAccountId: string; idempotencyKey: string },
): Promise<CreditReservation | null> {
  const { data, error } = await supabase
    .from("billing_credit_reservations")
    .select(RESERVATION_COLUMNS)
    .eq("credit_account_id", params.creditAccountId)
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  return data ? mapReservation(data as ReservationRow) : null;
}

export async function getReservation(
  supabase: SupabaseClient,
  reservationId: string,
): Promise<CreditReservation | null> {
  const { data, error } = await supabase
    .from("billing_credit_reservations")
    .select(RESERVATION_COLUMNS)
    .eq("id", reservationId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapReservation(data as ReservationRow) : null;
}

export async function listActiveReservations(
  supabase: SupabaseClient,
  creditAccountId: string,
): Promise<CreditReservation[]> {
  const { data, error } = await supabase
    .from("billing_credit_reservations")
    .select(RESERVATION_COLUMNS)
    .eq("credit_account_id", creditAccountId)
    .eq("status", "active");

  if (error) throw error;
  return ((data ?? []) as ReservationRow[]).map(mapReservation);
}

export type ClaimReservationResult =
  | { ok: true; reservation: CreditReservation; alreadyHeld: boolean }
  | { ok: false; refusal: ReservationRefusal };

/**
 * Takes a credit hold, atomically (§12, §48).
 *
 * ## Why the balance check is an UPDATE predicate and not an `if`
 *
 * The tempting shape is: read the balance, decide, insert a reservation. That
 * has a race window between the read and the write wide enough for two
 * operations to both see 1000 credits and both reserve 700. The available
 * balance would go to -400 and nothing would have done anything wrong
 * individually.
 *
 * So the admission decision *is* the write. The conditional UPDATE below
 * re-evaluates `posted - reserved >= amount` against the committed row while
 * holding it; concurrent updates to one row serialize, so the second caller
 * evaluates the predicate against the first caller's result and matches zero
 * rows. `billing_credit_accounts_available_non_negative` is the backstop that
 * makes an overspend impossible even if this predicate were written wrong.
 *
 * The reservation row is inserted first so a crash between the two statements
 * leaks a row rather than credits — an inactive reservation nobody holds is
 * recoverable; a hold with no record of who took it is not.
 */
export async function claimReservation(
  supabase: SupabaseClient,
  params: {
    account: CreditAccount;
    reservedCredits: CreditUnits;
    idempotencyKey: string;
    projectId?: string | null;
    operationRunId?: string | null;
    quoteId?: string | null;
    expiresAt?: string | null;
  },
): Promise<ClaimReservationResult> {
  if (params.reservedCredits <= 0) return { ok: false, refusal: "invalid_amount" };
  if (params.account.status !== "active") return { ok: false, refusal: "account_suspended" };

  // A retry of the same request must not take a second hold.
  const existing = await findReservationByIdempotencyKey(supabase, {
    creditAccountId: params.account.id,
    idempotencyKey: params.idempotencyKey,
  });
  if (existing) return { ok: true, reservation: existing, alreadyHeld: true };

  const { data, error } = await supabase
    .from("billing_credit_reservations")
    .insert({
      credit_account_id: params.account.id,
      project_id: params.projectId ?? null,
      operation_run_id: params.operationRunId ?? null,
      quote_id: params.quoteId ?? null,
      reserved_credits: params.reservedCredits,
      status: "active",
      idempotency_key: params.idempotencyKey,
      expires_at: params.expiresAt ?? null,
    })
    .select(RESERVATION_COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      const raced = await findReservationByIdempotencyKey(supabase, {
        creditAccountId: params.account.id,
        idempotencyKey: params.idempotencyKey,
      });
      if (raced) return { ok: true, reservation: raced, alreadyHeld: true };
    }
    throw error;
  }

  const reservation = mapReservation(data as ReservationRow);
  const admitted = await admitHold(supabase, params.account.id, params.reservedCredits);

  if (!admitted.ok) {
    // The hold was not taken, so the row that claimed it must not stay active.
    await voidReservation(supabase, reservation.id);
    return { ok: false, refusal: admitted.refusal };
  }

  return { ok: true, reservation, alreadyHeld: false };
}

/**
 * How many times a contended hold is re-attempted before giving up.
 *
 * Contention is resolved by re-reading and trying again, so this only bounds
 * pathological cases. Three is enough for any realistic number of simultaneous
 * starts on one account, and a caller that exhausts it is told the truth
 * (`insufficient_credits` only when the balance genuinely cannot cover the
 * hold) rather than being retried forever.
 */
const HOLD_ATTEMPTS = 3;

/**
 * Takes the hold against the account row, atomically (§12, §48).
 *
 * ## Why compare-and-swap, and why it retries
 *
 * PostgREST cannot express a column-relative update — there is no way to say
 * `set reserved_credits = reserved_credits + $1` through it. So the update
 * carries the *new* value and is guarded by `eq(reserved_credits, <the value
 * we read>)`: a classic compare-and-swap. If another caller moved the column
 * in between, zero rows match and this attempt did not happen.
 *
 * CAS alone is safe but too strict. Two callers reserving 700 each against
 * 1500 would both read `reserved = 0`, the first would win, and the second
 * would be refused despite the balance covering it — a funded customer told
 * "insufficient credits" because somebody else was quick. So a failed swap
 * re-reads the account and distinguishes the two causes: if available is now
 * genuinely below the request, that is a real refusal; otherwise it was
 * contention and the attempt is repeated against the fresh value.
 *
 * The safety direction never depends on the retry. Overspending is prevented
 * by the swap and, underneath it, by
 * `billing_credit_accounts_available_non_negative`.
 */
async function admitHold(
  supabase: SupabaseClient,
  creditAccountId: string,
  requested: CreditUnits,
): Promise<{ ok: true } | { ok: false; refusal: ReservationRefusal }> {
  for (let attempt = 0; attempt < HOLD_ATTEMPTS; attempt += 1) {
    const { data: current, error: readError } = await supabase
      .from("billing_credit_accounts")
      .select("posted_credits, reserved_credits")
      .eq("id", creditAccountId)
      .single();

    if (readError) throw readError;

    const row = current as { posted_credits: number; reserved_credits: number };
    const available = row.posted_credits - row.reserved_credits;
    if (available < requested) return { ok: false, refusal: "insufficient_credits" };

    const { data: updated, error: updateError } = await supabase
      .from("billing_credit_accounts")
      .update({ reserved_credits: row.reserved_credits + requested })
      .eq("id", creditAccountId)
      // The swap: only if nobody has moved this column since it was read.
      .eq("reserved_credits", row.reserved_credits)
      .select("id");

    if (updateError) {
      // The backstop constraint refusing means the same thing the predicate
      // does — there were not enough credits.
      if (updateError.code === POSTGRES_CHECK_VIOLATION) {
        return { ok: false, refusal: "insufficient_credits" };
      }
      throw updateError;
    }

    if (updated && updated.length > 0) return { ok: true };
    // Lost the swap. Re-read and decide again.
  }

  // Sustained contention rather than a balance problem. Refusing is safe and
  // the caller may try again; silently proceeding would not be.
  return { ok: false, refusal: "insufficient_credits" };
}

/** Marks a reservation that never took a hold as released, so it holds nothing. */
async function voidReservation(supabase: SupabaseClient, reservationId: string): Promise<void> {
  const { error } = await supabase
    .from("billing_credit_reservations")
    .update({
      status: "released",
      release_reason: "cancelled_before_usage",
      released_at: new Date().toISOString(),
    })
    .eq("id", reservationId)
    .eq("status", "active");

  if (error) {
    console.error("[billing] failed to void an unclaimed reservation", { reservationId });
  }
}

/**
 * Closes a reservation and returns its held credits.
 *
 * Guarded on `status = 'active'` so a concurrent settle and release cannot both
 * decrement `reserved_credits`. The zero-row case means somebody else already
 * closed it, which is a successful no-op rather than an error (§27).
 */
export async function closeReservation(
  supabase: SupabaseClient,
  params: {
    reservationId: string;
    creditAccountId: string;
    heldCredits: CreditUnits;
    status: Extract<ReservationStatus, "settled" | "released" | "expired">;
    settledCredits?: CreditUnits | null;
    rateCardVersion?: string | null;
    releaseReason?: ReleaseReason | null;
  },
): Promise<{ closed: boolean }> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> =
    params.status === "settled"
      ? {
          status: "settled",
          settled_at: now,
          settled_credits: params.settledCredits ?? ZERO_CREDITS,
          rate_card_version: params.rateCardVersion ?? null,
        }
      : {
          status: params.status,
          released_at: now,
          release_reason: params.releaseReason ?? "cancelled_before_usage",
        };

  const { data, error } = await supabase
    .from("billing_credit_reservations")
    .update(patch)
    .eq("id", params.reservationId)
    .eq("status", "active")
    .select("id");

  if (error) throw error;
  if (!data || data.length === 0) return { closed: false };

  await releaseHeldCredits(supabase, params.creditAccountId, params.heldCredits);
  return { closed: true };
}

/** Decrements the materialized hold. Only ever called once per reservation. */
async function releaseHeldCredits(
  supabase: SupabaseClient,
  creditAccountId: string,
  held: CreditUnits,
): Promise<void> {
  const { data, error } = await supabase
    .from("billing_credit_accounts")
    .select("reserved_credits")
    .eq("id", creditAccountId)
    .single();

  if (error) throw error;

  const next = creditUnits(
    Math.max(0, (data as { reserved_credits: number }).reserved_credits - held),
  );
  const { error: updateError } = await supabase
    .from("billing_credit_accounts")
    .update({ reserved_credits: next })
    .eq("id", creditAccountId);

  if (updateError) throw updateError;
}

/* ---------------------------------------------------------------------------
 * Usage projection
 * ------------------------------------------------------------------------ */

export type StoredUsageEvent = BillableUsage & {
  id: string;
  ratingStatus: string;
  ratedCredits: CreditUnits | null;
  rateCardVersion: string | null;
};

/**
 * Projects normalized usage, idempotently (§43).
 *
 * `billing_usage_events_source_sku_idx` makes one source row produce at most
 * one event per SKU, so reconciliation is safe to run repeatedly. Duplicates
 * are ignored rather than treated as an error — that is precisely what
 * "safe to run twice" means, and a backfill that failed on its second run
 * would be useless for repair.
 */
export async function projectUsageEvents(
  supabase: SupabaseClient,
  events: readonly (BillableUsage & {
    ratingStatus: string;
    ratedCredits: CreditUnits | null;
    rateCardVersion: string | null;
  })[],
): Promise<{ inserted: number; alreadyPresent: number }> {
  let inserted = 0;
  let alreadyPresent = 0;

  for (const event of events) {
    const { error } = await supabase.from("billing_usage_events").insert({
      source_kind: event.sourceKind,
      source_id: event.sourceId,
      project_id: event.projectId,
      user_id: event.userId,
      operation_run_id: event.operationRunId,
      provider: event.provider,
      sku: event.sku,
      quantity: event.quantity,
      raw_cost_nano_usd: event.rawCostNanoUsd,
      cost_status: event.costStatus,
      provider_pricing_version: event.providerPricingVersion,
      rating_status: event.ratingStatus,
      rated_credits: event.ratedCredits,
      rate_card_version: event.rateCardVersion,
      occurred_at: event.occurredAt,
    });

    if (error) {
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        alreadyPresent += 1;
        continue;
      }
      throw error;
    }
    inserted += 1;
  }

  return { inserted, alreadyPresent };
}

/** Every projected usage row for one operation, for per-operation rating (§63). */
export async function listUsageForOperation(
  supabase: SupabaseClient,
  operationRunId: string,
): Promise<StoredUsageEvent[]> {
  const { data, error } = await supabase
    .from("billing_usage_events")
    .select("*")
    .eq("operation_run_id", operationRunId);

  if (error) throw error;
  return (data ?? []) as unknown as StoredUsageEvent[];
}
