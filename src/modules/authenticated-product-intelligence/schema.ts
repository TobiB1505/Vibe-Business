import type { AuthenticatedCompleteness, AuthenticatedCompletenessReason } from "./budgets";
import type { AuthenticatedWarningCode } from "./errors";
import type { RouteCandidateSource } from "./routes";

/**
 * Versioned Authenticated Product Intelligence schema (Sprint 5 §23).
 *
 * The third evidence source, kept separate from the repository and public-site
 * snapshots for the same reason those two are separate (Sprint 3 §24): a future
 * audit needs to be able to say "the code declares a billing route, the public
 * site serves no pricing page, and the authenticated app shows no billing
 * surface" — three different facts that a merged model would flatten.
 *
 * Three rules keep this payload safe to store, and they are stricter here than
 * for the public snapshot because these pages are behind someone's login:
 *
 *  1. **No authentication material.** No cookies, tokens, storage state,
 *     headers, or capability URLs. There is no field for any of them.
 *  2. **No raw content.** No DOM, HTML, scripts, styles, body text, or
 *     screenshots — derived structure plus short labels only.
 *  3. **Structure, not records.** "table present", not the rows; "project
 *     workspace detected", not the customer's project names (Sprint 5 §22).
 *
 * Everything here originates from a third-party application and is therefore
 * UNTRUSTED DATA — never instructions (CLAUDE.md rule 25, 36).
 */

export const AUTHENTICATED_PRODUCT_INTELLIGENCE_SCHEMA_VERSION =
  "authenticated-product-intelligence.v1" as const;

/** Bumped whenever detection rules change materially, invalidating reuse. */
export const AUTHENTICATED_PRODUCT_ANALYZER_VERSION = "authenticated-product-analyzer-v1" as const;

export type Confidence = "high" | "medium" | "low";

/**
 * Authenticated product surfaces we can recognise structurally.
 *
 * Detection is evidence-driven: a surface is reported only when something on
 * an inspected page supports it. Absence is reported as absence, never as a
 * guess (Sprint 5 §26 — "do not fabricate surfaces").
 */
export type AuthenticatedSurfaceId =
  | "app_shell"
  | "dashboard"
  | "onboarding"
  | "project_workspace"
  | "settings"
  | "billing"
  | "analytics"
  | "empty_state"
  | "data_table"
  | "integrations";

export type AuthenticatedEvidenceKind =
  | "url_path"
  | "page_title"
  | "heading"
  | "nav_label"
  | "action_label"
  | "form_structure"
  | "table_structure"
  | "empty_state_label"
  | "repository_route";

export type AuthenticatedEvidence = {
  kind: AuthenticatedEvidenceKind;
  /** Origin-relative pathname. Never a full URL, never a query string. */
  path: string;
  /** A short structural label. Never page body text, never a field value. */
  detail?: string;
};

export type AuthenticatedSurfaceSignal = {
  id: AuthenticatedSurfaceId;
  name: string;
  detected: boolean;
  confidence: Confidence;
  evidence: AuthenticatedEvidence[];
};

/**
 * One inspected authenticated page, reduced to derived structure.
 *
 * Note what is absent: no body text, no field values, no row contents. Form
 * *types* and counts only, matching the public analyzer's discipline
 * (Sprint 3 §18) and extended to tables.
 */
export type AuthenticatedPageSummary = {
  path: string;
  /** Why this path was visited — every page traces back to evidence. */
  source: RouteCandidateSource;
  status: number | null;
  title: string | null;
  mainHeading: string | null;
  headingCount: number;
  /** Visible navigation labels, capped and length-bounded. */
  navLabels: string[];
  /** Button/link action labels, capped. Never form values. */
  actionLabels: string[];
  formCount: number;
  /** Input *types* only — never names, values, or defaults. */
  formFieldTypes: string[];
  tableCount: number;
  /** True when a table/list rendered with no rows — a strong onboarding signal. */
  emptyStatePresent: boolean;
  /** Short empty-state labels, e.g. "No projects yet". */
  emptyStateLabels: string[];
  surfaces: AuthenticatedSurfaceId[];
  depth: number;
};

export type AuthenticatedNavigation = {
  /** Distinct nav labels seen across the app, capped. */
  labels: string[];
  /** Same-origin paths reachable from the authenticated navigation. */
  paths: string[];
};

export type ApplicationSignals = {
  /** The app renders a persistent shell (nav + content) rather than pages. */
  appShellPresent: boolean;
  authenticatedAreaReached: boolean;
  /** Distinct authenticated paths that rendered successfully. */
  reachableSurfaceCount: number;
  dataTablePresent: boolean;
  emptyStatePresent: boolean;
  settingsPresent: boolean;
  billingPresent: boolean;
  onboardingPresent: boolean;
};

export type AuthenticatedAnalysisSource = {
  /** The origin analysed — always the project's configured production origin. */
  origin: string;
  analyzerVersion: string;
  /** Which provider ran the browser. Operational metadata, not a capability. */
  browserProvider: string;
  analyzedAt: string;
};

export type AuthenticatedSessionSummary = {
  /**
   * Vibe's own session id. Deliberately *not* the provider's, and never a
   * connect or live-view URL (Sprint 5 §10, §12).
   */
  sessionId: string;
  /** Where the browser was when the user confirmed login. */
  landingPath: string;
  /** Extra tabs seen and ignored, e.g. an OAuth popup (Sprint 5 §13). */
  ignoredTabCount: number;
};

export type AuthenticatedCrawlSummary = {
  pagesInspected: number;
  candidatesConsidered: number;
  maxDepthReached: number;
  /** Candidate counts by the evidence that justified them. */
  candidateSources: Record<RouteCandidateSource, number>;
};

export type AuthenticatedMetrics = {
  pagesInspected: number;
  navigationCount: number;
  durationMs: number;
  /** Wall-clock the remote browser was alive — the provider's cost driver. */
  browserSessionDurationMs: number | null;
};

export type AuthenticatedWarning = {
  code: AuthenticatedWarningCode;
  /** Authored by us, never provider or page text. */
  message: string;
  path?: string;
};

export type AuthenticatedCompletenessReport = {
  status: AuthenticatedCompleteness;
  reasons: AuthenticatedCompletenessReason[];
};

export type AuthenticatedProductIntelligenceSnapshot = {
  schemaVersion: typeof AUTHENTICATED_PRODUCT_INTELLIGENCE_SCHEMA_VERSION;
  source: AuthenticatedAnalysisSource;
  session: AuthenticatedSessionSummary;
  crawl: AuthenticatedCrawlSummary;
  pages: AuthenticatedPageSummary[];
  productSurfaces: AuthenticatedSurfaceSignal[];
  navigation: AuthenticatedNavigation;
  applicationSignals: ApplicationSignals;
  metrics: AuthenticatedMetrics;
  completeness: AuthenticatedCompletenessReport;
  warnings: AuthenticatedWarning[];
};

export const AUTHENTICATED_SURFACE_LABELS: Record<AuthenticatedSurfaceId, string> = {
  app_shell: "Application shell",
  dashboard: "Dashboard",
  onboarding: "Onboarding",
  project_workspace: "Project workspace",
  settings: "Settings",
  billing: "Billing",
  analytics: "Analytics",
  empty_state: "Empty state",
  data_table: "Data table",
  integrations: "Integrations",
};
