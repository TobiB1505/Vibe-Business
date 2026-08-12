import type { AnalysisCompleteness, CompletenessReason } from "./budgets";

/**
 * Versioned Repository Intelligence schema (Sprint 2 §17).
 *
 * This is the contract the UI renders and — later — the structured
 * context an AI layer will consume. Two rules make that safe and cheap:
 *
 *  1. Nothing here contains raw repository source. Only derived facts and
 *     the *paths* that justify them (Sprint 2 §4).
 *  2. Every non-trivial detection carries evidence, so a human (or a
 *     model) can see why the claim was made rather than trusting it.
 *
 * Content of this snapshot originates from a customer repository and is
 * therefore UNTRUSTED DATA. A future AI consumer must treat every string
 * here as data to reason about, never as instructions to follow.
 */

export const REPOSITORY_INTELLIGENCE_SCHEMA_VERSION = "repository_intelligence.v1" as const;

/**
 * Bumped whenever detection rules change materially, so a stored snapshot
 * always says which analyzer produced it and reuse can be invalidated.
 * Deliberately independent of the app/package version (Sprint 2 §30).
 */
export const ANALYZER_VERSION = "repo-intelligence-v2" as const;

/** Deliberately coarse — see Sprint 2 §18, no fake precision. */
export type Confidence = "high" | "medium" | "low";

/**
 * Why a detection was made. `kind` distinguishes the strength of the
 * evidence: a declared dependency is stronger than a filename convention.
 */
export type Evidence = {
  kind: "manifest_dependency" | "config_file" | "file_path" | "directory" | "manifest_field";
  /** Repository-relative path the evidence came from. */
  path: string;
  /** e.g. the dependency name — never a source line or file body. */
  detail?: string;
};

export type Detection = {
  /** Stable machine identifier, e.g. "nextjs". */
  id: string;
  /** Human label, e.g. "Next.js". */
  name: string;
  confidence: Confidence;
  evidence: Evidence[];
};

export type SignalCategory =
  | "deployment"
  | "database"
  | "auth"
  | "payments"
  | "analytics"
  | "monitoring";

/**
 * An integration *signal*, not a claim that the service is live or
 * correctly configured (Sprint 2 §13). The UI phrases these as
 * "detected integration signal", never "payments are configured".
 */
export type IntegrationSignal = Detection & { category: SignalCategory };

export type BusinessSurfaceId =
  | "authentication"
  | "payments"
  | "pricing_page"
  | "checkout_billing"
  | "analytics"
  | "seo_metadata"
  | "sitemap"
  | "robots"
  | "blog_content"
  | "contact"
  | "docs_help"
  | "legal"
  | "onboarding"
  | "dashboard_app";

export type BusinessSurfaceSignal = {
  id: BusinessSurfaceId;
  name: string;
  detected: boolean;
  confidence: Confidence;
  evidence: Evidence[];
};

export type RouteKind = "page" | "api" | "layout";

export type RouteSummary = {
  /** Inferred URL path, e.g. "/pricing" or "/api/webhook". */
  path: string;
  kind: RouteKind;
  dynamic: boolean;
  /** Repository path the route was inferred from — no file content. */
  sourcePath: string;
};

/**
 * `limited` means the framework needs runtime configuration to know its
 * routes, so we deliberately report nothing rather than guess
 * (Sprint 2 §15).
 */
export type RouteDetectionMode = "app_router" | "pages_router" | "limited" | "none";

export type RouteIntelligence = {
  mode: RouteDetectionMode;
  routes: RouteSummary[];
  /** True when the route list was trimmed for display/storage size. */
  truncated: boolean;
};

export type MonorepoIntelligence = {
  detected: boolean;
  tool: string | null;
  /** Directories that look like independently deployable apps. */
  apps: string[];
  packages: string[];
  evidence: Evidence[];
  /** Set when structure is recognisably a monorepo but apps can't be resolved. */
  ambiguous: boolean;
};

export type ProjectStructure = {
  totalTreeEntries: number;
  /** Blobs excluding generated/vendored output — the "real" file count. */
  sourceFileCount: number;
  topLevelDirectories: string[];
  monorepo: MonorepoIntelligence;
};

export type PackageManagerId = "pnpm" | "npm" | "yarn" | "bun" | "unknown";

export type RepositoryFacts = {
  fullName: string;
  defaultBranch: string;
  private: boolean;
};

export type AnalysisSource = {
  commitSha: string;
  branch: string;
  analyzerVersion: string;
  /** True when the whole tree was enumerated; false when GitHub truncated it. */
  treeComplete: boolean;
};

export type AnalysisMetrics = {
  treeEntriesConsidered: number;
  candidatesSelected: number;
  filesFetched: number;
  bytesFetched: number;
  durationMs: number;
};

export type Completeness = {
  status: AnalysisCompleteness;
  reasons: CompletenessReason[];
};

/** A non-fatal observation worth surfacing, e.g. an unparseable manifest. */
export type Warning = {
  code: string;
  message: string;
  path?: string;
};

export type RepositoryIntelligenceSnapshot = {
  schemaVersion: typeof REPOSITORY_INTELLIGENCE_SCHEMA_VERSION;
  source: AnalysisSource;
  repository: RepositoryFacts;
  completeness: Completeness;
  projectStructure: ProjectStructure;
  languages: Detection[];
  frameworks: Detection[];
  packageManager: PackageManagerId;
  runtime: Detection[];
  integrationSignals: IntegrationSignal[];
  routes: RouteIntelligence;
  businessSurfaces: BusinessSurfaceSignal[];
  metrics: AnalysisMetrics;
  warnings: Warning[];
};
