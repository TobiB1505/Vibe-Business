import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { listActiveLots, listReservationAllocations } from "../lot-store";
import type { CreditUnits } from "../units";

/**
 * The real-database concurrency harness (Sprint 0057 E2b, ADR 0040).
 *
 * ## What this exists to test, and why it is not a unit test
 *
 * Every financial invariant in this repository is otherwise asserted against
 * `FakeDatabase` — a hand-written re-implementation. E1 reproduced eleven
 * defects there and named the ceiling honestly: the fake models statement
 * atomicity and does not serialize the sequences around it, so it reaches lost
 * updates faithfully and cannot reach MVCC, real row locks, or real request
 * arrival order.
 *
 * This drives the same application functions through the path production uses:
 *
 * ```
 * application billing code → @supabase/supabase-js → PostgREST → PostgreSQL
 * ```
 *
 * There is deliberately **no PostgreSQL driver**. `admitHold` compare-and-swaps
 * *because* PostgREST can express neither a column-relative update nor a
 * multi-statement transaction, so a proof over a direct connection would be a
 * proof about different code.
 *
 * ## Where it may run
 *
 * A disposable local Supabase stack and nothing else. See {@link resolveTarget}
 * — the guard is structural rather than a policy, because the harness reads
 * only its own variable names and never the application's.
 */

/* ---------------------------------------------------------------------------
 * The target guard
 * ------------------------------------------------------------------------ */

/**
 * The deployed project, named here so refusing it is explicit rather than
 * implied by the loopback rule.
 *
 * This is a public project reference, not a credential: it is the subdomain in
 * `NEXT_PUBLIC_SUPABASE_URL`, which ships to every browser.
 */
const DEPLOYED_PROJECT_REF = "dcbwlctscooefwnivxzv";

/** Hosts a disposable local stack can legitimately answer on. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * The harness reads **only** these names.
 *
 * Never `NEXT_PUBLIC_SUPABASE_URL`, never `SUPABASE_SERVICE_ROLE_KEY`. That is
 * the whole mechanism: a race matrix writes deliberately conflicting rows into
 * an append-only ledger, so the deployed database must be unreachable by
 * construction and not by anybody remembering a rule. Adding a secret to the
 * workflow later would not make it reachable, because nothing here would read
 * it.
 */
const URL_VAR = "CONCURRENCY_SUPABASE_URL";
const KEY_VAR = "CONCURRENCY_SERVICE_ROLE_KEY";

export type Target = { url: string; serviceRoleKey: string };

export class UnsafeTargetError extends Error {
  constructor(reason: string) {
    super(
      `Refusing to run the concurrency harness: ${reason}. ` +
        `It runs only against a disposable local Supabase stack — see ADR 0040.`,
    );
    this.name = "UnsafeTargetError";
  }
}

/**
 * Resolves and validates the target, or throws.
 *
 * Called before the first write of every run. Three independent checks, and a
 * failure names which one failed without echoing any value — a message that
 * quotes the URL would put a key-adjacent string into CI logs for no gain.
 */
export function resolveTarget(): Target {
  const url = process.env[URL_VAR];
  const serviceRoleKey = process.env[KEY_VAR];

  if (!url) throw new UnsafeTargetError(`${URL_VAR} is not set`);
  if (!serviceRoleKey) throw new UnsafeTargetError(`${KEY_VAR} is not set`);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeTargetError(`${URL_VAR} is not a URL`);
  }

  // 1. Loopback only. A local stack answers nowhere else.
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new UnsafeTargetError(`${URL_VAR} does not point at loopback`);
  }

  // 2. The deployed project by name, refused explicitly. Redundant with the
  //    loopback rule today, and the redundancy is the point: it survives
  //    somebody deciding loopback is too strict.
  if (url.includes(DEPLOYED_PROJECT_REF)) {
    throw new UnsafeTargetError(`${URL_VAR} names the deployed project`);
  }

  // 3. The application's own variables must not be what we are holding. If
  //    somebody exports them into this process, an accidental copy into the
  //    harness names would otherwise pass checks 1 and 2 on a local value and
  //    fail open on a remote one.
  if (serviceRoleKey === process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new UnsafeTargetError(`${KEY_VAR} carries the application's service role key`);
  }

  return { url, serviceRoleKey };
}

/** True when the harness can run at all. Drives `describe.skipIf`. */
export function isConfigured(): boolean {
  try {
    resolveTarget();
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * Clients
 * ------------------------------------------------------------------------ */

/**
 * One client per simulated caller.
 *
 * Deliberately not a shared singleton. Independent instances mean independent
 * HTTP requests rather than calls queued behind one another inside a single
 * client, which is what makes the interleaving real instead of simulated.
 *
 * The service role is used for the same reason the six existing probes use it:
 * every billing table has a select policy and no write policy, so a
 * request-scoped client cannot perform the writes under test. It is obtained by
 * calling `createClient` here rather than importing `@/lib/supabase/service`,
 * which `service-boundary.test.ts` gates on and which belongs to durable
 * execution (rule 53).
 */
export function client(target: Target = resolveTarget()): SupabaseClient {
  return createClient(target.url, target.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** `count` independent clients, one per concurrent caller. */
export function clients(count: number, target: Target = resolveTarget()): SupabaseClient[] {
  return Array.from({ length: count }, () => client(target));
}

/* ---------------------------------------------------------------------------
 * Error classification
 * ------------------------------------------------------------------------ */

export type ClassifiedError = {
  /** The SQLSTATE PostgreSQL raised, when PostgREST passed one through. */
  pgCode: string | null;
  /** A fixed label, never the message — messages can carry row values. */
  kind:
    | "unique_violation" // 23505
    | "check_violation" // 23514
    | "foreign_key_violation" // 23503
    | "not_null_violation" // 23502
    | "serialization_failure" // 40001
    | "deadlock_detected" // 40P01
    | "insufficient_privilege" // 42501 — the auto_expose_new_tables assumption
    | "lock_not_available" // 55P03
    | "other";
};

const CODE_KINDS: Record<string, ClassifiedError["kind"]> = {
  "23505": "unique_violation",
  "23514": "check_violation",
  "23503": "foreign_key_violation",
  "23502": "not_null_violation",
  "40001": "serialization_failure",
  "40P01": "deadlock_detected",
  "42501": "insufficient_privilege",
  "55P03": "lock_not_available",
};

/**
 * Names what the database said, without repeating what it said.
 *
 * Nothing here logs a URL, a key, or a message body. What a race needs to
 * report is the SQLSTATE and a fixed label; a message may contain the row that
 * conflicted, and a conflicting row in a CI log is a financial detail in a CI
 * log.
 */
export function classifyError(error: unknown): ClassifiedError {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : null;

  return { pgCode: code, kind: (code === null ? undefined : CODE_KINDS[code]) ?? "other" };
}

/* ---------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

/**
 * One synthetic auth user per iteration.
 *
 * `billing_credit_accounts.user_id` references `auth.users`, so a fixture needs
 * a real user. It is created through the Auth admin API over HTTP — the same
 * way the application creates users — rather than by writing the `auth` schema
 * directly, which PostgREST does not expose and which would need a driver.
 *
 * Every row an iteration creates hangs off this user, so deleting it is the
 * whole teardown.
 */
export async function createFixtureUser(
  supabase: SupabaseClient,
  label: string,
): Promise<{ userId: string; email: string }> {
  const email = `e2b-${label}-${crypto.randomUUID()}@concurrency.invalid`;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    // Not a secret: this account exists for one iteration against a database
    // that is deleted when the job ends, and nothing ever signs in as it.
    password: crypto.randomUUID(),
    email_confirm: true,
  });

  if (error) throw error;
  if (!data.user) throw new Error("the auth admin API returned no user");
  return { userId: data.user.id, email };
}

/** What a teardown removed, and what it could not. */
export type TeardownReport = { userId: string; remaining: Record<string, number> };

/**
 * Tables an iteration can write, in the order they must be deleted.
 *
 * Deleting the auth user does **not** clean up on its own, and finding that out
 * from a failing `finally` would have masked whichever race actually failed.
 * `billing_credit_accounts` cascades from `auth.users`, and
 * `billing_credit_grants`, `billing_credit_reservations` and
 * `billing_credit_ledger` cascade from the account — but
 * `billing_credit_allocations` references grants and reservations
 * `ON DELETE RESTRICT`. A cascade that reaches a grant while an allocation
 * still points at it raises `23503`, and PostgreSQL does not promise to
 * process the cascade in an order that avoids it.
 *
 * So the allocations go first, explicitly.
 */
const FIXTURE_TABLES = [
  "billing_credit_allocations",
  "billing_credit_reservations",
  "billing_credit_grants",
  "billing_credit_ledger",
] as const;

/**
 * Removes everything an iteration created, then checks that it did.
 *
 * The check is the point. A teardown that assumes it worked turns the next
 * iteration's exact counts into someone else's leftovers, and the assertion
 * that fails is three scenarios away from the cause. The report is returned
 * rather than thrown so that a genuine race failure keeps precedence over a
 * cleanup problem — the caller asserts on it after the loop, where a failing
 * loop has already won.
 */
export async function teardownFixture(
  supabase: SupabaseClient,
  userId: string,
): Promise<TeardownReport> {
  const account = await supabase
    .from("billing_credit_accounts")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (account.error) throw account.error;

  const accountId = (account.data as { id: string } | null)?.id ?? null;
  const remaining: Record<string, number> = {};

  if (accountId) {
    for (const table of FIXTURE_TABLES) {
      const { error } = await supabase.from(table).delete().eq("credit_account_id", accountId);
      if (error) throw error;
    }

    const { error } = await supabase.from("billing_credit_accounts").delete().eq("id", accountId);
    if (error) throw error;

    for (const table of FIXTURE_TABLES) {
      const { count, error: countError } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("credit_account_id", accountId);
      if (countError) throw countError;
      if ((count ?? 0) > 0) remaining[table] = count ?? 0;
    }
  }

  const { error: userError } = await supabase.auth.admin.deleteUser(userId);
  if (userError) throw userError;

  const survivors = await supabase
    .from("billing_credit_accounts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (survivors.error) throw survivors.error;
  if ((survivors.count ?? 0) > 0) remaining.billing_credit_accounts = survivors.count ?? 0;

  return { userId, remaining };
}

/** True when a teardown removed everything it was responsible for. */
export function isClean(report: TeardownReport): boolean {
  return Object.keys(report.remaining).length === 0;
}

/* ---------------------------------------------------------------------------
 * Persisted state
 * ------------------------------------------------------------------------ */

export type PersistedInvariants = {
  postedCredits: number;
  reservedCredits: number;
  /** `posted - reserved`, the quantity the CHECK constraint protects. */
  available: number;
  /** Summed from the append-only ledger, never read from the cache column. */
  ledgerSum: number;
  ledgerEntries: number;
  chargeEntries: number;
  activeReservations: number;
  /** Summed from the active reservation rows, never from the cache column. */
  activeReservedSum: number;
  reservationStatuses: Record<string, number>;
};

/**
 * The picture the database actually holds, read back after a race.
 *
 * Every figure here is read from rows rather than taken from a return value. A
 * fulfilled promise proves that a caller was told something; only this proves
 * what is true. The two cache columns and the two sums are read separately on
 * purpose — a lost update shows up as exactly the disagreement between them.
 */
export async function readInvariants(
  supabase: SupabaseClient,
  creditAccountId: string,
): Promise<PersistedInvariants> {
  const account = await supabase
    .from("billing_credit_accounts")
    .select("posted_credits, reserved_credits")
    .eq("id", creditAccountId)
    .single();
  if (account.error) throw account.error;

  const ledger = await supabase
    .from("billing_credit_ledger")
    .select("credit_delta, kind")
    .eq("credit_account_id", creditAccountId);
  if (ledger.error) throw ledger.error;

  const reservations = await supabase
    .from("billing_credit_reservations")
    .select("status, reserved_credits")
    .eq("credit_account_id", creditAccountId);
  if (reservations.error) throw reservations.error;

  const posted = (account.data as { posted_credits: number }).posted_credits;
  const reserved = (account.data as { reserved_credits: number }).reserved_credits;

  const ledgerRows = (ledger.data ?? []) as { credit_delta: number; kind: string }[];
  const reservationRows = (reservations.data ?? []) as {
    status: string;
    reserved_credits: number;
  }[];

  const statuses: Record<string, number> = {};
  for (const row of reservationRows) statuses[row.status] = (statuses[row.status] ?? 0) + 1;

  const active = reservationRows.filter((row) => row.status === "active");

  return {
    postedCredits: posted,
    reservedCredits: reserved,
    available: posted - reserved,
    ledgerSum: ledgerRows.reduce((total, row) => total + row.credit_delta, 0),
    ledgerEntries: ledgerRows.length,
    chargeEntries: ledgerRows.filter((row) => row.kind === "charge").length,
    activeReservations: active.length,
    activeReservedSum: active.reduce((total, row) => total + row.reserved_credits, 0),
    reservationStatuses: statuses,
  };
}

/** Capacity taken across every lot on an account, read back from the rows. */
export async function readAllocatedAcrossLots(
  supabase: SupabaseClient,
  creditAccountId: string,
): Promise<number> {
  const lots = await listActiveLots(supabase, creditAccountId);
  return lots.reduce<number>((total, lot) => total + lot.allocatedCreditUnits, 0);
}

/** Allocation rows for one reservation, as `(grantId, creditUnits)` pairs. */
export async function readAllocationPairs(
  supabase: SupabaseClient,
  reservationId: string,
): Promise<{ grantId: string; creditUnits: CreditUnits }[]> {
  const rows = await listReservationAllocations(supabase, reservationId);
  return rows.map((row) => ({ grantId: row.grantId, creditUnits: row.creditUnits }));
}

/* ---------------------------------------------------------------------------
 * Repetition
 * ------------------------------------------------------------------------ */

/**
 * How many times each race class is run.
 *
 * A race that occurs with probability *p* per attempt is missed by *n* attempts
 * with probability (1 − *p*)ⁿ. At twenty: a 15% race is missed 3.9% of the
 * time, a 10% race 12%, a 5% race 36%. So twenty catches races of middling
 * frequency reliably and rare ones still not — which is the honest claim, and
 * repetition raises the chance of observing a defect rather than proving its
 * absence.
 *
 * Twenty is also what the runtime affords: four classes at twenty iterations
 * sits inside the container start that dominates the job.
 *
 * There is no retry and no tolerance threshold anywhere in this suite. One
 * safety violation in twenty iterations is a defect, not noise.
 */
export const ITERATIONS = 20;

/** Runs `body` for each iteration index, sequentially, so counts stay exact. */
export async function forEachIteration(
  body: (iteration: number) => Promise<void>,
): Promise<void> {
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    await body(iteration);
  }
}
