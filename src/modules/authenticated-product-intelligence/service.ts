import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { ReleaseReason } from "@/modules/credits/balance";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { analyzeAuthenticatedProduct } from "./analyzer";
import { isBrowserProviderConfigured } from "./sandbox-browser/client";
import { detectAuthenticatedSurfaces } from "./surface-detection";
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
import { detectSignedIn, type SignInReason } from "./login-detection";
import { buildDeepScanViewModel, type DeepScanProgress, type DeepScanViewModel } from "./view";
import type { BrowserSessionProvider, BrowserSessionUsage } from "./provider";
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
  getLatestSession,
  getLatestSuccessfulAuthenticatedSnapshot,
  getSessionWithProviderId,
  isExpired,
  isLive,
  markSessionTerminated,
  recordDeepScanUsage,
  updateSessionStatus,
  type StoredDeepScanSession,
  recordSnapshotProgress,
  getRunningSnapshotProgress,
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
): Promise<BrowserSessionUsage | null> {
  let usage: BrowserSessionUsage | null = null;
  try {
    const stopped = await provider.terminateSession(providerSessionId);
    // Only a successful stop carries a measurement. A refused one measured
    // nothing, and `null` says so rather than a zero that would be summed.
    if (stopped.ok) usage = stopped.value;
  } catch {
    // A provider that cannot be told to stop will still hit its own timeout.
  }
  await markSessionTerminated(supabase, sessionId);
  return usage;
}

/**
 * Writes the browser-provider usage record for a finished run.
 *
 * `usage` is what termination reported, and it is threaded through rather than
 * fetched here because termination is the only moment it exists: a running
 * sandbox has no final wall clock. Every call site stops the browser
 * immediately before this, which is why the argument is always available and
 * never has to be looked up again.
 */
/**
 * Writes one browser-provider cost row, with a client that may write it.
 *
 * The caller's client is the customer's, cookie-scoped, and
 * `deep_scan_provider_usage` grants it nothing — deliberately, because that
 * table is Vibe's cost ledger and not the customer's data. So every write
 * failed with `permission denied for table deep_scan_provider_usage`, and the
 * store logs rather than throws on purpose, so it failed **quietly**: a scan
 * completed, the customer was charged, and the seconds Vibe paid for were never
 * recorded. A margin nobody can compute is exactly what ADR 0076 set out to fix.
 *
 * Service role, then, and rule 53's condition is met by construction rather
 * than by care: nothing here is taken from a caller's arguments. The project
 * and session come from the row `createSessionRecord` persisted after
 * `loadOwnedProject` verified ownership, and the figures come from the
 * provider. Reviewed in `service-boundary.test.ts`.
 */
async function recordUsage(
  _supabase: SupabaseClient,
  params: {
    provider: string;
    projectId: string;
    session: Pick<StoredDeepScanSession, "id" | "accessMode" | "createdAt">;
    status: DeepScanUsageStatus;
    pagesInspected?: number | null;
    usage?: BrowserSessionUsage | null;
  },
): Promise<void> {
  await recordDeepScanUsage(
    createServiceClient(),
    buildDeepScanUsage({
      provider: params.provider,
      projectId: params.projectId,
      sessionId: params.session.id,
      accessMode: params.session.accessMode,
      startedAt: new Date(params.session.createdAt),
      endedAt: new Date(),
      status: params.status,
      pagesInspected: params.pagesInspected ?? null,
      usage: params.usage ?? null,
    }),
  );
}

/**
 * Step 1: authorize, open a temporary browser, and hand the user a Live View
 * to sign in through.
 */
/**
 * Says a landing failed, without importing the browser stack to do it.
 *
 * `alertOperator` logs locally and reports to Sentry, scrubbed, and never
 * throws — the same route `sandbox-browser/diagnostics.ts` takes one layer
 * down. The reason is a short operator string; the customer is told
 * `page_unreachable`, which is a sentence they can act on.
 */
async function reportLandingFailure(reason: string): Promise<void> {
  const { alertOperator } = await import("@/lib/observability/alert");
  await alertOperator("deep scan: the browser did not land on the product", { reason }).catch(
    () => undefined,
  );
}

export async function startDeepScan(
  supabase: SupabaseClient,
  provider: BrowserSessionProvider,
  params: {
    projectId: string;
    userId: string;
    /**
     * The shape of screen the founder is signing in from.
     *
     * A name, never a size, and re-validated here rather than trusted: this
     * decides a window Chromium is launched with, and a caller is a client.
     * An unrecognised value falls back to desktop, which is the shape the
     * analysis uses anyway.
     */
    viewport?: string;
  },
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
  // reservation. Discovering an empty wallet after paying for a browser would be
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

  const created = await provider.createSession({
    timeoutSeconds: SESSION_TIMEOUT_SECONDS,
    viewport: params.viewport === "mobile" ? "mobile" : "desktop",
  });
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
    // the provider, which is what `abandoned_with_usage` records.
    await releaseHold("abandoned_with_usage");
    return record.error === "scan_already_running"
      ? { ok: false, error: "scan_already_running" }
      : { ok: false, error: "persist_failed" };
  }

  const session = record.session;

  /*
   * Land the browser on the user's own site before they ever see it.
   *
   * This used to be best effort, swallowed twice — the connector discarded the
   * reason and this line discarded the result — on the argument that "they
   * still get a working browser and can navigate by hand". **That argument
   * died with the DevTools frontend.** What the person sees now is a JPEG on a
   * canvas speaking four message shapes: mouse, key, wheel, frame. There is no
   * address bar, and by ADR 0076 there is deliberately never going to be one.
   *
   * So a browser that lands nowhere is not a degraded session a person can
   * rescue. It is `about:blank` forever — which is exactly what the first
   * session in Vibe's own browser showed: a white field, and nothing anywhere
   * to say whether the site had not been reached or had been reached and
   * painted nothing.
   *
   * It fails now, and it says why. Every failure path releases the hold, so
   * refusing costs the customer nothing and saves them a browser they cannot
   * use.
   *
   * Loaded here, not at module scope, for the same reason as in
   * `analyzeDeepScan`: this pulls in the browser stack, and rendering the
   * project page must never do that.
   */
  let landing: { navigated: boolean; reason?: string };
  try {
    const { openSessionAtOrigin } = await import("./playwright/connector");
    landing = await openSessionAtOrigin(handle.connectUrl, origin);
  } catch (error) {
    landing = {
      navigated: false,
      reason: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "unknown",
    };
  }

  if (!landing.navigated) {
    await reportLandingFailure(landing.reason ?? "no reason recorded");
    await updateSessionStatus(supabase, session.id, "failed", "page_unreachable");
    const usage = await terminate(supabase, provider, handle.providerSessionId, session.id);
    await recordUsage(supabase, {
      usage,
      provider: provider.name,
      projectId: params.projectId,
      session,
      status: "failed",
    });
    // The browser existed and billed for the seconds it ran, and the customer
    // got nothing from it. `abandoned_with_usage` is the honest pair: Vibe paid
    // the provider, the customer pays nothing.
    await releaseHold("abandoned_with_usage");
    return { ok: false, error: "page_unreachable" };
  }

  const liveView = await provider.getLiveView(handle.providerSessionId);
  if (!liveView.ok) {
    await updateSessionStatus(supabase, session.id, "failed", "browser_session_create_failed");
    const usage = await terminate(supabase, provider, handle.providerSessionId, session.id);
    await recordUsage(supabase, {
      usage,
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
 * How far the running analysis has got, for the caller's own session.
 *
 * Polled while the scan runs, and the only honest thing this flow has to say
 * about progress: the analysis lives inside one request and reports nothing
 * until it returns, so without this the choice was silence or a bar timed
 * against a guess.
 *
 * A read, and nothing else. It writes nothing, charges nothing, and cannot
 * start or stop anything — `maxPages` comes from Vibe's own budget rather than
 * from the row, because it is a fact about the scan's design and not about
 * this run.
 */
export async function getDeepScanProgress(
  supabase: SupabaseClient,
  params: { sessionId: string; userId: string },
): Promise<DeepScanProgress | null> {
  const session = await getSessionWithProviderId(supabase, params.sessionId);
  if (!session) return null;

  const project = await loadOwnedProject(supabase, session.projectId, params.userId);
  if (!project) return null;

  const progress = await getRunningSnapshotProgress(supabase, session.id);
  if (!progress) return null;

  return { pagesInspected: progress.pagesInspected, maxPages: DEFAULT_AUTHENTICATED_BUDGETS.maxPages };
}

/**
 * Whether the founder has finished signing in, asked of the live browser.
 *
 * The flow used to ask *them* — a button reading "I'm logged in — Analyze" —
 * and the founder's instruction was that Vibe should notice by itself. So this
 * exists to be polled while the dialog is open, and it is built to be cheap
 * and to be harmless when it is wrong:
 *
 *  - It **never writes**. No session status, no snapshot, no usage row, no
 *    credit hold. A probe that failed and a probe that said "not yet" leave
 *    the same trace, which is none.
 *  - It **never terminates** the browser. An expired session is reported and
 *    left to the paths that own that decision.
 *  - It **cannot start anything**. It answers a question; the client decides
 *    what to do with the answer, and `analyzeDeepScan` re-checks every
 *    precondition for itself.
 *
 * The capability URL is fetched per call and never stored (§10), same as
 * everywhere else in this file.
 */
export type ProbeDeepScanSignInResult =
  | { ok: true; signedIn: boolean; reason: SignInReason }
  | { ok: false; error: AnalyzeDeepScanFailure };

export async function probeDeepScanSignIn(
  supabase: SupabaseClient,
  provider: BrowserSessionProvider,
  params: { sessionId: string; userId: string },
): Promise<ProbeDeepScanSignInResult> {
  const session = await getSessionWithProviderId(supabase, params.sessionId);
  if (!session) return { ok: false, error: "session_not_found" };

  const project = await loadOwnedProject(supabase, session.projectId, params.userId);
  if (!project) return { ok: false, error: "project_not_found" };

  if (!isLive(session)) return { ok: false, error: "session_not_live" };

  const connection = await provider.getConnection(session.providerSessionId);
  if (!connection.ok) return { ok: false, error: connection.error };

  let probe;
  try {
    // Dynamic for the same reason `analyzeDeepScan` is: a top-level import of
    // `playwright-core` made *rendering the project page* pull in the browser
    // stack and 500 in production.
    const { probeSignInState } = await import("./playwright/connector");
    probe = await probeSignInState(connection.value.connectUrl, session.origin);
  } catch {
    return { ok: false, error: "browser_connection_failed" };
  }

  // No page on the origin yet: the founder is on an identity provider, or the
  // browser has not landed. Not an error, and not signed in.
  if (probe === null) return { ok: true, signedIn: false, reason: "off_origin" };

  const verdict = detectSignedIn(probe);
  return { ok: true, signedIn: verdict.signedIn, reason: verdict.reason };
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
    const usage = await terminate(supabase, provider, session.providerSessionId, session.id);
    await recordUsage(supabase, {
      usage,
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
    const usage = await terminate(supabase, provider, session.providerSessionId, session.id);
    await recordUsage(supabase, {
      usage,
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
  /*
   * Why pages failed, gathered and reported once.
   *
   * One alert per page would be twenty alerts for one condition, so the
   * failures are collected and sent as a single event with a bounded sample.
   * Nothing here reaches the snapshot: the customer is told "a page could not
   * be loaded", which is true and actionable, and the operator gets the reason.
   */
  const pageFailures: string[] = [];

  try {
    analysis = await analyzeAuthenticatedProduct({
      origin: session.origin,
      sessionId: session.id,
      browserProvider: provider.name,
      browser: readOnly.port,
      repository: repository?.result ?? null,
      publicProduct: publicProduct?.result ?? null,
      /*
       * Written as the crawl goes, so the panel can say how far it has got.
       *
       * Fire-and-forget with a swallowed error: a progress write is a nicety
       * and the scan is not, so it must never be able to fail one. Twenty-five
       * of them across ninety seconds is not a load worth batching.
       */
      onProgress: ({ pagesInspected }) => {
        void recordSnapshotProgress(supabase, run.snapshotId, pagesInspected).catch(
          () => undefined,
        );
      },
      onDiagnostic: (event) => {
        pageFailures.push(`${event.step} ${event.path}: ${event.detail}`);
      },
      budgets: DEFAULT_AUTHENTICATED_BUDGETS,
      browserSessionDurationMs: Date.now() - Date.parse(session.createdAt),
    });
  } catch {
    return fail("analysis_failed", run.snapshotId);
  } finally {
    // Close our CDP socket regardless. Terminating the provider session is a
    // separate decision, made below.
    await readOnly.disconnect().catch(() => undefined);

    if (pageFailures.length > 0) {
      const { alertOperator } = await import("@/lib/observability/alert");
      await alertOperator(
        "deep scan: pages could not be read",
        {
          failures: pageFailures.length,
          // A sample, not the list: twenty failures of one cause are one
          // cause, and the first few carry it.
          sample: pageFailures.slice(0, 5).join(" | ").slice(0, 1200),
        },
        "warning",
      ).catch(() => undefined);
    }
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
    const usage = await terminate(supabase, provider, session.providerSessionId, session.id);
    await recordUsage(supabase, {
      usage,
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
  const usage = await terminate(supabase, provider, session.providerSessionId, session.id);
  await recordUsage(supabase, {
    usage,
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
  const usage = await terminate(supabase, provider, session.providerSessionId, session.id);
  await recordUsage(supabase, {
    usage,
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
 *
 * ## `owned`
 *
 * Both callers reach here from `requireProjectAccess`, which has already read
 * the project and already compared its owner to the session — so the read
 * below was the fourth read of one row on Business Health, the most visited
 * route in the product (PERF-004).
 *
 * Passing it is the fix rather than memoizing the read, for the reason
 * `business-audit/service.ts` gives: a value a caller can hand over is one
 * whose absence a test can count. `getAuditAccessStatus` took the same
 * parameter in the same sprint.
 *
 * What it does not do is weaken the gate. `owned` is not a claim assembled
 * from a caller's arguments — it is a row read under the caller's own
 * RLS-scoped client, whose owner was compared there. Omitting it reads and
 * checks here exactly as before, which is what the tests hold in place.
 */
export async function getDeepScanAccessStatus(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    owned?: { productionUrl: string | null };
  },
): Promise<DeepScanAccessStatus | null> {
  const productionOrigin = params.owned
    ? params.owned.productionUrl
    : (await loadOwnedProject(supabase, params.projectId, params.userId))?.production_url;

  // Undefined is "no such project for this user". Null is a project with no
  // production URL, which is a state this function has a real answer for.
  if (productionOrigin === undefined) return null;

  // Neither needs the other's answer. They were sequential only because they
  // were written on consecutive lines.
  const [facts, active] = await Promise.all([
    gatherEntitlementFacts(supabase, { projectId: params.projectId, productionOrigin }),
    getActiveSession(supabase, params.projectId),
  ]);

  return toDeepScanAccessStatus(facts, active ? { id: active.id, status: active.status } : null);
}

/**
 * Everything the Deep Scan UI needs, assembled once.
 *
 * ## Why it is here rather than in each route
 *
 * Two routes render Deep Scan state now — its own page, and the spotlight at
 * the top of My Product — and both need the same six reads folded the same
 * way: entitlement, the live session, the last snapshot, the repository and
 * public-site evidence the recommendation rests on, and whether this
 * deployment has a browser at all.
 *
 * Assembled twice, the two copies would answer the same question differently
 * the first time either grew a condition, and the question is *what a paid
 * control may offer*. So it is assembled once and narrowed by whoever renders
 * it.
 *
 * Returns null only when the project does not exist for this user.
 */
export async function loadDeepScanViewModel(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; owned?: { productionUrl: string | null } },
): Promise<DeepScanViewModel | null> {
  const [accessStatus, repository, publicProduct, snapshot, session] = await Promise.all([
    getDeepScanAccessStatus(supabase, params),
    getLatestSuccessfulSnapshot(supabase, params.projectId),
    getLatestSuccessfulLiveSnapshot(supabase, params.projectId),
    getLatestSuccessfulAuthenticatedSnapshot(supabase, params.projectId),
    getLatestSession(supabase, params.projectId),
  ]);

  if (!accessStatus) return null;

  return buildDeepScanViewModel({
    accessStatus,
    latestSnapshot: snapshot
      ? {
          result: snapshot.result,
          accessMode: snapshot.accessMode,
          completedAt: snapshot.completedAt,
          createdAt: snapshot.createdAt,
          pagesInspected: snapshot.pagesInspected,
        }
      : null,
    latestSession: session ? { status: session.status, failureCode: session.failureCode } : null,
    surfaceDetection: detectAuthenticatedSurfaces({
      repository: repository?.result ?? null,
      publicProduct: publicProduct?.result ?? null,
    }),
    providerConfigured: isBrowserProviderConfigured(),
  });
}
