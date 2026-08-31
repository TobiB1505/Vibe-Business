import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReleaseReason } from "@/modules/credits/balance";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { analyzeAuthenticatedProduct } from "./analyzer";
import {
  holdDeepScanCredits,
  releaseDeepScanCredits,
  settleDeepScanCredits,
} from "./billing";
import { DEFAULT_AUTHENTICATED_BUDGETS } from "./budgets";
import {
  authorizeDeepScan,
  toDeepScanAccessStatus,
  type DeepScanAccessMode,
  type DeepScanAccessStatus,
  type DeepScanDenialReason,
} from "./entitlement";
import type { AuthenticatedAnalysisFailure } from "./errors";
import type { BrowserSessionProvider } from "./provider";
import { buildDeepScanUsage, type DeepScanUsageStatus } from "./provider-usage";
import {
  AUTHENTICATED_PRODUCT_ANALYZER_VERSION,
  AUTHENTICATED_PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
} from "./schema";
import {
  completeSnapshotRun,
  createSessionRecord,
  createSnapshotRun,
  failSnapshotRun,
  gatherEntitlementFacts,
  getActiveSession,
  getSessionWithProviderId,
  isExpired,
  isLive,
  markSessionTerminated,
  recordDeepScanUsage,
  updateSessionStatus,
  type StoredDeepScanSession,
} from "./store";

/**
 * Deep Scan orchestration (Sprint 5 §2–§14, §19).
 *
 * The lifecycle spans two user-initiated requests with a human in between:
 *
 *   startDeepScan   authorize → create browser → persist → live view
 *                   ── user signs in by hand in the Live View ──
 *   analyzeDeepScan reconnect → read-only analysis → persist → terminate
 *
 * Three invariants run through every path here:
 *
 *  1. **Authorization precedes provider spend.** `authorizeDeepScan` is
 *     evaluated before `createSession` is called, so a user who cannot run a
 *     scan never costs us a browser (§18).
 *  2. **Every terminal path terminates the browser.** Completion, failure,
 *     cancellation and expiry all release the provider session, and
 *     termination is idempotent because several of those can overlap (§14).
 *  3. **Capability URLs are used and dropped.** `connectUrl` and `liveViewUrl`
 *     are fetched per use, held in a local, and never persisted, logged, or
 *     returned beyond the one response that needs them (§10, §12).
 *
 * The entitlement is consumed by the snapshot write and nothing else — a
 * failure anywhere before it leaves the included scan available (§5).
 */

/** Provider session ceiling. Deliberately short: a human logging in, not a work session. */
const SESSION_TIMEOUT_SECONDS = 10 * 60;

/** Our own bound, kept at or under the provider's so neither can outlive the other. */
const SESSION_EXPIRY_MS = SESSION_TIMEOUT_SECONDS * 1000;

export type StartDeepScanFailure = DeepScanDenialReason | AuthenticatedAnalysisFailure | "project_not_found" | "persist_failed";

export type StartDeepScanResult =
  | {
      ok: true;
      sessionId: string;
      /** Capability URL for this response only. Never stored (§12). */
      liveViewUrl: string;
      expiresAt: string;
    }
  | { ok: false; error: StartDeepScanFailure };

export type AnalyzeDeepScanFailure =
  | AuthenticatedAnalysisFailure
  | "project_not_found"
  | "session_not_found"
  | "session_not_live"
  | "persist_failed"
  | "included_scan_already_consumed";

export type AnalyzeDeepScanResult =
  | { ok: true; snapshotId: string; pagesInspected: number }
  | { ok: false; error: AnalyzeDeepScanFailure };

type ProjectRow = { id: string; production_url: string | null };

/** Loads a project the caller owns. RLS enforces it; the explicit filter documents it. */
async function loadOwnedProject(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<ProjectRow | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, production_url")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as ProjectRow | null) ?? null;
}

/**
 * Releases the provider browser and records that we did.
 *
 * Best-effort and never throwing: this runs on failure paths where something
 * has already gone wrong, and an exception here would mask the original cause
 * while still leaving a browser running.
 */
async function terminate(
  supabase: SupabaseClient,
  provider: BrowserSessionProvider,
  providerSessionId: string,
  sessionId: string,
): Promise<void> {
  try {
    await provider.terminateSession(providerSessionId);
  } catch {
    // A provider that cannot be told to stop will still hit its own timeout.
  }
  await markSessionTerminated(supabase, sessionId);
}

/** Writes the browser-provider usage record for a finished run. */
async function recordUsage(
  supabase: SupabaseClient,
  params: {
    provider: string;
    projectId: string;
    session: Pick<StoredDeepScanSession, "id" | "accessMode" | "createdAt">;
    status: DeepScanUsageStatus;
    pagesInspected?: number | null;
  },
): Promise<void> {
  await recordDeepScanUsage(
    supabase,
    buildDeepScanUsage({
      provider: params.provider,
      projectId: params.projectId,
      sessionId: params.session.id,
      accessMode: params.session.accessMode,
      startedAt: new Date(params.session.createdAt),
      endedAt: new Date(),
      status: params.status,
      pagesInspected: params.pagesInspected ?? null,
    }),
  );
}

/**
 * Step 1: authorize, open a temporary browser, and hand the user a Live View
 * to sign in through.
 */
export async function startDeepScan(
  supabase: SupabaseClient,
  provider: BrowserSessionProvider,
  params: { projectId: string; userId: string },
): Promise<StartDeepScanResult> {
  const project = await loadOwnedProject(supabase, params.projectId, params.userId);
  if (!project) return { ok: false, error: "project_not_found" };

  const facts = await gatherEntitlementFacts(supabase, {
    projectId: params.projectId,
    productionOrigin: project.production_url,
  });

  // Before any provider call. A denial must never cost us a browser.
  const decision = authorizeDeepScan(facts);
  if (!decision.allowed) return { ok: false, error: decision.reason };

  const accessMode: DeepScanAccessMode = decision.accessMode;
  const origin = new URL(project.production_url!).origin;

  // Minted here, so the hold below has a durable identity and the session row
  // it belongs to carries the same one. See `billing.ts` for why the order is
  // id → hold → browser and not browser → row → hold.
  const sessionId = randomUUID();

  // Money before the browser (§18). An additional scan is Credit-priced under
  // `launch-v1`; the included scan resolves free and never reaches a
  // reservation. Discovering an empty wallet after paying Browserbase would be
  // both a cost leak and an insult.
  const held = await holdDeepScanCredits({ projectId: params.projectId, sessionId, accessMode });
  if (!held.ok) {
    return {
      ok: false,
      error: held.refusal === "operation_not_priced" ? "credits_required" : "insufficient_credits",
    };
  }

  const releaseHold = async (reason: ReleaseReason) => {
    await releaseDeepScanCredits({ projectId: params.projectId, sessionId, reason });
  };

  const created = await provider.createSession({ timeoutSeconds: SESSION_TIMEOUT_SECONDS });
  if (!created.ok) {
    // The provider never gave us a browser. Nothing was delivered, so nothing
    // is owed — the same rule the included scan has always followed.
    await releaseHold("failed_without_usage");
    return { ok: false, error: created.error };
  }

  const handle = created.value;

  // Our expiry never exceeds the provider's, so the browser cannot outlive the
  // bound we enforce on every read.
  const providerExpiry = handle.expiresAt ? Date.parse(handle.expiresAt) : Number.NaN;
  const ownExpiry = Date.now() + SESSION_EXPIRY_MS;
  const expiresAt = new Date(Number.isFinite(providerExpiry) ? Math.min(providerExpiry, ownExpiry) : ownExpiry);

  const record = await createSessionRecord(supabase, {
    id: sessionId,
    projectId: params.projectId,
    provider: provider.name,
    providerSessionId: handle.providerSessionId,
    origin,
    accessMode,
    expiresAt,
  });

  if (!record.ok) {
    // We already paid for a browser we are not going to use — release it
    // immediately rather than letting it idle to its timeout.
    await provider.terminateSession(handle.providerSessionId).catch(() => undefined);
    // Our own persistence failing is explicitly one of the six outcomes that
    // must not cost the user anything (PRODUCT.md §12.1). Vibe still paid
    // Browserbase, which is what `abandoned_with_usage` records.
    await releaseHold("abandoned_with_usage");
    return record.error === "scan_already_running"
      ? { ok: false, error: "scan_already_running" }
      : { ok: false, error: "persist_failed" };
  }

  const session = record.session;

  // Land the browser on the user's own site before they ever see it. Best
  // effort by design: if their site is slow or down, they still get a working
  // browser and can navigate by hand — a failed navigation must not cost them
  // a session that was already created and paid for.
  //
  // Loaded here, not at module scope, for the same reason as in
  // `analyzeDeepScan`: this pulls in the browser stack, and rendering the
  // project page must never do that.
  try {
    const { openSessionAtOrigin } = await import("./playwright/connector");
    await openSessionAtOrigin(handle.connectUrl, origin);
  } catch {
    // The user can still navigate manually; nothing here is worth failing on.
  }

  const liveView = await provider.getLiveView(handle.providerSessionId);
  if (!liveView.ok) {
    await updateSessionStatus(supabase, session.id, "failed", "browser_session_create_failed");
    await terminate(supabase, provider, handle.providerSessionId, session.id);
    await recordUsage(supabase, {
      provider: provider.name,
      projectId: params.projectId,
      session,
      status: "failed",
    });
    await releaseHold("abandoned_with_usage");
    return { ok: false, error: liveView.error };
  }

  await updateSessionStatus(supabase, session.id, "waiting_for_login");

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "deep_scan.started",
    metadata: {
      projectId: params.projectId,
      // Vibe's own session id and the access mode only — never the provider's
      // session id, and never a capability URL (§12, §32).
      sessionId: session.id,
      accessMode,
      provider: provider.name,
    },
  });

  return {
    ok: true,
    sessionId: session.id,
    liveViewUrl: liveView.value.url,
    expiresAt: session.expiresAt,
  };
}

/**
 * Re-issues a Live View URL for an owned, still-live session.
 *
 * Separate from `startDeepScan` so a reloaded page can recover its view
 * without opening a second browser. The URL is a capability: fetched fresh
 * here, returned once, never stored.
 */
export async function getDeepScanLiveView(
  supabase: SupabaseClient,
  provider: BrowserSessionProvider,
  params: { sessionId: string; userId: string },
): Promise<{ ok: true; liveViewUrl: string } | { ok: false; error: AnalyzeDeepScanFailure }> {
  const session = await getSessionWithProviderId(supabase, params.sessionId);
  if (!session) return { ok: false, error: "session_not_found" };

  // RLS already scoped the read to the caller's projects; this re-checks the
  // owning project explicitly so a change in policy cannot silently widen it.
  const project = await loadOwnedProject(supabase, session.projectId, params.userId);
  if (!project) return { ok: false, error: "project_not_found" };

  if (!isLive(session)) return { ok: false, error: "session_not_live" };

  const liveView = await provider.getLiveView(session.providerSessionId);
  if (!liveView.ok) return { ok: false, error: liveView.error };

  return { ok: true, liveViewUrl: liveView.value.url };
}

/**
 * Step 2: the user has signed in. Reconnect read-only, analyse, persist, and
 * release the browser.
 */
export async function analyzeDeepScan(
  supabase: SupabaseClient,
  provider: BrowserSessionProvider,
  params: { sessionId: string; userId: string },
): Promise<AnalyzeDeepScanResult> {
  const session = await getSessionWithProviderId(supabase, params.sessionId);
  if (!session) return { ok: false, error: "session_not_found" };

  const project = await loadOwnedProject(supabase, session.projectId, params.userId);
  if (!project) return { ok: false, error: "project_not_found" };

  if (isExpired(session)) {
    await updateSessionStatus(supabase, session.id, "expired");
    await terminate(supabase, provider, session.providerSessionId, session.id);
    await recordUsage(supabase, {
      provider: provider.name,
      projectId: session.projectId,
      session,
      status: "expired",
    });
    await releaseDeepScanCredits({
      projectId: session.projectId,
      sessionId: session.id,
      reason: "abandoned_with_usage",
    });
    return { ok: false, error: "browser_session_expired" };
  }

  if (!isLive(session)) return { ok: false, error: "session_not_live" };

  const fail = async (
    code: AuthenticatedAnalysisFailure,
    snapshotId: string | null,
  ): Promise<AnalyzeDeepScanResult> => {
    if (snapshotId) await failSnapshotRun(supabase, snapshotId, code);
    await updateSessionStatus(supabase, session.id, "failed", code);
    await terminate(supabase, provider, session.providerSessionId, session.id);
    await recordUsage(supabase, {
      provider: provider.name,
      projectId: session.projectId,
      session,
      status: "failed",
    });
    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "deep_scan.failed",
      metadata: { projectId: session.projectId, sessionId: session.id, reason: code },
    });
    // No snapshot, no charge. The single most important line in this file for a
    // paying customer, and the exact mirror of `consumesIncludedEntitlement`.
    await releaseDeepScanCredits({
      projectId: session.projectId,
      sessionId: session.id,
      reason: "abandoned_with_usage",
    });
    return { ok: false, error: code };
  };

  // The capability URL is fetched now and never stored (§10).
  const connection = await provider.getConnection(session.providerSessionId);
  if (!connection.ok) return fail(connection.error, null);

  await updateSessionStatus(supabase, session.id, "analyzing");

  const run = await createSnapshotRun(supabase, {
    projectId: session.projectId,
    sessionId: session.id,
    origin: session.origin,
    analyzerVersion: AUTHENTICATED_PRODUCT_ANALYZER_VERSION,
    schemaVersion: AUTHENTICATED_PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
    accessMode: session.accessMode,
  });

  if (!run.ok) {
    if (run.error === "already_running") {
      // Another analysis for this project is mid-flight. Leave it alone and
      // leave this browser to its own termination path.
      return { ok: false, error: "persist_failed" };
    }
    return fail("analysis_failed", null);
  }

  const [repository, publicProduct] = await Promise.all([
    getLatestSuccessfulSnapshot(supabase, session.projectId),
    getLatestSuccessfulLiveSnapshot(supabase, session.projectId),
  ]);

  let readOnly;
  try {
    // Loaded here, not at module scope, on purpose.
    //
    // `playwright-core` is a heavyweight native-ish dependency that a
    // serverless runtime only resolves correctly when it is actually needed.
    // A top-level import made *rendering the project page* pull it in — the
    // read path (`getDeepScanAccessStatus`) depended on the drive path — and
    // the whole page 500'd in production even though no scan was running.
    // Keeping it dynamic means the browser stack is loaded only by the one
    // code path that drives a browser.
    const { connectReadOnly } = await import("./playwright/connector");
    readOnly = await connectReadOnly(connection.value.connectUrl, session.origin);
  } catch {
    // Never surface the underlying transport error: it can carry the
    // capability URL we just used (§28).
    return fail("browser_connection_failed", run.snapshotId);
  }

  let analysis;
  try {
    analysis = await analyzeAuthenticatedProduct({
      origin: session.origin,
      sessionId: session.id,
      browserProvider: provider.name,
      browser: readOnly.port,
      repository: repository?.result ?? null,
      publicProduct: publicProduct?.result ?? null,
      budgets: DEFAULT_AUTHENTICATED_BUDGETS,
      browserSessionDurationMs: Date.now() - Date.parse(session.createdAt),
    });
  } catch {
    return fail("analysis_failed", run.snapshotId);
  } finally {
    // Close our CDP socket regardless. Terminating the provider session is a
    // separate decision, made below.
    await readOnly.disconnect().catch(() => undefined);
  }

  if (!analysis.ok) return fail(analysis.error, run.snapshotId);

  // This write is what consumes the included entitlement (§5).
  const persisted = await completeSnapshotRun(supabase, run.snapshotId, analysis.snapshot);

  if (!persisted.ok) {
    // The scan worked but we could not keep it. The entitlement stays
    // available, because consumption follows a persisted snapshot and nothing
    // else — the user must not lose their included scan to our storage failing.
    await failSnapshotRun(supabase, run.snapshotId, "analysis_failed");
    await updateSessionStatus(supabase, session.id, "failed", "analysis_failed");
    await terminate(supabase, provider, session.providerSessionId, session.id);
    await recordUsage(supabase, {
      provider: provider.name,
      projectId: session.projectId,
      session,
      status: "failed",
    });
    await releaseDeepScanCredits({
      projectId: session.projectId,
      sessionId: session.id,
      reason: "abandoned_with_usage",
    });
    return {
      ok: false,
      error: persisted.error === "included_scan_already_consumed" ? "included_scan_already_consumed" : "persist_failed",
    };
  }

  // The snapshot is persisted, which is the one event that consumes anything —
  // the included scan for a free run, Credits for a paid one. Settled after the
  // persist for the same reason the entitlement is derived from it: the
  // snapshot's existence is the proof, not our intention to create one.
  await settleDeepScanCredits({ projectId: session.projectId, sessionId: session.id });

  await updateSessionStatus(supabase, session.id, "completed");
  await terminate(supabase, provider, session.providerSessionId, session.id);
  await recordUsage(supabase, {
    provider: provider.name,
    projectId: session.projectId,
    session,
    status: "completed",
    pagesInspected: analysis.snapshot.crawl.pagesInspected,
  });

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "deep_scan.completed",
    metadata: {
      projectId: session.projectId,
      sessionId: session.id,
      accessMode: session.accessMode,
      pagesInspected: analysis.snapshot.crawl.pagesInspected,
      completeness: analysis.snapshot.completeness.status,
    },
  });

  return { ok: true, snapshotId: run.snapshotId, pagesInspected: analysis.snapshot.crawl.pagesInspected };
}

/**
 * The user closed the window or gave up. Releases the browser and starts the
 * cooldown — without consuming the included scan.
 */
export async function cancelDeepScan(
  supabase: SupabaseClient,
  provider: BrowserSessionProvider,
  params: { sessionId: string; userId: string },
): Promise<{ ok: true } | { ok: false; error: AnalyzeDeepScanFailure }> {
  const session = await getSessionWithProviderId(supabase, params.sessionId);
  if (!session) return { ok: false, error: "session_not_found" };

  const project = await loadOwnedProject(supabase, session.projectId, params.userId);
  if (!project) return { ok: false, error: "project_not_found" };

  await updateSessionStatus(supabase, session.id, "cancelled");
  await terminate(supabase, provider, session.providerSessionId, session.id);
  await recordUsage(supabase, {
    provider: provider.name,
    projectId: session.projectId,
    session,
    status: "cancelled",
  });
  await releaseDeepScanCredits({
    projectId: session.projectId,
    sessionId: session.id,
    reason: "cancelled_before_usage",
  });

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "deep_scan.cancelled",
    metadata: { projectId: session.projectId, sessionId: session.id },
  });

  return { ok: true };
}

/**
 * The safe, derived status for the project page (§6).
 *
 * Returns Vibe's own session id and status at most — no provider session id,
 * no capability URL, no cost.
 */
export async function getDeepScanAccessStatus(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<DeepScanAccessStatus | null> {
  const project = await loadOwnedProject(supabase, params.projectId, params.userId);
  if (!project) return null;

  const facts = await gatherEntitlementFacts(supabase, {
    projectId: params.projectId,
    productionOrigin: project.production_url,
  });

  const active = await getActiveSession(supabase, params.projectId);

  return toDeepScanAccessStatus(facts, active ? { id: active.id, status: active.status } : null);
}
