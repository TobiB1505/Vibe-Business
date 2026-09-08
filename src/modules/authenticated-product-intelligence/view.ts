import type { DeepScanAccessMode, DeepScanAccessStatus, DeepScanDenialReason } from "./entitlement";
import type { AuthenticatedSurfaceDetection } from "./surface-detection";
import type {
  AuthenticatedEvidence,
  AuthenticatedPageSummary,
  AuthenticatedProductIntelligenceSnapshot,
  Confidence,
} from "./schema";
import { routeShape } from "./routes";
import type { DeepScanSessionStatus } from "./store";
import type { AuthenticatedWarning } from "./schema";
import type { AuthenticatedWarningCode } from "./errors";
import { creditUnits, type CreditUnits } from "@/modules/credits/units";

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
  /** The included scan is used and the policy in force prices no additional one. */
  | "credits_required"
  /** The included scan is used, an additional one is priced, and this balance covers it. */
  | "additional_available"
  /** The included scan is used, an additional one is priced, and the balance is short. */
  | "insufficient_credits"
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

/**
 * What the panel may offer **next**, independent of what it is showing now.
 *
 * This exists because those two questions were answered by one value and they
 * are not the same question. `state` ranks a completed result above every
 * purchasable state — deliberately, because once a Deep Scan exists that is
 * what the section is about — and the panel then had nothing left to render a
 * control from. A founder with 5,330 Credits, a 25-Credit price in force and
 * one finished scan was shown a summary card and no way to run another one.
 *
 * So the offer is derived once, here, and is valid in every state including
 * `completed`. A component that wants to know whether a scan can be started
 * asks this; it never re-reads `includedScanAvailable`, `additionalScanPrice`
 * and `blockedReason` and reaches its own conclusion (§13).
 */
export type DeepScanNextScan =
  /** The project's included scan is still available, and nothing is blocking. */
  | { kind: "included" }
  /** Priced, the balance covers it, and nothing is blocking. */
  | { kind: "priced"; price: CreditUnits }
  /** Priced, and the balance is short. There is a checkout behind this one. */
  | { kind: "insufficient_credits"; price: CreditUnits }
  /** The included scan is used and the policy in force prices no other. */
  | { kind: "not_for_sale" }
  /** Temporarily refused: a live session, a cooldown, an attempt limit. */
  | { kind: "blocked"; reason: DeepScanDenialReason; retryAvailableAt: string | null }
  /** Nothing to sign in to, or no browser provider on this deployment. */
  | { kind: "unavailable"; reason: DeepScanUnavailableReason };

/** One page Vibe read, as a founder would name it. */
export type DeepScanPage = {
  /** Origin-relative, query already stripped upstream. */
  path: string;
  /** The page's own `h1`, when it had one. */
  heading: string | null;
};

/** A route template and the pages Vibe read against it. */
export type DeepScanScreen = {
  /** `/app/projects/:id/settings` — identifiers collapsed. */
  template: string;
  /** The page that best represents it: the first one read. */
  heading: string | null;
  pages: DeepScanPage[];
};

export type DeepScanShape = {
  /** Where the browser was when the founder handed it over. */
  landingPath: string;
  /** Navigation labels the signed-in product showed. */
  navigation: string[];
  pagesWithForms: number;
  pagesWithTables: number;
  pagesWithEmptyState: number;
};

/** One recognised surface, and the pages that are the reason Vibe says so. */
export type DeepScanSurface = {
  id: string;
  name: string;
  confidence: Confidence;
  /**
   * Already resolved to sentences. The panel renders these through Vibe's
   * `EvidenceDrawer`, which takes `{ detail, source }` and never an id — so
   * the mapping from a stored evidence record to a readable line happens here,
   * where the snapshot's vocabulary is known.
   */
  evidence: { detail: string; source: string }[];
};

export type DeepScanResultSummary = {
  analyzedAt: string;
  pagesInspected: number;
  /**
   * How the scan ended, in a form the panel can render without judging.
   *
   * `completeness: "partial"` was the whole answer, and it rendered as
   * **"Only partly"** in amber over a scan that had done everything it was
   * ever going to do. The single reason was `mutation_blocked` — Vibe refuses
   * every non-GET request because this analysis runs signed in as the
   * customer, and it always will. Presenting a permanent, deliberate policy as
   * a shortfall teaches a founder that Vibe half-works.
   *
   * So the reasons are read here rather than collapsed: something that went
   * wrong is a different answer from a limit Vibe chose, and a limit Vibe
   * chose *on purpose and for good* is different again from a budget that
   * could be raised.
   */
  completion: DeepScanCompletion;
  /** Detected surfaces only, each with the pages that prove it. */
  surfaces: DeepScanSurface[];
  /**
   * The pages Vibe read, collapsed onto their route templates.
   *
   * Twenty-one paths is a list nobody reads; eight screens is the shape of a
   * product. The instances stay, behind the template, because "which three
   * projects did it look at" is a real question — it is just not the first one.
   */
  screens: DeepScanScreen[];
  /**
   * What was actually on those pages.
   *
   * The scan reads navigation, forms, tables and empty states on every page,
   * and none of it reached the screen: a founder spent 25 Credits and ninety
   * seconds and got back a page count. This is the answer to "what did you
   * see", in the product's own words.
   */
  shape: DeepScanShape;
  /**
   * What the scan noticed, grouped by what kind of statement it is.
   *
   * These used to be one flat list under "N things Vibe could not check", and
   * a real scan put six entries there of which **four were not that**. Two
   * were facts Vibe had established by looking (a path redirected somewhere
   * already read), one was the page budget working exactly as designed, and
   * one was a safety refusal. Only one was a failure.
   *
   * A founder reading that heading learns that Vibe failed six times. It
   * failed once. So the kind travels with the note, and the path travels with
   * it too — the two redirect lines were identical sentences with no path
   * shown, which is why they read as the same message printed twice.
   *
   * Safe to display by construction: `AuthenticatedWarning.message` is
   * authored in this repository and is never provider or page text, and
   * `path` is origin-relative with its query string already stripped.
   */
  notes: DeepScanNote[];
  accessMode: DeepScanAccessMode;
};

/**
 * One stored evidence record as a sentence a founder can read.
 *
 * `EvidenceDrawer` takes `{ detail, source }` and never an id — a component
 * that took ids would have to resolve them, and a client component cannot
 * reach a resolver. So the mapping lives here, where the snapshot's own
 * vocabulary is known.
 *
 * The page's path is the *source*, because that is where a person would go to
 * check. A record whose kind Vibe no longer produces is dropped rather than
 * rendered as a bare kind name: an unreadable citation is worse than one
 * fewer (rule 45).
 */
function describeEvidence(item: AuthenticatedEvidence): { detail: string; source: string } | null {
  switch (item.kind) {
    case "url_path":
      return { detail: "Vibe opened this page while signed in.", source: item.path };
    case "heading":
      return item.detail === undefined || item.detail === null
        ? null
        : { detail: `Its heading reads “${item.detail}”.`, source: item.path };
    case "nav_label":
      return item.detail === undefined || item.detail === null
        ? null
        : { detail: `The navigation offers “${item.detail}”.`, source: item.path };
    case "page_title":
      return item.detail ? { detail: `Its title reads “${item.detail}”.`, source: item.path } : null;
    case "action_label":
      return item.detail ? { detail: `It offers “${item.detail}”.`, source: item.path } : null;
    case "form_structure":
      return { detail: "The page carries a form.", source: item.path };
    case "table_structure":
      return { detail: "The page carries a table of records.", source: item.path };
    case "empty_state_label":
      return item.detail ? { detail: `It reads “${item.detail}”.`, source: item.path } : null;
    default:
      return null;
  }
}

/**
 * The pages Vibe read, collapsed onto their route templates.
 *
 * `/app/projects/<a>/settings` and `/app/projects/<b>/settings` are one screen
 * holding different rows, and the crawl already knows it — `routeShape` is what
 * stops the budget being spent four times on the same template. Presenting the
 * result the same way is the difference between a list of twenty-one paths,
 * which nobody reads, and eight screens, which is the shape of a product.
 *
 * Insertion order is kept: the first page read comes first, and it is the one
 * whose heading names the group. Sorting alphabetically would put `/app` — the
 * page the founder actually landed on — somewhere in the middle.
 */
function groupIntoScreens(pages: AuthenticatedPageSummary[]): DeepScanScreen[] {
  const screens = new Map<string, DeepScanScreen>();

  for (const page of pages) {
    const template = routeShape(page.path);
    const entry = screens.get(template);
    const item = { path: page.path, heading: page.mainHeading };

    if (entry) entry.pages.push(item);
    else screens.set(template, { template, heading: page.mainHeading, pages: [item] });
  }

  return [...screens.values()];
}

/**
 * Reasons Vibe will always have, whatever else changes.
 *
 * Refusing every non-GET request and every navigation off the product's origin
 * are not shortfalls to be fixed later — they are what makes it safe to hand
 * Vibe a signed-in session at all (Sprint 5 §15, §18). A scan that hit only
 * these did everything it was ever going to do.
 */
const POLICY_REASONS = ["mutation_blocked", "external_navigation_blocked"] as const;

/**
 * Reasons that are a number someone chose, and could choose differently.
 *
 * Distinct from policy because the honest sentence differs: "Vibe will never
 * do this" and "Vibe stopped after 25 pages" are both deliberate, but only one
 * of them is an argument about safety.
 */
const BUDGET_REASONS = [
  "page_budget_reached",
  "candidate_budget_reached",
  "depth_reached",
  "timeout",
] as const;

export type DeepScanCompletion = {
  /**
   * `complete` — nothing limited it.
   * `within_limits` — it finished; only Vibe's own policy or budgets applied.
   * `incomplete` — something went wrong, and the result is short because of it.
   */
  kind: "complete" | "within_limits" | "incomplete";
  /** Vibe refused something on purpose, and always will. */
  policyLimited: boolean;
  /** Vibe stopped at a number it chose. */
  budgetLimited: boolean;
};

export function describeCompletion(completeness: {
  status: "complete" | "partial";
  reasons: readonly string[];
}): DeepScanCompletion {
  const reasons = completeness.reasons;
  const policyLimited = POLICY_REASONS.some((reason) => reasons.includes(reason));
  const budgetLimited = BUDGET_REASONS.some((reason) => reasons.includes(reason));

  /*
   * Anything that is neither policy nor budget is something that went wrong —
   * `navigation_failed` today, and whatever is added tomorrow. Written as the
   * remainder rather than as its own list so a new reason is treated as a
   * failure until someone decides otherwise, which is the safe direction for a
   * label a founder trusts.
   */
  const failed = reasons.some(
    (reason) =>
      !POLICY_REASONS.includes(reason as (typeof POLICY_REASONS)[number]) &&
      !BUDGET_REASONS.includes(reason as (typeof BUDGET_REASONS)[number]),
  );

  if (failed) return { kind: "incomplete", policyLimited, budgetLimited };
  if (completeness.status === "complete" || reasons.length === 0) {
    return { kind: "complete", policyLimited: false, budgetLimited: false };
  }
  return { kind: "within_limits", policyLimited, budgetLimited };
}

/**
 * What kind of statement a note is.
 *
 * Three kinds, because a founder reading one list needs to know which of these
 * they are looking at before the sentence means anything:
 *
 *  - `failed` — Vibe tried and could not. This is the only kind that is a
 *    problem, and the only kind that should ever be counted as one.
 *  - `by_design` — Vibe stopped on purpose. A budget reached is the system
 *    working; presenting it as a failure teaches a founder to distrust a
 *    number that is correct.
 *  - `observed` — Vibe looked and this is what it found, including what it
 *    deliberately left alone. A redirect onto a page already read is a fact
 *    about the product, not a shortfall.
 */
export type DeepScanNoteKind = "failed" | "by_design" | "observed";

export type DeepScanNote = {
  kind: DeepScanNoteKind;
  /** Origin-relative, query already stripped, when the note is about one page. */
  path: string | null;
  message: string;
};

/**
 * The kind for each warning code.
 *
 * Written as a total map rather than a default, so a new code has to be
 * classified rather than silently arriving as whatever the fallback is. The
 * `satisfies` is what enforces that at compile time.
 */
const NOTE_KINDS = {
  page_unreachable: "failed",
  navigation_timeout: "failed",
  // Vibe's own decisions, which are the system working rather than failing.
  budget_reached: "by_design",
  repeated_screen_skipped: "by_design",
  // Looked at, and this is what was there — or what Vibe declined to touch.
  redirected_to_seen_page: "observed",
  origin_mismatch_skipped: "observed",
  external_navigation_blocked: "observed",
  download_blocked: "observed",
  extra_tab_ignored: "observed",
  non_get_request_blocked: "observed",
  application_requires_mutating_method_for_render: "observed",
} satisfies Record<AuthenticatedWarningCode, DeepScanNoteKind>;

export function describeWarning(warning: AuthenticatedWarning): DeepScanNote {
  return {
    kind: NOTE_KINDS[warning.code],
    path: warning.path ?? null,
    message: warning.message,
  };
}

/**
 * How far a running analysis has got.
 *
 * Declared here rather than in `service.ts` because the panel needs it and
 * `service.ts` is `server-only`. A type import is erased, so it would compile
 * either way — but a client file importing from a server module is a trap the
 * next person has to re-derive, and this module already exists to be the shape
 * both sides agree on.
 */
export type DeepScanProgress = { pagesInspected: number; maxPages: number };

/** Why the last attempt ended, in typed form. The UI maps it to copy. */
export type DeepScanLastFailure = {
  status: Extract<DeepScanSessionStatus, "failed" | "cancelled" | "expired">;
  failureCode: string | null;
};

export type DeepScanViewModel = {
  state: DeepScanUiState;
  includedScanAvailable: boolean;
  /** Always true while credits are unimplemented. The UI explains; it never sells. */
  additionalScansRequireCredits: boolean;
  /**
   * What an additional Deep Scan costs, in credit units, or null when the
   * policy in force sells none.
   *
   * Null and zero are different, and the difference is the whole reason
   * `credits_required` still exists as a state: no price means "not for sale",
   * which the panel explains rather than sells.
   *
   * Branded here rather than in `entitlement.ts`, which deliberately holds no
   * Credit types at all — this is the layer that renders, so this is where the
   * number becomes a Credit amount.
   */
  additionalScanPrice: CreditUnits | null;
  /** Vibe's own session id and status only. */
  activeSession: { id: string; status: DeepScanSessionStatus } | null;
  blockedReason: DeepScanDenialReason | null;
  /** True only when the detector has real evidence *and* a scan can be run. */
  showRecommendation: boolean;
  /** One short sentence, or null. Never evidence internals. */
  recommendationReason: string | null;
  /** Whether the primary start action should be offered at all. */
  canStart: boolean;
  /**
   * What may be started next, in every state — including while a finished
   * result is on screen. See `DeepScanNextScan`.
   */
  nextScan: DeepScanNextScan;
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
  /** When a cooldown lifts, so a blocked state can say when, not just no. */
  retryAvailableAt: string | null;
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

/**
 * The single answer to "can a scan be started, and on what terms".
 *
 * Order matters and mirrors `authorizeDeepScan`: the reasons a person cannot
 * act on come first, then the reasons they can. Reading a denial reason rather
 * than recomputing the entitlement is deliberate — the service already decided,
 * and a second opinion here is how a UI comes to disagree with its own domain.
 */
function nextScanFor(
  accessStatus: DeepScanAccessStatus,
  providerConfigured: boolean,
): DeepScanNextScan {
  const priced = accessStatus.additionalScanPrice;

  if (accessStatus.blockedReason === "production_origin_missing") {
    return { kind: "unavailable", reason: "production_url_missing" };
  }
  if (!providerConfigured) {
    return { kind: "unavailable", reason: "provider_not_configured" };
  }
  if (accessStatus.blockedReason === "credits_required") {
    return { kind: "not_for_sale" };
  }
  if (accessStatus.blockedReason === "insufficient_credits") {
    // A price is what makes this state different from `not_for_sale`: it is the
    // one with a checkout behind it. Without a figure there is nothing to top
    // up towards, so it degrades rather than rendering "top up for null".
    return priced === null
      ? { kind: "not_for_sale" }
      : { kind: "insufficient_credits", price: creditUnits(priced) };
  }
  if (accessStatus.blockedReason !== null) {
    return {
      kind: "blocked",
      reason: accessStatus.blockedReason,
      retryAvailableAt: accessStatus.retryAvailableAt,
    };
  }

  // Nothing is blocking. The included scan is checked first for the same reason
  // the entitlement checks it first: a project that still has its free scan is
  // never told about a price it does not have to pay.
  if (accessStatus.includedScanAvailable) return { kind: "included" };

  return priced === null ? { kind: "not_for_sale" } : { kind: "priced", price: creditUnits(priced) };
}

export function buildDeepScanViewModel(input: BuildViewModelInput): DeepScanViewModel {
  const { accessStatus, latestSnapshot, latestSession, surfaceDetection } = input;

  const lastResult: DeepScanResultSummary | null =
    latestSnapshot?.result != null
      ? {
          analyzedAt: latestSnapshot.completedAt ?? latestSnapshot.createdAt,
          pagesInspected: latestSnapshot.result.crawl.pagesInspected,
          completion: describeCompletion(latestSnapshot.result.completeness),
          surfaces: latestSnapshot.result.productSurfaces
            .filter((surface) => surface.detected)
            .map((surface) => ({
              id: surface.id,
              name: surface.name,
              confidence: surface.confidence,
              evidence: surface.evidence
                .map(describeEvidence)
                .filter((item): item is { detail: string; source: string } => item !== null),
            })),
          screens: groupIntoScreens(latestSnapshot.result.pages),
          shape: {
            landingPath: latestSnapshot.result.session.landingPath,
            navigation: latestSnapshot.result.navigation.labels,
            pagesWithForms: latestSnapshot.result.pages.filter((page) => page.formCount > 0).length,
            pagesWithTables: latestSnapshot.result.pages.filter((page) => page.tableCount > 0).length,
            pagesWithEmptyState: latestSnapshot.result.pages.filter((page) => page.emptyStatePresent)
              .length,
          },
          notes: latestSnapshot.result.warnings.map(describeWarning),
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

  const nextScan = nextScanFor(accessStatus, input.providerConfigured);

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
    // Read off the one offer rather than recomputed, so a state and the
    // control the panel renders can never describe different terms.
    if (nextScan.kind === "not_for_sale") return "credits_required";
    if (nextScan.kind === "insufficient_credits") return "insufficient_credits";
    // The included scan is gone, an additional one is priced, and nothing is
    // blocking. Ranked below the failure and blocked branches below so a
    // cooldown or a live session is still reported as itself.
    if (nextScan.kind === "priced") return "additional_available";
    if (lastFailure) return "last_attempt_failed";
    if (accessStatus.blockedReason !== null) return "blocked";
    return showRecommendation ? "recommended" : "not_recommended";
  })();

  return {
    state,
    includedScanAvailable: accessStatus.includedScanAvailable,
    additionalScansRequireCredits: true,
    additionalScanPrice:
      accessStatus.additionalScanPrice === null
        ? null
        : creditUnits(accessStatus.additionalScanPrice),
    activeSession: active,
    blockedReason: accessStatus.blockedReason,
    showRecommendation,
    recommendationReason: showRecommendation ? recommendationReasonFor(surfaceDetection) : null,
    canStart,
    nextScan,
    lastResult,
    lastFailure,
    providerConfigured: input.providerConfigured,
    unavailableReason,
    retryAvailableAt: accessStatus.retryAvailableAt,
  };
}
