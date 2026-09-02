import "server-only";
import { cache } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";
import { START_ATTEMPT_LIMITS, type DeepScanAccessMode, type DeepScanEntitlementFacts } from "./entitlement";
import type { AuthenticatedCompleteness, AuthenticatedCompletenessReason } from "./budgets";
import type { DeepScanProviderUsage } from "./provider-usage";
import type { AuthenticatedProductIntelligenceSnapshot } from "./schema";
import { retailChargeFor } from "@/modules/credits/retail";
import { resolveOperationCreditCost } from "@/modules/operations/billing";

/**
 * Persistence for Deep Scan sessions, snapshots and provider usage
 * (Sprint 5 §12, §19).
 *
 * Every query runs through the caller's request-scoped Supabase client, so RLS
 * is always in force — there is no service-role path here, and ownership is a
 * database guarantee rather than an `if` statement.
 *
 * Two rules shape this file:
 *
 *  1. **`provider_session_id` never reaches a client-facing payload.** It is a
 *     handle for fetching a live view or terminating a browser, so the safe
 *     read (`SESSION_COLUMNS`) omits it entirely and the one function that
 *     needs it says so in its name. RLS grants select on the row, so exclusion
 *     has to happen in the projection, not be hoped about.
 *  2. **Expiry is enforced on read.** A row can sit in `analyzing` past its
 *     `expires_at` if a process died mid-run. Callers must never treat such a
 *     row as live, so `isExpired` is applied wherever liveness is decided.
 */

export type DeepScanSessionStatus =
  | "created"
  | "waiting_for_login"
  | "analyzing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

/** Statuses in which a provider browser is still running and billing. */
export const LIVE_SESSION_STATUSES: DeepScanSessionStatus[] = ["created", "waiting_for_login", "analyzing"];

/** Terminal states that mean the user walked away rather than the system failing. */
const ABANDONED_STATUSES: DeepScanSessionStatus[] = ["cancelled", "expired"];

/**
 * Failures caused by the browser provider rather than by the user.
 *
 * `START_ATTEMPT_LIMITS.providerFailuresCountTowardLimit` is `false`, so these
 * are excluded when counting attempts: a browser-provider outage is our problem and
 * must not burn the user's retry budget.
 */
const PROVIDER_CAUSED_FAILURES = [
  "browser_provider_not_configured",
  "browser_session_create_failed",
  "browser_provider_unavailable",
  "browser_connection_failed",
];

/** The client-safe projection. `provider_session_id` is deliberately absent. */
const SESSION_COLUMNS =
  "id, project_id, provider, origin, status, access_mode, failure_code, expires_at, terminated_at, created_at, updated_at";

export type StoredDeepScanSession = {
  id: string;
  projectId: string;
  provider: string;
  origin: string;
  status: DeepScanSessionStatus;
  accessMode: DeepScanAccessMode;
  failureCode: string | null;
  expiresAt: string;
  terminatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SessionRow = {
  id: string;
  project_id: string;
  provider: string;
  origin: string;
  status: DeepScanSessionStatus;
  access_mode: DeepScanAccessMode;
  failure_code: string | null;
  expires_at: string;
  terminated_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapSession(row: SessionRow): StoredDeepScanSession {
  return {
    id: row.id,
    projectId: row.project_id,
    provider: row.provider,
    origin: row.origin,
    status: row.status,
    accessMode: row.access_mode,
    failureCode: row.failure_code,
    expiresAt: row.expires_at,
    terminatedAt: row.terminated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** True when the session's wall-clock bound has passed, whatever its stored status says. */
export function isExpired(session: { expiresAt: string }, now: Date = new Date()): boolean {
  const expiry = Date.parse(session.expiresAt);
  return Number.isFinite(expiry) && expiry <= now.getTime();
}

/** True when a provider browser should still be considered running. */
export function isLive(session: StoredDeepScanSession, now: Date = new Date()): boolean {
  return LIVE_SESSION_STATUSES.includes(session.status) && !isExpired(session, now);
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

export type CreateSessionResult =
  | { ok: true; session: StoredDeepScanSession }
  | { ok: false; error: "scan_already_running" }
  | { ok: false; error: "persist_failed"; message: string };

/**
 * Records a browser session that has already been created at the provider.
 *
 * The partial unique index on live statuses turns a double submission into a
 * constraint violation reported as `scan_already_running`, so two remote
 * browsers cannot be started — and paid for — for one project.
 */
export async function createSessionRecord(
  supabase: SupabaseClient,
  params: {
    /**
     * The row's id, minted by the caller.
     *
     * Supplied rather than defaulted because the Credit hold for a paid scan is
     * taken *before* this row exists — the hold must precede any provider spend
     * — and both need the same identity. See `billing.ts`.
     */
    id: string;
    projectId: string;
    provider: string;
    providerSessionId: string;
    origin: string;
    accessMode: DeepScanAccessMode;
    expiresAt: Date;
  },
): Promise<CreateSessionResult> {
  const { data, error } = await supabase
    .from("authenticated_browser_sessions")
    .insert({
      id: params.id,
      project_id: params.projectId,
      provider: params.provider,
      provider_session_id: params.providerSessionId,
      origin: params.origin,
      access_mode: params.accessMode,
      status: "created",
      expires_at: params.expiresAt.toISOString(),
    })
    .select(SESSION_COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "scan_already_running" };
    return { ok: false, error: "persist_failed", message: error.message };
  }

  return { ok: true, session: mapSession(data as SessionRow) };
}

/** Client-safe read of one session the caller owns (RLS scopes it). */
export async function getSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<StoredDeepScanSession | null> {
  const { data, error } = await supabase
    .from("authenticated_browser_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapSession(data as SessionRow) : null;
}

/**
 * Server-only read that additionally returns the provider's session id.
 *
 * Named for what it exposes so a call site cannot reach for it absent-mindedly.
 * The result must never be returned from a Server Action or route handler —
 * only used to fetch a live view or terminate the browser.
 */
export async function getSessionWithProviderId(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<(StoredDeepScanSession & { providerSessionId: string }) | null> {
  const { data, error } = await supabase
    .from("authenticated_browser_sessions")
    .select(`${SESSION_COLUMNS}, provider_session_id`)
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as SessionRow & { provider_session_id: string };
  return { ...mapSession(row), providerSessionId: row.provider_session_id };
}

/** The project's current live session, if any. Expiry is applied on read. */
export async function getActiveSession(
  supabase: SupabaseClient,
  projectId: string,
  now: Date = new Date(),
): Promise<StoredDeepScanSession | null> {
  const { data, error } = await supabase
    .from("authenticated_browser_sessions")
    .select(SESSION_COLUMNS)
    .eq("project_id", projectId)
    .in("status", LIVE_SESSION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const session = mapSession(data as SessionRow);
  // A row still marked live but past its bound is not live. Reporting it as
  // such would block the project forever behind a browser that is already gone.
  return isExpired(session, now) ? null : session;
}

/**
 * The most recent session for a project, whatever its state.
 *
 * Used only to explain what happened last ("expired", "cancelled") — the
 * *eligibility* question is never answered from this row, because that is the
 * entitlement policy's job (Sprint 5 §13).
 */
export async function getLatestSession(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredDeepScanSession | null> {
  const { data, error } = await supabase
    .from("authenticated_browser_sessions")
    .select(SESSION_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapSession(data as SessionRow) : null;
}

export async function updateSessionStatus(
  supabase: SupabaseClient,
  sessionId: string,
  status: DeepScanSessionStatus,
  failureCode?: string,
): Promise<void> {
  const { error } = await supabase
    .from("authenticated_browser_sessions")
    .update({
      status,
      // The table's check constraint allows a failure code only on `failed`.
      failure_code: status === "failed" ? (failureCode ?? "analysis_failed") : null,
    })
    .eq("id", sessionId);

  if (error) throw error;
}

/**
 * Records that the provider session has been released. Idempotent by design:
 * termination is attempted on every terminal path, including ones that may run
 * twice.
 */
export async function markSessionTerminated(supabase: SupabaseClient, sessionId: string): Promise<void> {
  const { error } = await supabase
    .from("authenticated_browser_sessions")
    .update({ terminated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("terminated_at", null);

  if (error) {
    // Cleanup bookkeeping must not fail an operation the user already
    // completed; the reclaim index still finds anything left behind.
    console.error("[deep-scan] failed to mark session terminated", { sessionId });
  }
}

// ---------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------

export type DeepScanSnapshotStatus = "pending" | "analyzing" | "completed" | "failed";

export type StoredAuthenticatedSnapshot = {
  id: string;
  projectId: string;
  sessionId: string | null;
  origin: string;
  status: DeepScanSnapshotStatus;
  accessMode: DeepScanAccessMode;
  completeness: AuthenticatedCompleteness | null;
  completenessReasons: AuthenticatedCompletenessReason[];
  pagesInspected: number;
  failureCode: string | null;
  result: AuthenticatedProductIntelligenceSnapshot | null;
  createdAt: string;
  completedAt: string | null;
};

type SnapshotRow = {
  id: string;
  project_id: string;
  session_id: string | null;
  origin: string;
  status: DeepScanSnapshotStatus;
  access_mode: DeepScanAccessMode;
  completeness: AuthenticatedCompleteness | null;
  completeness_reasons: string[] | null;
  pages_inspected: number;
  failure_code: string | null;
  result: AuthenticatedProductIntelligenceSnapshot | null;
  created_at: string;
  completed_at: string | null;
};

const SNAPSHOT_COLUMNS =
  "id, project_id, session_id, origin, status, access_mode, completeness, completeness_reasons, pages_inspected, failure_code, result, created_at, completed_at";

function mapSnapshot(row: SnapshotRow): StoredAuthenticatedSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    origin: row.origin,
    status: row.status,
    accessMode: row.access_mode,
    completeness: row.completeness,
    completenessReasons: (row.completeness_reasons ?? []) as AuthenticatedCompletenessReason[],
    pagesInspected: row.pages_inspected,
    failureCode: row.failure_code,
    result: row.result,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/** The snapshot shown on the project page and fed to a later audit. */
/**
 * Deduplicated per request (VB-022).
 *
 * The Business Health render asks fourteen questions at once and several of the
 * services answering them re-read the same documents underneath — the audit
 * three times, the repository snapshot four. Each is a JSONB document, so the
 * cost is bytes off the wire and parse time, repeated.
 *
 * `cache()` is per-render, keyed on the arguments — which works here only
 * because every caller in a render shares the one `supabase` instance
 * `requireProjectAccess` returned. A caller that made its own client would miss
 * the cache rather than get a stale answer, which is the right way round.
 *
 * Outside a render it does not memoize at all — measured, not assumed — so
 * durable execution keeps reading fresh state. That is what makes this safe to
 * put on a store shared with the workflow steps.
 */
async function getLatestSuccessfulAuthenticatedSnapshotUncached(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredAuthenticatedSnapshot | null> {
  const { data, error } = await supabase
    .from("authenticated_product_intelligence_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapSnapshot(data as SnapshotRow) : null;
}

export const getLatestSuccessfulAuthenticatedSnapshot = cache(getLatestSuccessfulAuthenticatedSnapshotUncached);

export type CreateSnapshotRunResult =
  | { ok: true; snapshotId: string }
  | { ok: false; error: "already_running" }
  | { ok: false; error: "persist_failed"; message: string };

export async function createSnapshotRun(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    sessionId: string;
    origin: string;
    analyzerVersion: string;
    schemaVersion: string;
    accessMode: DeepScanAccessMode;
  },
): Promise<CreateSnapshotRunResult> {
  const { data, error } = await supabase
    .from("authenticated_product_intelligence_snapshots")
    .insert({
      project_id: params.projectId,
      session_id: params.sessionId,
      origin: params.origin,
      analyzer_version: params.analyzerVersion,
      schema_version: params.schemaVersion,
      access_mode: params.accessMode,
      status: "analyzing",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_running" };
    return { ok: false, error: "persist_failed", message: error.message };
  }

  return { ok: true, snapshotId: data.id };
}

export type CompleteSnapshotResult =
  | { ok: true }
  /**
   * The one-included-scan unique index rejected the write. The application
   * check was raced or bypassed, and the database refused to let the project's
   * included entitlement be consumed twice (Sprint 5 §5).
   */
  | { ok: false; error: "included_scan_already_consumed" }
  | { ok: false; error: "persist_failed"; message: string };

/**
 * Persists the completed snapshot. **This write is what consumes the included
 * entitlement** — there is no separate flag to set, because a second source of
 * truth could drift from the snapshots and produce the state §5 forbids.
 */
export async function completeSnapshotRun(
  supabase: SupabaseClient,
  snapshotId: string,
  snapshot: AuthenticatedProductIntelligenceSnapshot,
): Promise<CompleteSnapshotResult> {
  const { error } = await supabase
    .from("authenticated_product_intelligence_snapshots")
    .update({
      status: "completed",
      result: snapshot,
      completeness: snapshot.completeness.status,
      completeness_reasons: snapshot.completeness.reasons,
      pages_inspected: snapshot.crawl.pagesInspected,
      completed_at: new Date().toISOString(),
    })
    .eq("id", snapshotId);

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      return { ok: false, error: "included_scan_already_consumed" };
    }
    return { ok: false, error: "persist_failed", message: error.message };
  }

  return { ok: true };
}

/**
 * Marks a run failed with a typed code only. A failed row never carries a
 * `result`, so it can neither displace the latest successful snapshot nor
 * consume the included entitlement (Sprint 5 §5, §24).
 */
export async function failSnapshotRun(
  supabase: SupabaseClient,
  snapshotId: string,
  failureCode: string,
): Promise<void> {
  const { error } = await supabase
    .from("authenticated_product_intelligence_snapshots")
    .update({ status: "failed", failure_code: failureCode, completed_at: new Date().toISOString() })
    .eq("id", snapshotId);

  if (error) {
    console.error("[deep-scan] failed to record snapshot failure", { snapshotId });
  }
}

// ---------------------------------------------------------------------
// Entitlement facts
// ---------------------------------------------------------------------

/**
 * Gathers everything `authorizeDeepScan` needs, straight from the tables that
 * are the source of truth.
 *
 * `hasSuccessfulIncludedScan` is **derived** from the existence of a completed
 * snapshot funded by the included mode — never read from a flag, so it cannot
 * disagree with the snapshots the user can actually see.
 *
 * The price and the balance are read here, not decided here: the entitlement
 * module holds no pricing knowledge on purpose, so this is where the two meet.
 * A project that still has its included scan needs neither, and the balance
 * lookup is skipped for it — rendering the panel for a new project must not
 * mint a Credit account as a side effect.
 */
export async function gatherEntitlementFacts(
  supabase: SupabaseClient,
  params: { projectId: string; productionOrigin: string | null; now?: Date },
): Promise<DeepScanEntitlementFacts> {
  const now = params.now ?? new Date();
  const windowStart = new Date(now.getTime() - START_ATTEMPT_LIMITS.windowMs).toISOString();

  const [consumed, active, recent, abandoned] = await Promise.all([
    supabase
      .from("authenticated_product_intelligence_snapshots")
      .select("id")
      .eq("project_id", params.projectId)
      .eq("status", "completed")
      .eq("access_mode", "included_first_scan")
      .limit(1)
      .maybeSingle(),

    getActiveSession(supabase, params.projectId, now),

    supabase
      .from("authenticated_browser_sessions")
      .select("id, status, failure_code")
      .eq("project_id", params.projectId)
      .gte("created_at", windowStart),

    supabase
      .from("authenticated_browser_sessions")
      .select("updated_at")
      .eq("project_id", params.projectId)
      .in("status", ABANDONED_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const recentRows = (recent.data ?? []) as { status: DeepScanSessionStatus; failure_code: string | null }[];
  const recentStartCount = START_ATTEMPT_LIMITS.providerFailuresCountTowardLimit
    ? recentRows.length
    : recentRows.filter(
        (row) => !(row.status === "failed" && row.failure_code !== null && PROVIDER_CAUSED_FAILURES.includes(row.failure_code)),
      ).length;

  const lastAbandonedRaw = (abandoned.data as { updated_at: string } | null)?.updated_at ?? null;
  const lastAbandonedAt = lastAbandonedRaw ? new Date(lastAbandonedRaw) : null;

  const price = retailChargeFor("deep_scan", now);
  const additionalScanPrice = price.kind === "charge" ? price.creditUnits : null;

  const hasSuccessfulIncludedScan = consumed.data !== null;

  // Read-only, and only when it can matter. `resolveOperationCreditCost` looks
  // a wallet up rather than ensuring one, so a project that has never spent
  // anything reports a balance of zero — which is the true answer.
  const cost =
    hasSuccessfulIncludedScan && additionalScanPrice !== null
      ? await resolveOperationCreditCost(supabase, {
          projectId: params.projectId,
          operation: "deep_scan",
          now,
        })
      : null;

  return {
    hasSuccessfulIncludedScan,
    additionalScanPrice,
    availableCredits: cost?.availableCredits ?? 0,
    hasLiveSession: active !== null,
    recentStartCount,
    lastAbandonedAt: lastAbandonedAt && Number.isFinite(lastAbandonedAt.getTime()) ? lastAbandonedAt : null,
    productionOrigin: params.productionOrigin,
    now,
  };
}

// ---------------------------------------------------------------------
// Provider usage
// ---------------------------------------------------------------------

/**
 * Writes one browser-provider usage record. Never throws: losing a cost record
 * must not fail a scan the user already completed, and the failure is logged
 * for operational follow-up instead.
 */
export async function recordDeepScanUsage(
  supabase: SupabaseClient,
  usage: DeepScanProviderUsage,
): Promise<void> {
  const { error } = await supabase.from("deep_scan_provider_usage").insert({
    project_id: usage.projectId,
    session_id: usage.sessionId,
    provider: usage.provider,
    operation: usage.operation,
    access_mode: usage.accessMode,
    status: usage.status,
    started_at: usage.startedAt.toISOString(),
    ended_at: usage.endedAt.toISOString(),
    duration_ms: usage.durationMs,
    pages_inspected: usage.pagesInspected,
    // Stays null until a provider reports a real figure.
    provider_cost_usd: usage.providerCostUsd,
    // The dimensions the rate applies to, and Vibe's derivation from them
    // (ADR 0076). Deliberately not `provider_cost_usd`: that column means "the
    // provider charged this" everywhere else, and overloading it would let an
    // assumption be summed as a measurement.
    active_cpu_ms: usage.activeCpuMs,
    network_egress_bytes: usage.outboundBytes,
    estimated_cost_nano_usd: usage.estimatedCostNanoUsd,
    cost_pricing_version: usage.costPricingVersion,
    vcpus: usage.vcpus,
  });

  if (error) {
    console.error("[deep-scan] failed to record provider usage", {
      sessionId: usage.sessionId,
      status: usage.status,
      message: error.message,
    });
  }
}
