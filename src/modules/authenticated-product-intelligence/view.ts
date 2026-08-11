import type { DeepScanAccessMode, DeepScanAccessStatus, DeepScanDenialReason } from "./entitlement";
import type { AuthenticatedSurfaceDetection } from "./surface-detection";
import type { AuthenticatedProductIntelligenceSnapshot } from "./schema";
import type { DeepScanSessionStatus } from "./store";

/**
 * The safe Deep Scan view model (Sprint 5 §5, §13).
 *
 * Everything the project page renders is derived here, on the server, from
 * state the domain owns. Two consequences are the point of the file:
 *
 *  1. **The client decides nothing.** Entitlement, cooldown, credits, expiry
 *     and eligibility are all resolved before anything reaches React, so a
 *     component cannot reconstruct "is the free scan used?" from a snapshot
 *     list and get a different answer than the service would (§13).
 *  2. **There is no field for a capability.** No provider session id, no
 *     connect URL, no signing key, no live-view URL. The Live View URL is
 *     fetched by its own authorized action and never travels in this object
 *     (§6).
 *
 * Pure and synchronous, so every state in §3 is a unit test rather than a
 * screenshot.
 */

export type DeepScanUiState =
  /** No production URL configured — there is nothing to sign in to. */
  | "unavailable"
  /** Vibe has no evidence of authenticated surfaces. Offer quietly, never push. */
  | "not_recommended"
  /** Evidence says most of the product is behind a login. */
  | "recommended"
  /** A temporary browser is open and the user is signing in. */
  | "waiting_for_login"
  | "analyzing"
  | "completed"
  /** The included scan is used and credits do not exist yet. */
  | "credits_required"
  /** Temporarily blocked: cooldown, attempt limit, or a session already live. */
  | "blocked"
  /** The last attempt ended without a snapshot; the included scan survives. */
  | "last_attempt_failed";

/** Why no Deep Scan can be offered, when that is the case. */
export type DeepScanUnavailableReason =
  /** No production URL configured — there is nothing to sign in to. */
  | "production_url_missing"
  /** This deployment has no browser provider configured. */
  | "provider_not_configured";

export type DeepScanSurface = { id: string; name: string };

export type DeepScanResultSummary = {
  analyzedAt: string;
  pagesInspected: number;
  completeness: "complete" | "partial";
  /** Detected surfaces only, as id + label. No evidence internals. */
  surfaces: DeepScanSurface[];
  accessMode: DeepScanAccessMode;
};

/** Why the last attempt ended, in typed form. The UI maps it to copy. */
export type DeepScanLastFailure = {
  status: Extract<DeepScanSessionStatus, "failed" | "cancelled" | "expired">;
  failureCode: string | null;
};

export type DeepScanViewModel = {
  state: DeepScanUiState;
  includedScanAvailable: boolean;
  /** Always true while credits are unimplemented. The UI explains; it never sells. */
  additionalScansRequireCredits: true;
  /** Vibe's own session id and status only. */
  activeSession: { id: string; status: DeepScanSessionStatus } | null;
  blockedReason: DeepScanDenialReason | null;
  /** True only when the detector has real evidence *and* a scan can be run. */
  showRecommendation: boolean;
  /** One short sentence, or null. Never evidence internals. */
  recommendationReason: string | null;
  /** Whether the primary start action should be offered at all. */
  canStart: boolean;
  lastResult: DeepScanResultSummary | null;
  lastFailure: DeepScanLastFailure | null;
  /** False when the server has no browser provider configured. */
  providerConfigured: boolean;
  /**
   * Set whenever the panel cannot offer a scan for a reason the user cannot
   * act on from here. The UI must always render an explanation for it — a
   * heading with no action and no reason is a dead end, which is exactly what
   * this field exists to prevent.
   */
  unavailableReason: DeepScanUnavailableReason | null;
};

/**
 * Reasons phrased for a founder, chosen from the strongest evidence present.
 *
 * Deliberately one sentence and free of internals: the detector's evidence
 * array is an implementation detail, and dumping it would invite the UI to
 * grow its own detection rules (§14).
 */
const RECOMMENDATION_REASONS: Record<string, string> = {
  public_login_redirect: "Vibe found product pages that redirect to a sign-in screen.",
  repository_app_route: "Vibe detected product routes that require sign-in.",
  public_auth_surface: "Vibe found a sign-in surface on your website.",
  public_login_form: "Vibe found a sign-in form on your website.",
};

/** Strongest first — the order mirrors the detector's own confidence ranking. */
const EVIDENCE_PRIORITY = [
  "public_login_redirect",
  "repository_app_route",
  "public_auth_surface",
  "public_login_form",
];

function recommendationReasonFor(detection: AuthenticatedSurfaceDetection): string | null {
  const kinds = new Set(detection.evidence.map((item) => item.kind));
  const strongest = EVIDENCE_PRIORITY.find((kind) => kinds.has(kind as never));
  return strongest ? (RECOMMENDATION_REASONS[strongest] ?? null) : null;
}

export type BuildViewModelInput = {
  accessStatus: DeepScanAccessStatus;
  /** The latest completed snapshot, if any. */
  latestSnapshot: {
    result: AuthenticatedProductIntelligenceSnapshot | null;
    accessMode: DeepScanAccessMode;
    completedAt: string | null;
    createdAt: string;
    pagesInspected: number;
  } | null;
  /** The most recent session, whatever its state. Used only for failure copy. */
  latestSession: { status: DeepScanSessionStatus; failureCode: string | null } | null;
  surfaceDetection: AuthenticatedSurfaceDetection;
  providerConfigured: boolean;
};

export function buildDeepScanViewModel(input: BuildViewModelInput): DeepScanViewModel {
  const { accessStatus, latestSnapshot, latestSession, surfaceDetection } = input;

  const lastResult: DeepScanResultSummary | null =
    latestSnapshot?.result != null
      ? {
          analyzedAt: latestSnapshot.completedAt ?? latestSnapshot.createdAt,
          pagesInspected: latestSnapshot.result.crawl.pagesInspected,
          completeness: latestSnapshot.result.completeness.status,
          surfaces: latestSnapshot.result.productSurfaces
            .filter((surface) => surface.detected)
            .map((surface) => ({ id: surface.id, name: surface.name })),
          accessMode: latestSnapshot.accessMode,
        }
      : null;

  // A terminal session only becomes user-visible when it produced nothing —
  // otherwise the completed result is the story, not how it got there.
  const lastFailure: DeepScanLastFailure | null =
    latestSession && (latestSession.status === "failed" || latestSession.status === "cancelled" || latestSession.status === "expired")
      ? { status: latestSession.status, failureCode: latestSession.failureCode }
      : null;

  const active = accessStatus.activeSession as { id: string; status: DeepScanSessionStatus } | null;

  // `canStart` is the service's answer, never a local one. `blockedReason` is
  // null exactly when the domain would allow a scan right now.
  const canStart = accessStatus.blockedReason === null && input.providerConfigured;

  const showRecommendation = surfaceDetection.likely && accessStatus.includedScanAvailable && canStart;

  const unavailableReason: DeepScanUnavailableReason | null =
    accessStatus.blockedReason === "production_origin_missing"
      ? "production_url_missing"
      : !input.providerConfigured
        ? "provider_not_configured"
        : null;

  const state: DeepScanUiState = (() => {
    if (accessStatus.blockedReason === "production_origin_missing") return "unavailable";
    // A missing provider is reported rather than silently hidden. It ranks
    // below an in-flight session so a running scan is never masked by it.
    if (!input.providerConfigured && !active && !lastResult) return "unavailable";
    if (active?.status === "created" || active?.status === "waiting_for_login") return "waiting_for_login";
    if (active?.status === "analyzing") return "analyzing";
    // A successful result outranks everything below it: once a Deep Scan
    // exists, that is what the section is about.
    if (lastResult) return "completed";
    if (accessStatus.blockedReason === "credits_required") return "credits_required";
    if (lastFailure) return "last_attempt_failed";
    if (accessStatus.blockedReason !== null) return "blocked";
    return showRecommendation ? "recommended" : "not_recommended";
  })();

  return {
    state,
    includedScanAvailable: accessStatus.includedScanAvailable,
    additionalScansRequireCredits: true,
    activeSession: active,
    blockedReason: accessStatus.blockedReason,
    showRecommendation,
    recommendationReason: showRecommendation ? recommendationReasonFor(surfaceDetection) : null,
    canStart,
    lastResult,
    lastFailure,
    providerConfigured: input.providerConfigured,
    unavailableReason,
  };
}
