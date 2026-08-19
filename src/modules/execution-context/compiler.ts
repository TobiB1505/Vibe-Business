import type {
  BusinessSurfaceId,
  BusinessSurfaceSignal,
  Detection,
  Evidence,
  RepositoryIntelligenceSnapshot,
  RouteSummary,
} from "@/modules/repository-intelligence/schema";
import type { ExecutionSpec } from "@/modules/execution-contract/spec";
import type { ProductProfile } from "@/modules/product-understanding/schema";
import {
  BRIEF_BUDGET,
  MAX_BRIEF_PATH,
  boundText,
  rankCandidates,
  rankFacts,
  type BriefFreshness,
  type ContextFact,
  type ExecutionBrief,
  type FactConfidence,
  type FactEvidence,
  type FileCandidate,
  type LiveProductContext,
} from "./brief";

/**
 * The Execution Context Compiler: stored intelligence → one task-specific brief.
 *
 * ## What it is for
 *
 * Vibe analyses a repository before it ever runs an agent, and stores the result
 * versioned and pinned to a commit. Until now none of it reached the agent: the
 * prompt carried a framework list, a package manager and a SHA, and everything
 * else the agent had to rediscover with tool calls it paid for. This file is the
 * missing step between *stored* and *sent*.
 *
 * ## What it is not
 *
 * Not a document assembler. "Give the agent more context" becomes "give the
 * agent the whole audit" unless something selects, and a brief that costs more
 * than the exploration it replaces is a loss. So the compiler starts from the
 * step's own words and pulls only what bears on them — a handful of facts and a
 * handful of paths, under a byte ceiling.
 *
 * Not authority either. Nothing here widens a write scope, relaxes a budget or
 * authorises a tool; the compiled policy does that, and it does not read this.
 * A brief is a starting point that can be wrong, and being wrong costs a turn.
 *
 * ## The three rules that shape the code
 *
 * 1. **Evidence is only valid at its revision.** Every repository claim is
 *    withheld unless the snapshot was taken at the exact commit this execution
 *    runs against. A path that moved is worse than no path: it sends the agent
 *    somewhere confidently wrong (`assessFreshness`).
 * 2. **Derive, never hardcode.** No task name and no file path appears in this
 *    file. Candidates come from `routes[].sourcePath` and
 *    `businessSurfaces[].evidence[].path`, which Vibe's own analyzer produced at
 *    the pinned commit. Where a *new* file should go is answered by naming the
 *    directory this repository's route files were observed in, never by a
 *    surface→path table.
 * 3. **It is data, never instruction** (Rule 25, Rule 42). Every value is
 *    derived from a customer's repository, plan or recorded answers. Facts are
 *    typed subject/value pairs with bounded strings, so there is no field a
 *    directive survives intact in, and the renderer fences the lot.
 */

export const EXECUTION_BRIEF_VERSION = "execution-brief.v1" as const;

/* ---------------------------------------------------------------------------
 * Freshness (PART C)
 * ------------------------------------------------------------------------ */

/**
 * Does the intelligence describe the commit this run works against?
 *
 * A string comparison and nothing else. There is deliberately no "close enough"
 * branch — no ancestor check, no "same branch", no timestamp window. Either the
 * snapshot names the pinned commit or it does not, and the second case is
 * treated the same as having no snapshot at all.
 */
export function assessFreshness(
  spec: ExecutionSpec,
  snapshot: RepositoryIntelligenceSnapshot | null,
): BriefFreshness {
  const executionSha = spec.repository.baseSha;
  const snapshotId = spec.repository.repositorySnapshotId || null;

  if (!snapshot) {
    return { state: "unknown", snapshotSha: null, executionSha, snapshotId };
  }

  const snapshotSha = snapshot.source.commitSha;
  return {
    state: snapshotSha === executionSha ? "fresh" : "stale",
    snapshotSha,
    executionSha,
    snapshotId,
  };
}

/* ---------------------------------------------------------------------------
 * Reading the step (PART D)
 * ------------------------------------------------------------------------ */

/**
 * How much of the step's text is read when choosing what is relevant.
 *
 * Bounded because the text is Planner output about a customer's business, and
 * an unbounded tokenizer over untrusted text is an unbounded loop waiting for
 * an unusual input.
 */
const MAX_TASK_TEXT = 4000;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "when", "then",
  "will", "are", "was", "were", "has", "have", "had", "not", "but", "all",
  "any", "can", "its", "our", "their", "them", "they", "you", "your", "should",
  "must", "make", "made", "add", "adds", "added", "use", "used", "using",
  "step", "page", "pages", "site", "user", "users", "new", "one", "each",
  "which", "what", "why", "how", "does", "done", "after", "before", "also",
]);

/**
 * The step's own vocabulary.
 *
 * Everything the plan said about this step — goal, title, purpose, done-when,
 * expected outcome, and any absorbed preparation — reduced to a set of words.
 * Crude on purpose: the selection it drives is a *hint*, and a cleverer matcher
 * would buy precision the downstream consumer does not need while adding a
 * component that behaves differently on text nobody has seen.
 */
export function taskTerms(spec: ExecutionSpec): ReadonlySet<string> {
  const { objective } = spec;

  /*
   * Decisions the customer recorded *for this step* are read too — a decision
   * that names the pricing page makes the pricing surface relevant even when
   * the step's own title does not. Plan-wide decisions are deliberately not
   * read: they describe the whole plan, and matching a step against them would
   * pull in a surface per decision and select everything.
   */
  const stepDecisions = spec.businessContext.approvedDecisions
    .filter((decision) => decision.stepOrder === spec.stepOrder)
    .map((decision) => decision.decision);

  const text = [
    objective.goal,
    objective.stepTitle,
    objective.purpose,
    objective.doneWhen,
    objective.expectedChangedState,
    ...objective.preparation.map((step) => `${step.title} ${step.purpose} ${step.doneWhen}`),
    ...stepDecisions,
  ]
    .join(" ")
    .slice(0, MAX_TASK_TEXT)
    .toLowerCase();

  const terms = new Set<string>();
  for (const token of text.split(/[^a-z0-9]+/)) {
    if (token.length >= 3 && token.length <= 40 && !STOPWORDS.has(token)) terms.add(token);
  }
  return terms;
}

/**
 * Words that indicate a step is about one of Vibe's business surfaces.
 *
 * Authored here against Vibe's own closed `BusinessSurfaceId` vocabulary — not
 * against any repository, any path, or any particular task. Adding a surface to
 * the analyzer is what would add a row here; adding a customer never does.
 *
 * Deliberately specific. Generic words that would match nearly every step
 * ("app", "content", "index", "search") are left out: a selector that matches
 * everything selects nothing, and every wrong selection spends prompt bytes.
 */
const SURFACE_TERMS: Record<BusinessSurfaceId, readonly string[]> = {
  authentication: ["auth", "authentication", "login", "signin", "signup", "session", "logout"],
  payments: ["payment", "payments", "stripe", "charge", "subscription", "paywall"],
  pricing_page: ["pricing", "price", "prices", "tier", "tiers", "plan", "plans"],
  checkout_billing: ["checkout", "billing", "invoice", "upgrade", "subscribe"],
  analytics: ["analytics", "tracking", "telemetry", "conversion", "funnel"],
  seo_metadata: ["seo", "metadata", "meta", "opengraph", "canonical", "title", "description"],
  sitemap: ["sitemap"],
  robots: ["robots", "crawler", "crawlers", "crawling", "noindex", "indexable"],
  blog_content: ["blog", "article", "articles", "posts"],
  contact: ["contact", "enquiry", "inquiry"],
  docs_help: ["docs", "documentation", "guide", "guides", "faq", "help"],
  legal: ["legal", "privacy", "terms", "imprint", "gdpr", "cookie", "cookies"],
  onboarding: ["onboarding", "welcome", "activation"],
  dashboard_app: ["dashboard", "workspace", "console", "admin"],
};

/**
 * Surfaces whose implementation is not confined to one page.
 *
 * A property of Vibe's vocabulary, stated once. It answers a single question —
 * "is a layout worth reading for this step?" — and answering it from the surface
 * rather than from the task is what keeps the compiler general.
 */
const SITE_WIDE_SURFACES: ReadonlySet<BusinessSurfaceId> = new Set<BusinessSurfaceId>([
  "authentication",
  "analytics",
  "seo_metadata",
  "sitemap",
  "robots",
]);

/** At most this many surfaces are considered relevant to one step. */
const MAX_SELECTED_SURFACES = 4;

/**
 * Which business surfaces this step is about.
 *
 * Scored by how many of a surface's words the step used, so a step that says
 * "robots" once and "pricing" three times is read as a pricing step. Ties keep
 * the analyzer's own vocabulary order, which makes the result deterministic —
 * the same spec always compiles to the same brief, and that is what lets a
 * stored run be re-read as the experiment it was.
 */
export function selectSurfaces(terms: ReadonlySet<string>): BusinessSurfaceId[] {
  const scored: { id: BusinessSurfaceId; score: number; order: number }[] = [];

  (Object.keys(SURFACE_TERMS) as BusinessSurfaceId[]).forEach((id, order) => {
    const score = SURFACE_TERMS[id].filter((word) => terms.has(word)).length;
    if (score > 0) scored.push({ id, score, order });
  });

  return scored
    .sort((a, b) => (b.score - a.score !== 0 ? b.score - a.score : a.order - b.order))
    .slice(0, MAX_SELECTED_SURFACES)
    .map((entry) => entry.id);
}

/* ---------------------------------------------------------------------------
 * Paths
 * ------------------------------------------------------------------------ */

/**
 * Is this a path Vibe is willing to hand back as a starting point?
 *
 * Snapshot paths are produced by Vibe's own analyzer, so this should never
 * reject anything — which is the reason to keep it: the check costs nothing and
 * the day an analyzer changes, a brief is not where a traversal-shaped string
 * should first become visible. Over-long paths are dropped rather than
 * truncated, because a truncated path is a wrong path stated confidently.
 */
function usablePath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_BRIEF_PATH) return false;
  if (path.startsWith("/") || path.includes("..") || path.includes("\\")) return false;
  return !/\s/.test(path);
}

/** The deepest directory every path shares, at a segment boundary. */
function commonDirectory(paths: readonly string[]): string | null {
  const segmentLists = paths.map((path) => path.split("/").slice(0, -1));
  if (segmentLists.length === 0) return null;

  const shared: string[] = [];
  for (let index = 0; ; index += 1) {
    const candidate = segmentLists[0][index];
    if (candidate === undefined) break;
    if (!segmentLists.every((segments) => segments[index] === candidate)) break;
    shared.push(candidate);
  }

  return shared.length > 0 ? shared.join("/") : null;
}

/* ---------------------------------------------------------------------------
 * Facts (PART E)
 * ------------------------------------------------------------------------ */

const MAX_EVIDENCE_DETAIL = 60;

function evidenceFrom(evidence: readonly Evidence[], revision: string): FactEvidence[] {
  return evidence
    .filter((item) => usablePath(item.path))
    .slice(0, BRIEF_BUDGET.maxEvidencePerFact)
    .map((item) => ({ path: item.path, revision }));
}

function fact(input: ContextFact): ContextFact {
  return { ...input, value: boundText(input.value) };
}

/** `not_found` maps to nothing: a profile that found no evidence states none. */
function profileConfidence(level: string): FactConfidence | null {
  if (level === "confirmed") return "high";
  if (level === "likely") return "medium";
  if (level === "unclear") return "low";
  return null;
}

function detectionFacts(
  detections: readonly Detection[],
  subject: "framework" | "runtime",
  revision: string,
  limit: number,
): ContextFact[] {
  return detections.slice(0, limit).map((detection) =>
    fact({
      subject,
      value: detection.name,
      source: "repository_scan",
      confidence: detection.confidence,
      evidence: evidenceFrom(detection.evidence, revision),
    }),
  );
}

const ROUTE_MODE_LABELS: Record<string, string> = {
  app_router: "Next.js App Router",
  pages_router: "Next.js Pages Router",
  limited: "routes are resolved at runtime and could not be enumerated",
  none: "no route convention detected",
};

/**
 * Facts that only hold at one commit.
 *
 * Everything in here carries a revision on its evidence, which is what the
 * freshness gate keys on: a caller that produces these for a stale snapshot has
 * produced facts that are individually marked as belonging to a different tree.
 */
function repositoryFacts(
  snapshot: RepositoryIntelligenceSnapshot,
  surfaces: readonly BusinessSurfaceId[],
): ContextFact[] {
  const revision = snapshot.source.commitSha;
  const facts: ContextFact[] = [];

  facts.push(...detectionFacts(snapshot.frameworks, "framework", revision, 3));
  facts.push(...detectionFacts(snapshot.runtime, "runtime", revision, 2));

  const routes = snapshot.routes.routes.filter((route) => usablePath(route.sourcePath));

  /*
   * Where this repository keeps its route files.
   *
   * This is the fact that replaces a surface→path table. Asked "where does a
   * new robots file go?", a table would answer from Next.js documentation; this
   * answers from the directory this repository's own route files were observed
   * in, at this commit — which is right for a `src/app` project, an `app`
   * project and a monorepo alike, and needs no entry per task.
   */
  if (snapshot.routes.mode !== "none") {
    const root = commonDirectory(routes.map((route) => route.sourcePath));
    const label = ROUTE_MODE_LABELS[snapshot.routes.mode] ?? snapshot.routes.mode;
    facts.push(
      fact({
        subject: "router",
        value: root ? `${label}; route files live under ${root}/` : label,
        source: "repository_scan",
        confidence: root ? "high" : "medium",
        evidence: routes.slice(0, BRIEF_BUDGET.maxEvidencePerFact).map((route) => ({
          path: route.sourcePath,
          revision,
        })),
      }),
    );
  }

  const apiRoutes = routes.filter((route) => route.kind === "api");
  const apiRoot = commonDirectory(apiRoutes.map((route) => route.sourcePath));
  if (apiRoot) {
    facts.push(
      fact({
        subject: "api_location",
        value: `API routes live under ${apiRoot}/`,
        source: "repository_scan",
        confidence: "high",
        evidence: apiRoutes.slice(0, BRIEF_BUDGET.maxEvidencePerFact).map((route) => ({
          path: route.sourcePath,
          revision,
        })),
      }),
    );
  }

  const pageRoutes = routes.filter((route) => route.kind === "page" && !route.dynamic);
  if (pageRoutes.length > 0) {
    facts.push(
      fact({
        subject: "public_surface",
        value: `Pages: ${pageRoutes.map((route) => route.path).join(", ")}`,
        source: "repository_scan",
        confidence: snapshot.routes.truncated ? "medium" : "high",
        evidence: pageRoutes.slice(0, BRIEF_BUDGET.maxEvidencePerFact).map((route) => ({
          path: route.sourcePath,
          revision,
        })),
      }),
    );
  }

  /*
   * The selected surfaces — including the ones that are absent.
   *
   * "Vibe found no robots surface in this repository at this commit" is the
   * single most useful sentence for a step that exists to create one, and it is
   * the sentence a document assembler would never produce, because absence is
   * not a section in any document.
   */
  const byId = new Map<BusinessSurfaceId, BusinessSurfaceSignal>(
    snapshot.businessSurfaces.map((surface) => [surface.id, surface]),
  );
  for (const id of surfaces) {
    const surface = byId.get(id);
    if (!surface) continue;
    facts.push(
      fact({
        subject: "business_surface",
        value: surface.detected
          ? `${surface.name}: present`
          : `${surface.name}: not found at this commit`,
        source: "repository_scan",
        confidence: surface.detected ? surface.confidence : "high",
        evidence: surface.detected ? evidenceFrom(surface.evidence, revision) : [],
      }),
    );
  }

  const authentication = byId.get("authentication");
  if (authentication?.detected) {
    facts.push(
      fact({
        subject: "auth_boundary",
        value: `Authentication is implemented in this repository (${authentication.evidence
          .slice(0, 2)
          .map((item) => item.detail ?? item.path)
          .join(", ")
          .slice(0, MAX_EVIDENCE_DETAIL)})`,
        source: "repository_scan",
        confidence: authentication.confidence,
        evidence: evidenceFrom(authentication.evidence, revision),
      }),
    );
  }

  const dashboard = byId.get("dashboard_app");
  if (dashboard?.detected) {
    facts.push(
      fact({
        subject: "authenticated_surface",
        value: `${dashboard.name}: present`,
        source: "repository_scan",
        confidence: dashboard.confidence,
        evidence: evidenceFrom(dashboard.evidence, revision),
      }),
    );
  }

  const groups = snapshot.projectStructure.monorepo.detected
    ? snapshot.projectStructure.monorepo.apps
    : [];
  if (groups.length > 0) {
    facts.push(
      fact({
        subject: "route_group",
        value: `Deployable apps in this monorepo: ${groups.join(", ")}`,
        source: "repository_scan",
        confidence: "medium",
        evidence: snapshot.projectStructure.monorepo.evidence
          .filter((item) => usablePath(item.path))
          .slice(0, BRIEF_BUDGET.maxEvidencePerFact)
          .map((item) => ({ path: item.path, revision })),
      }),
    );
  }

  return facts;
}

/**
 * Facts that hold whatever the repository looks like today.
 *
 * The spec is immutable and already pins its own framework list and package
 * manager, so these survive a stale snapshot — which is why a stale brief is
 * still no worse than the prompt this sprint replaces.
 *
 * The customer's approved decisions and the plan's assumptions are not here.
 * They reach the agent verbatim from the spec itself, unbounded, and a
 * truncated second copy inside a brief would be a second version of a sentence
 * a person actually said.
 */
function specFacts(spec: ExecutionSpec, includeFrameworks: boolean): ContextFact[] {
  const facts: ContextFact[] = [];

  if (includeFrameworks) {
    for (const framework of spec.repository.frameworks.slice(0, 3)) {
      facts.push({
        subject: "framework",
        value: boundText(framework),
        source: "execution_spec",
        confidence: "high",
        evidence: [],
      });
    }
  }

  facts.push({
    subject: "package_manager",
    value: boundText(spec.repository.packageManager),
    source: "execution_spec",
    confidence: "high",
    evidence: [],
  });

  if (spec.validation.supported) {
    facts.push({
      subject: "check_command",
      value: `Vibe will independently run: ${spec.validation.sandboxSteps.join(", ")}`,
      source: "execution_spec",
      confidence: "high",
      evidence: [],
    });
  }

  return facts;
}

function profileFacts(profile: ProductProfile | null): ContextFact[] {
  if (!profile) return [];

  const facts: ContextFact[] = [];
  for (const capability of profile.capabilities.slice(0, 3)) {
    const confidence = profileConfidence(capability.confidence);
    if (!confidence) continue;
    facts.push({
      subject: "product_capability",
      value: boundText(capability.label),
      source: "product_profile",
      confidence,
      evidence: [],
    });
  }
  return facts;
}

/* ---------------------------------------------------------------------------
 * File candidates (PART F)
 * ------------------------------------------------------------------------ */

/** How many layout files are offered when a step touches a site-wide surface. */
const MAX_LAYOUT_CANDIDATES = 3;

function routeMatchesTask(route: RouteSummary, terms: ReadonlySet<string>): boolean {
  const words = `${route.path} ${route.sourcePath}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
  return words.some((word) => terms.has(word));
}

/**
 * Where to look first — derived, never listed.
 *
 * Three sources, in the order a person would use them: the files Vibe's own
 * analyzer cited as evidence for the surfaces this step is about; the route
 * files whose URL or path shares a word with the step; and, when the step
 * touches something site-wide, the shallowest layouts, because that is where a
 * site-wide concern is implemented in every framework that has layouts.
 *
 * None of it is a prediction of what will change. It is where reading should
 * start, and being wrong costs one tool call — the same call the agent makes
 * today, except today it makes fourteen of them.
 */
export function selectFileCandidates(
  snapshot: RepositoryIntelligenceSnapshot,
  surfaces: readonly BusinessSurfaceId[],
  terms: ReadonlySet<string>,
): FileCandidate[] {
  const candidates: FileCandidate[] = [];
  const seen = new Set<string>();

  const add = (candidate: FileCandidate) => {
    if (!usablePath(candidate.path) || seen.has(candidate.path)) return;
    seen.add(candidate.path);
    candidates.push({ ...candidate, note: candidate.note ? boundText(candidate.note) : null });
  };

  const byId = new Map(snapshot.businessSurfaces.map((surface) => [surface.id, surface]));
  for (const id of surfaces) {
    const surface = byId.get(id);
    if (!surface?.detected) continue;
    for (const item of surface.evidence.slice(0, BRIEF_BUDGET.maxEvidencePerFact)) {
      add({
        path: item.path,
        reason: "business_surface_evidence",
        confidence: surface.confidence,
        note: surface.name,
      });
    }
  }

  const routes = snapshot.routes.routes.filter((route) => usablePath(route.sourcePath));

  for (const route of routes) {
    if (route.kind === "layout" || !routeMatchesTask(route, terms)) continue;
    add({
      path: route.sourcePath,
      reason: "route_source",
      confidence: route.dynamic ? "medium" : "high",
      note: route.path,
    });
  }

  const siteWide = surfaces.some((id) => SITE_WIDE_SURFACES.has(id));
  if (siteWide) {
    const layouts = routes
      .filter((route) => route.kind === "layout")
      .map((route) => ({ route, depth: route.sourcePath.split("/").length }))
      .sort((a, b) => a.depth - b.depth)
      .slice(0, MAX_LAYOUT_CANDIDATES);

    for (const { route } of layouts) {
      add({
        path: route.sourcePath,
        reason: "layout",
        // A layout is where a site-wide concern usually lives, not where it
        // certainly lives — the analyzer proved the file exists, not its job.
        confidence: "medium",
        note: `layout for ${route.path}`,
      });
    }
  }

  return candidates;
}

/**
 * Directories the step is believed not to touch.
 *
 * Only ever stated when there is something to contrast it with: with no
 * candidates, every directory is equally unvisited and calling them irrelevant
 * would be a guess dressed as a finding. Believed, never forbidden — the write
 * scope is what bounds the change, and a hint hardened into a rule would be a
 * second, unversioned policy competing with the compiled one.
 */
function irrelevantAreas(
  snapshot: RepositoryIntelligenceSnapshot,
  candidates: readonly FileCandidate[],
): string[] {
  if (candidates.length === 0) return [];

  const touched = new Set(
    candidates.map((candidate) => candidate.path.split("/")[0]).filter(Boolean),
  );

  return snapshot.projectStructure.topLevelDirectories
    .filter((directory) => !touched.has(directory) && usablePath(directory))
    .slice(0, BRIEF_BUDGET.maxIrrelevantAreas);
}

/* ---------------------------------------------------------------------------
 * The compiler
 * ------------------------------------------------------------------------ */

export type CompileExecutionBriefInput = {
  spec: ExecutionSpec;
  /** The snapshot the spec names. Null when it could not be loaded. */
  snapshot: RepositoryIntelligenceSnapshot | null;
  /** Product understanding, when one exists for this project. */
  productProfile: ProductProfile | null;
  /** The origin the live scan looked at, when there is one. */
  liveOrigin: string | null;
};

/**
 * Compiles one spec plus stored intelligence into one bounded brief.
 *
 * Pure and deterministic: same inputs, same brief, forever. That is what makes
 * `EXECUTION_BRIEF_VERSION` mean something and what lets a stored run be
 * re-read later as the experiment it actually was.
 */
export function compileExecutionBrief(input: CompileExecutionBriefInput): ExecutionBrief {
  const { spec, snapshot } = input;

  const freshness = assessFreshness(spec, snapshot);
  const usable = freshness.state === "fresh" && snapshot !== null;

  const terms = taskTerms(spec);
  const surfaces = usable ? selectSurfaces(terms) : [];

  const allFacts = [
    ...(usable && snapshot ? repositoryFacts(snapshot, surfaces) : []),
    ...specFacts(spec, !usable),
    ...profileFacts(input.productProfile),
  ];

  const allCandidates =
    usable && snapshot ? selectFileCandidates(snapshot, surfaces, terms) : [];

  const facts = rankFacts(allFacts).slice(0, BRIEF_BUDGET.maxFacts);
  const fileCandidates = rankCandidates(allCandidates).slice(0, BRIEF_BUDGET.maxCandidates);

  /*
   * There is no evidence anywhere in this product that ties a deployed origin
   * to a Git SHA, so the relation is `unknown` and stated as such. `verified`
   * would be a claim about a deployment record that does not exist.
   */
  const live: LiveProductContext = {
    origin: input.liveOrigin ? boundText(input.liveOrigin) : null,
    relationToRepository: "unknown",
  };

  return {
    briefVersion: EXECUTION_BRIEF_VERSION,
    task: boundText(spec.objective.stepTitle, 300),
    businessIntent: boundText(spec.objective.purpose, 400),
    doneWhen: boundText(spec.objective.doneWhen, 400),
    facts,
    fileCandidates,
    likelyIrrelevantAreas:
      usable && snapshot ? irrelevantAreas(snapshot, fileCandidates) : [],
    live,
    freshness,
    truncated: {
      factsOmitted: allFacts.length - facts.length,
      candidatesOmitted: allCandidates.length - fileCandidates.length,
    },
  };
}
