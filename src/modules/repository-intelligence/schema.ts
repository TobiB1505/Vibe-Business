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
 *
 * ## v6 → v7
 *
 * `declaresWorkspaces` changed meaning. It used to be true for any directory
 * holding a `pnpm-workspace.yaml`, and that over-claims: pnpm 10 keeps
 * `overrides`, `patchedDependencies` and `allowBuilds` in the same file, so a
 * single-package repository pinning one transitive dependency declared a
 * workspace it did not have — this repository among them. It is now the file's
 * `packages:` key, or a `workspaces` field in the manifest.
 *
 * The bump is not optional hygiene. Under v6 nothing read the field; under v7
 * it decides whether an ancestor lockfile may install an application below it,
 * so a v6 answer read as a v7 one would put a sandbox to work in a directory
 * chosen by a wrong fact.
 */
export const ANALYZER_VERSION = "repo-intelligence-v7" as const;

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
  | "monitoring"
  | "testing"
  | "ci"
  | "email"
  | "feature_flags";

/**
 * What each category is called when a person reads it.
 *
 * Published for the same reason `BUSINESS_SURFACE_LABELS` is: the two evidence
 * builders interpolate the category into a founder-facing sentence, and until
 * Sprint 0081 they interpolated the raw member. "payments integration signal"
 * happened to read correctly; "testing integration signal" and "ci integration
 * signal" do not, and `feature_flags` would have reached a founder with its
 * underscore intact.
 */
export const SIGNAL_CATEGORY_LABELS: Record<SignalCategory, string> = {
  deployment: "deployment",
  database: "database",
  auth: "authentication",
  payments: "payments",
  analytics: "analytics",
  monitoring: "monitoring",
  testing: "test tooling",
  ci: "continuous integration",
  email: "e-mail sending",
  feature_flags: "feature flagging",
};

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

/**
 * What each surface is called when a person reads it (UI-7 §2).
 *
 * Published here rather than kept private to the detector because the evidence
 * layer needs the same words: a citation of `repo.surface.payments` used to
 * reach the screen as "Surface payments", which is the id with its dots taken
 * out. The names already existed — they were simply not reachable from the
 * place that needed them.
 */
export const BUSINESS_SURFACE_LABELS: Record<BusinessSurfaceId, string> = {
  authentication: "Authentication",
  payments: "Payments",
  pricing_page: "Pricing page",
  checkout_billing: "Checkout / billing",
  analytics: "Analytics",
  seo_metadata: "SEO metadata",
  sitemap: "Sitemap",
  robots: "robots.txt",
  blog_content: "Blog / content",
  contact: "Contact",
  docs_help: "Docs / help",
  legal: "Legal pages",
  onboarding: "Onboarding",
  dashboard_app: "Dashboard / app area",
};

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
  /**
   * The router directory these routes were read from, repository-relative and
   * trailing-slashed — `src/app/` at the root, `frontend/src/app/` for an
   * application in a subdirectory.
   *
   * Recorded rather than re-derived, because it is the one place that knows.
   * Every consumer that used to reconstruct it from route source paths was
   * reconstructing a repository-root assumption along with it.
   *
   * Optional: a snapshot written before `repo-intelligence-v6` has no value
   * here, and the absence is the honest answer for it — that analysis only ever
   * looked at the repository root.
   */
  root?: string;
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

/**
 * Well-known `package.json` script names, as a closed set.
 *
 * A closed set because an arbitrary script name is unbounded untrusted text
 * from a customer repository, and this field is rendered to a founder and
 * handed to a model. Names only — a script *body* is never parsed, stored or
 * shown (`parsers/package-json.ts`), because a command line is an injection
 * surface and no detection needs it.
 */
export type ProjectScriptId =
  | "test"
  | "test:e2e"
  | "e2e"
  | "typecheck"
  | "lint"
  | "build"
  | "start";

/**
 * Which of those scripts the repository root declares.
 *
 * ## This is orientation, never a command source
 *
 * It exists so a person — or the Opportunity model — can see *before* paying
 * for an agent run that a repository has no `test` script, which is to say
 * that nothing will verify the change the run produces (rule 78).
 *
 * It must never become the input to a command Vibe runs. Validation and agent
 * execution re-read `package.json` from the sandbox filesystem the command is
 * about to execute against (`validation/orchestrator.ts`,
 * `operations/agent-execution/execution.ts`), and that is correct: a plan built
 * from a snapshot is a belief about a filesystem, while a plan built from the
 * filesystem is a fact about it. Rule 52 forbids carrying the raw manifest
 * across a durable step boundary in any case. `scripts.test.ts` asserts that no
 * command-building module reads this field, so the two sources cannot drift
 * into disagreeing about what a repository can do.
 */
export type ProjectScripts = {
  declared: ProjectScriptId[];
  /** The manifest the names were read from, for evidence. Null when none. */
  source: string | null;
};

/**
 * The package managers a lockfile can name.
 *
 * Finer than {@link PackageManagerId} in one place on purpose: Yarn 1 and Yarn
 * 3+ are the same lockfile name and two different installers. Yarn 1's
 * `--frozen-lockfile` does not reliably fail when `package.json` has gained a
 * dependency the lockfile lacks, which is exactly the "silently validate a
 * dependency tree nobody committed" failure a locked install exists to
 * prevent — so the two must be distinguishable before anything decides how to
 * install. Berry is recognised by `.yarnrc.yml` beside the lockfile.
 */
export type LockfilePackageManager = "pnpm" | "npm" | "yarn_berry" | "yarn_classic" | "bun";

export type BuildTargetLockfile = {
  /** Repository-relative path. */
  path: string;
  packageManager: LockfilePackageManager;
  /**
   * Whether it sits in the target's own directory.
   *
   * False means the nearest one belongs to an ancestor — a workspace install,
   * which means something different in every package manager and is not a
   * contract Vibe can honour yet. Recorded rather than dropped, so that
   * decision has data when someone makes it.
   */
  inTargetDirectory: boolean;
};

/**
 * One directory that might hold a buildable application.
 *
 * ## Why this is not `ProjectScripts` again
 *
 * `ProjectScripts` answers *"will anything check this run's result?"* for one
 * manifest — the repository root's — and is banned from every module that
 * builds a command. This answers a different question: *"how many independently
 * installable applications does this repository contain, and where?"* Nothing
 * here sources a command either; `validation/profile.ts` reads it to decide
 * **admission**, and the sandbox still re-reads the real manifest to decide
 * what to run. The two can disagree — and if they do, the run fails honestly at
 * `readPlan` rather than running something nobody predicted.
 *
 * ## Why the frameworks are per-manifest
 *
 * `RepositoryIntelligenceSnapshot.frameworks` is a union across every parsed
 * manifest, which is why a repository with a Next.js app in `frontend/` and a
 * Python service in `backend/` reads as "a Next.js repository". True of the
 * repository, useless for deciding what to start in one directory.
 */
export type BuildTarget = {
  /** Repository-relative directory. `"."` for the repository root. */
  directory: string;
  /** The manifest that made this a target. */
  manifestPath: string;
  /** Whether that manifest declares a `build` script. */
  buildScript: boolean;
  /** Framework ids from **this manifest's own** dependencies. */
  frameworks: string[];
  lockfile: BuildTargetLockfile | null;
  /**
   * A `workspaces` field in this manifest, or a `pnpm-workspace.yaml` beside
   * it that declares `packages:`.
   *
   * The pnpm half is a read rather than an existence check, and that is the
   * v6 → v7 change: the file also carries `overrides` and friends, so having
   * one says nothing about being a workspace. What this field decides — since
   * Stufe 8 — is whether an application with no lockfile of its own may be
   * installed from an ancestor's, which is a sandbox working directory.
   */
  declaresWorkspaces: boolean;
  /**
   * Yarn's module resolution, observed from `.pnp.cjs` rather than read.
   *
   * Under Plug'n'Play there is no `node_modules/.bin/`, so a framework binary
   * cannot be invoked by path — validation still works through `yarn run`,
   * a preview does not. Null when no Yarn lockfile applies.
   *
   * Deliberately derived from a file's *existence*: `.yarnrc.yml` would answer
   * this directly and may also contain `npmAuthToken`, and rule 28 says a
   * credential-bearing file's presence may be observed and its contents may
   * not be read.
   */
  moduleLinker: "node_modules" | "pnp" | null;
};

export type BuildIntelligence = {
  targets: BuildTarget[];
  /** True when more targets existed than the budget allows (rule 27). */
  truncated: boolean;
};

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

/**
 * What role a brand asset plays. A closed set, because "some SVG in
 * /public" is not a logo and must never be presented as one (CORE-1 §11).
 */
export type BrandAssetRole =
  | "logo"
  | "logo_alternate"
  | "favicon"
  | "app_icon"
  | "open_graph_image";

/**
 * A file that *looks like* a brand asset by name and location. Never its
 * bytes — the analyzer does not download images (`isBinaryPath`), so this
 * is a path claim backed by naming convention, nothing more.
 */
export type BrandAssetSignal = {
  role: BrandAssetRole;
  /** Repository-relative path. */
  path: string;
  /** The public URL this would be served at, when it sits in a web root. */
  servedPath: string | null;
  confidence: Confidence;
  evidence: Evidence[];
};

export type BrandColorRole = "primary" | "secondary" | "accent" | "background" | "foreground";

/**
 * A colour lifted from a design-token declaration.
 *
 * `token` is the custom-property name it was declared under, which is what
 * makes the claim checkable: "#00e5a0, declared as --color-mint in
 * src/app/globals.css" is a fact, while "the brand colour is mint" is a
 * guess. `roleConfidence` is deliberately separate from the value: we can be
 * certain the colour exists and unsure what job it does.
 */
export type BrandColorSignal = {
  role: BrandColorRole;
  /** Normalized CSS colour value, e.g. "#00e5a0". Never a gradient. */
  value: string;
  /** The custom property it was declared as, e.g. "--color-mint". */
  token: string;
  /** How sure we are that this colour plays this role. */
  confidence: Confidence;
  evidence: Evidence[];
};

export type BrandTypefaceRole = "display" | "body" | "mono";

export type BrandTypefaceSignal = {
  role: BrandTypefaceRole;
  /** Human family name, e.g. "Space Grotesk". Never a font file. */
  family: string;
  confidence: Confidence;
  evidence: Evidence[];
};

/**
 * Brand signals a repository can supply (CORE-1 §11–§13).
 *
 * Deliberately signals, not a brand: this layer says "these colours are
 * declared as design tokens", never "this is the brand". Deciding what the
 * brand *is* happens in the Product Understanding layer, which can weigh
 * these against what the live site actually serves.
 */
export type BrandIntelligence = {
  assets: BrandAssetSignal[];
  colors: BrandColorSignal[];
  typefaces: BrandTypefaceSignal[];
  /** Files whose declarations were read. Evidence for "we looked". */
  tokenSources: string[];
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
  scripts: ProjectScripts;
  /**
   * Optional because a stored snapshot is a document, not a live object.
   *
   * Every snapshot this analyzer writes carries it. Rows written before
   * `repo-intelligence-v5` do not, and they are still read — so a consumer has
   * to distinguish "no buildable application" from "this analysis never looked",
   * and a required field would have made those the same answer.
   */
  build?: BuildIntelligence;
  runtime: Detection[];
  integrationSignals: IntegrationSignal[];
  routes: RouteIntelligence;
  businessSurfaces: BusinessSurfaceSignal[];
  brand: BrandIntelligence;
  metrics: AnalysisMetrics;
  warnings: Warning[];
};
