import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type BillableUsage,
  type CreditBalance,
  type CreditLedgerKind,
  type ReservationRefusal,
  type ReservationStatus,
} from "./schema";
import { type ReleaseReason } from "./balance";
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
 * a caller acts on that number it is already stale. It is the row lock inside
 * `materialize_reservation_hold` (ADR 0042 §P3), which re-evaluates
 * `posted - reserved >= amount` while holding the account row via
 * `SELECT ... FOR UPDATE`, so the loser of a race blocks until the winner
 * commits and then sees its result, not the value either of them originally
 * read. `admitHold` below is a thin `.rpc()` call onto that function; the
 * conditional UPDATE is no longer expressed in this file, only invoked from
 * it.
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
  /** Null once the identity is erased — the account is tombstoned (ADR 0056 §6). */
  userId: string | null;
  status: "active" | "suspended" | "closed";
  postedCredits: CreditUnits;
  reservedCredits: CreditUnits;
};

type AccountRow = {
  id: string;
  user_id: string | null;
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

/**
 * How much ledger history one read may transfer (VB-025).
 *
 * Not a page size — there is no paging here, and adding one would be a product
 * change. It is a ceiling on a read that grows with every Credit a customer
 * has ever spent and was made on every render of the billing page.
 *
 * Safe to cap only because the *balance* no longer comes from here. Summing a
 * capped list would report drift on any account older than the cap, and with
 * `BILLING_REPAIR_ENABLED` a false drift triggers a repair — see
 * `sumLedgerDeltas`.
 */
export const LEDGER_READ_LIMIT = 100;

export async function listLedgerEntries(
  supabase: SupabaseClient,
  creditAccountId: string,
): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from("billing_credit_ledger")
    .select(LEDGER_COLUMNS)
    .eq("credit_account_id", creditAccountId)
    .order("created_at", { ascending: false })
    .limit(LEDGER_READ_LIMIT);

  if (error) throw error;
  return ((data ?? []) as LedgerRow[]).map(mapLedgerEntry);
}

/**
 * Whether one specific ledger entry exists, by its idempotency key.
 *
 * ## Why this is not `listLedgerEntries().some(…)`
 *
 * Because that answer is wrong on an old account, and wrong in the direction
 * that re-offers something already given. `listLedgerEntries` is capped at
 * `LEDGER_READ_LIMIT` and ordered newest first, while the entry callers ask
 * about here — the welcome grant — is the *oldest* row an account has. Past
 * the cap it falls out of the window, `some` returns false, and the billing
 * screen says the welcome Credits are still available.
 *
 * The cap itself is right (VB-025); deriving a historical fact from a recent
 * window is what was wrong. This asks the database the question directly, and
 * `billing_credit_ledger_idempotency_idx` — unique on
 * `(credit_account_id, idempotency_key)` — answers it from one index lookup
 * that never grows with the account.
 */
export async function hasLedgerEntryWithKey(
  supabase: SupabaseClient,
  creditAccountId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("billing_credit_ledger")
    .select("id")
    .eq("credit_account_id", creditAccountId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

/**
 * The posted balance the ledger implies, summed in the database (VB-025).
 *
 * ## Why this is not `listLedgerEntries().reduce(…)`
 *
 * Because that is the read this exists to replace. Reconciliation needs one
 * number over **every** entry — that is what makes it an independent check on
 * the materialized figure rather than a comparison of a cache with itself — and
 * getting that number by transferring every row is what made the billing page
 * degrade with account age.
 *
 * A PostgREST aggregate would need no function at all. This project's
 * PostgREST refuses them (`PGRST123`), which is a fact about the deployment
 * rather than about PostgREST, so it was measured rather than assumed.
 *
 * The function is `SECURITY INVOKER`: RLS decides which entries are visible,
 * exactly as it does for a direct select. It moves an aggregation into the
 * database, never an authority.
 */
export async function sumLedgerDeltas(
  supabase: SupabaseClient,
  creditAccountId: string,
): Promise<CreditUnits> {
  const { data, error } = await supabase.rpc("sum_ledger_deltas", {
    p_credit_account_id: creditAccountId,
  });

  if (error) throw error;

  // `sum()` over `bigint` comes back as a string from PostgREST when it is
  // large enough, and the cast in the function keeps it an integer either way.
  return creditUnits(Number(data ?? 0));
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
      //
      // But it is not licence to report success blindly (§I3). A replay is
      // most likely *because* the first attempt failed, and the way it fails
      // is a committed entry whose materialization did not land. Re-invoking
      // the materializer heals that rather than merely detecting it:
      // `materialize_ledger_entry` locks the ledger row, checks its own
      // `materialized_at` marker, and no-ops if the first attempt actually
      // finished — so a genuine replay is free and an unfinished one is
      // completed here, in front of the caller, instead of being reported as
      // drift for someone else to fix later.
      if (existing) {
        await materializeLedgerEntry(supabase, existing.id);
        return { entry: existing, alreadyPosted: true };
      }
    }
    throw error;
  }

  const entry = mapLedgerEntry(data as LedgerRow);
  await materializeLedgerEntry(supabase, entry.id);
  return { entry, alreadyPosted: false };
}

/**
 * Applies one ledger entry's delta to the materialized posted balance.
 *
 * A thin `.rpc()` call onto `materialize_ledger_entry` (ADR 0042 §P3): the
 * function locks the ledger row and the account row it belongs to, checks the
 * ledger row's own `materialized_at` marker, and either applies the delta and
 * sets the marker or no-ops if it is already set — all inside one Postgres
 * transaction. That is what makes it safe to call twice for the same entry,
 * from any two callers, in any order: the hot-path caller right after insert,
 * and a replayed request's self-heal above.
 */
async function materializeLedgerEntry(supabase: SupabaseClient, ledgerEntryId: string): Promise<void> {
  const { error } = await supabase.rpc("materialize_ledger_entry", { p_entry_id: ledgerEntryId });
  if (error) throw error;
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

/**
 * Reservations by id, in one read.
 *
 * Mirrors `operations/store.ts`'s `listOperationRunsByIds`, and exists for the
 * same reason: the billing page needs a handful of reservations to *name* the
 * charges it is already displaying, and a per-row read would put a query count
 * on the size of the history.
 *
 * Ordinary RLS applies — this is a plain select, so it can only return
 * reservations the caller's session may already see.
 */
export async function listReservationsByIds(
  supabase: SupabaseClient,
  reservationIds: readonly string[],
): Promise<CreditReservation[]> {
  if (reservationIds.length === 0) return [];

  const { data, error } = await supabase
    .from("billing_credit_reservations")
    .select(RESERVATION_COLUMNS)
    .in("id", reservationIds);

  if (error) throw error;
  return ((data ?? []) as ReservationRow[]).map(mapReservation);
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
  const admitted = await admitHold(supabase, reservation.id);

  if (!admitted.ok) {
    // The hold was not taken, so the row that claimed it must not stay active.
    await voidReservation(supabase, reservation.id);
    return { ok: false, refusal: admitted.refusal };
  }

  return { ok: true, reservation, alreadyHeld: false };
}

/**
 * Takes the hold against the account row, atomically (§12, §48).
 *
 * A thin `.rpc()` call onto `materialize_reservation_hold` (ADR 0042 §P3).
 * The function locks the reservation row and its account with
 * `SELECT ... FOR UPDATE`, then — because the row this call passes was just
 * inserted `active` with no `admitted_at` — takes its admit branch: adds
 * `reserved_credits` and stamps `admitted_at`. There is no explicit
 * availability check in that branch; admission safety is the CHECK constraint
 * underneath it, `billing_credit_accounts_available_non_negative`, exactly as
 * it always has been for this codebase's overspend doctrine — a caller could
 * never post a reservation the account could not cover, whether or not any
 * application code checked first. So a violation of that constraint means the
 * same thing an explicit refusal would: there were not enough credits.
 */
async function admitHold(
  supabase: SupabaseClient,
  reservationId: string,
): Promise<{ ok: true } | { ok: false; refusal: ReservationRefusal }> {
  const { error } = await supabase.rpc("materialize_reservation_hold", {
    p_reservation_id: reservationId,
  });

  if (error) {
    if (error.code === POSTGRES_CHECK_VIOLATION) {
      return { ok: false, refusal: "insufficient_credits" };
    }
    throw error;
  }

  return { ok: true };
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

  await releaseHeldCredits(supabase, params.reservationId);
  return { closed: true };
}

/**
 * Decrements the materialized hold.
 *
 * The same `.rpc()` call onto `materialize_reservation_hold` as
 * {@link admitHold}, called instead at the point where `closeReservation` has
 * just flipped the row out of `active` — so the function's row lock finds
 * `admitted_at` set and `hold_released_at` still null, takes its release
 * branch, and subtracts `reserved_credits` exactly once. Called at most once
 * per reservation, for the same reason it always was: `closeReservation`
 * guards on `status = 'active'` and only calls through when a row actually
 * flipped. The function's own row lock is what makes that guarantee hold even
 * under concurrency — two reservations closing at once each lock their own
 * row, not the account's total, so neither can erase the other's subtraction.
 */
async function releaseHeldCredits(supabase: SupabaseClient, reservationId: string): Promise<void> {
  const { error } = await supabase.rpc("materialize_reservation_hold", {
    p_reservation_id: reservationId,
  });
  if (error) throw error;
}

/**
 * Repairs an account's materialized figures from the ledger and reservations.
 *
 * A thin `.rpc()` call onto `repair_account_balance` (ADR 0042 §P3): it scans
 * for rows whose marker is still unset and delegates to
 * `materialize_ledger_entry`/`materialize_reservation_hold` for each, so it
 * shares their exact locking and idempotency rather than recomputing a total
 * from scratch. Only ever called from behind `BILLING_REPAIR_ENABLED` — see
 * `getBillingBalance` in `service.ts` and ADR 0042's Rollout section.
 */
export async function repairAccountBalance(supabase: SupabaseClient, creditAccountId: string): Promise<void> {
  const { error } = await supabase.rpc("repair_account_balance", { p_account_id: creditAccountId });
  if (error) throw error;
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
 *
 * ## Why this writes in chunks
 *
 * It used to insert one row per round trip and let the unique violation come
 * back as an error to count. Correct, and it does not survive its own success:
 * on 2026-09-02 the repair pass had 424 source rows producing ~1,600 events,
 * and two passes could not finish inside the probe's five-minute ceiling. A
 * repair tool that gets slower as the ledger grows is one that fails exactly
 * when it is finally needed.
 *
 * `ON CONFLICT DO NOTHING` — which is what `ignoreDuplicates` compiles to —
 * moves the same decision into the database, one round trip per chunk instead
 * of per row. It is deliberately **not** the default upsert: that one *updates*
 * the conflicting row, and here it would rewrite financial history on every
 * repair pass rather than leave it alone.
 *
 * The counts stay exact rather than estimated, because `DO NOTHING` returns
 * only the rows it actually wrote. What is not returned was already there,
 * which is the same two numbers the per-row version reported.
 */

/**
 * Rows per statement.
 *
 * Small enough that one failure does not lose a large batch and that the
 * request stays well inside PostgREST's payload limits; large enough that the
 * round trips stop being the cost. Not tuned against a benchmark — it is a
 * bound, and the property that matters is that it is bounded at all.
 */
const USAGE_INSERT_CHUNK = 500;

export async function projectUsageEvents(
  supabase: SupabaseClient,
  events: readonly (BillableUsage & {
    ratingStatus: string;
    ratedCredits: CreditUnits | null;
    rateCardVersion: string | null;
  })[],
): Promise<{ inserted: number; alreadyPresent: number }> {
  let inserted = 0;

  for (let start = 0; start < events.length; start += USAGE_INSERT_CHUNK) {
    const chunk = events.slice(start, start + USAGE_INSERT_CHUNK).map((event) => ({
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
    }));

    const { data, error } = await supabase
      .from("billing_usage_events")
      .upsert(chunk, {
        // The unique index this table's idempotency rests on, named rather than
        // inferred so a second index appearing later cannot quietly become the
        // conflict target.
        onConflict: "source_kind,source_id,sku",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) throw error;
    inserted += (data ?? []).length;
  }

  // Everything projected that the database did not write was already there.
  return { inserted, alreadyPresent: events.length - inserted };
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
