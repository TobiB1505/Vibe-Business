import type { StepChangeKind } from "@/modules/action-plans/schema";
import type {
  BusinessSurfaceId,
  Confidence,
  RepositoryIntelligenceSnapshot,
  RouteSummary,
} from "@/modules/repository-intelligence/schema";
import type {
  LiveProductIntelligenceSnapshot,
  ProductSurfaceId,
  SeoSignalId,
} from "@/modules/live-product-intelligence/schema";

/**
 * Which part of the product a step's work actually lands on
 * (EXECUTION SURFACE GENERALIZATION, PART B/PART C).
 *
 * ## The defect this exists for
 *
 * Run #6 ("add robots meta directives") and run #7 ("add canonical URLs to
 * public pages") compiled to **byte-identical** Execution Briefs: 2871 bytes,
 * 16 facts, 6 candidates. Not a coincidence — the selector read the step's
 * prose, and both steps belong to one plan whose goal names every signal the
 * plan touches:
 *
 * > "Implement the missing technical SEO signals — canonical URLs, Open Graph
 * > tags, structured data, and robots meta — across the public pages…"
 *
 * So both term sets contained `canonical`, `meta`, `metadata`, `seo` *and*
 * `robots`, and both selected the same three surfaces. The more coherent a plan
 * is, the less its own words distinguish its steps. It also matched
 * `pricing_page`, because both steps say "matching the plan" and the keyword
 * table lists `plan` — a pricing surface in the brief for a task with nothing to
 * do with pricing.
 *
 * The thing that actually mattered was never expressible in prose anyway. The
 * canonical step's execution surface is *the set of public pages* — a
 * structural fact about the product, not a vocabulary match — and the agent
 * spent nine reads of its own finding the seven page files it had to change.
 *
 * ## What replaces prose
 *
 * The step's `evidenceIds`. They are minted by Vibe's own deterministic
 * detectors from a closed vocabulary, validated at planning time to exist in the
 * evidence pack, and already trusted for exactly this kind of routing by
 * `risk.ts` and by the verification classifier. A model chooses which of Vibe's
 * ids to cite; it cannot invent one, and no repository text, README, page copy
 * or user prose can reach this file (PART Q).
 *
 * ## Why this is not a task recipe
 *
 * Nothing here knows what "canonical" is. It knows that `live.seo.canonical` is
 * one of the signals the live analyzer reads out of a *page document* — the same
 * as `title`, `open_graph`, `robots_meta` and the rest — while
 * `live.seo.robots_txt` and `live.seo.sitemap` are fetched from fixed origin
 * paths. That distinction is a property of how Vibe detects the signal, stated
 * once, and it is what makes "this applies to every public page" fall out for
 * canonical URLs, CTA copy, analytics attribution and page titles alike.
 */

export const EXECUTION_SURFACE_REQUIREMENT_VERSION = "execution-surface.v1" as const;

/* ---------------------------------------------------------------------------
 * The vocabulary
 * ------------------------------------------------------------------------ */

/**
 * The kinds of execution surface a requirement can name.
 *
 * Three, and deliberately not a taxonomy of page types. `marketing_page` versus
 * `legal_public_page` is a distinction Vibe cannot derive from anything it
 * stores, and a scope that cannot be resolved from evidence is a scope that gets
 * guessed at.
 */
export const EXECUTION_SURFACE_SCOPES = [
  /** Every page an anonymous visitor can reach. */
  "public_pages",
  /** The signed-in application area. */
  "authenticated_pages",
  /** One or more named business surfaces, and nothing wider. */
  "named_surface",
] as const;
export type ExecutionSurfaceScope = (typeof EXECUTION_SURFACE_SCOPES)[number];

export type ExecutionSurfaceRequirement = {
  requirementVersion: typeof EXECUTION_SURFACE_REQUIREMENT_VERSION;
  /** Scopes implied by the cited evidence, in vocabulary order. */
  scopes: readonly ExecutionSurfaceScope[];
  /** Business surfaces the cited evidence names, in vocabulary order. */
  surfaces: readonly BusinessSurfaceId[];
  /** The evidence ids that produced this. Never prose, never model text. */
  derivedFrom: readonly string[];
  /**
   * Cited ids no rule recognised.
   *
   * Recorded rather than ignored, because "the planner cited something this
   * compiler has no rule for" is a fact worth seeing in a stored run — it is how
   * a new evidence family shows up as a gap instead of as silence.
   */
  unrecognised: readonly string[];
};

export const EMPTY_SURFACE_REQUIREMENT: ExecutionSurfaceRequirement = {
  requirementVersion: EXECUTION_SURFACE_REQUIREMENT_VERSION,
  scopes: [],
  surfaces: [],
  derivedFrom: [],
  unrecognised: [],
};

/* ---------------------------------------------------------------------------
 * Deriving a requirement from cited evidence (PART B)
 * ------------------------------------------------------------------------ */

/**
 * Where each live SEO signal is observed.
 *
 * `document` means the analyzer read it out of a page's own HTML, so every page
 * carries its own — which is precisely what makes such a step apply to the whole
 * public page set. `origin_artifact` means it was fetched from one fixed path at
 * the origin, so the work is one file.
 *
 * A property of Vibe's detector (`live-product-intelligence/signals.ts`), not of
 * any task. Adding a signal to the analyzer is what adds a row here.
 */
const SEO_SIGNAL_LOCATION: Record<SeoSignalId, "document" | "origin_artifact"> = {
  title: "document",
  meta_description: "document",
  canonical: "document",
  language: "document",
  viewport: "document",
  open_graph: "document",
  structured_data: "document",
  robots_meta: "document",
  robots_txt: "origin_artifact",
  sitemap: "origin_artifact",
};

/** The business surface each SEO signal belongs to. */
const SEO_SIGNAL_SURFACE: Record<SeoSignalId, BusinessSurfaceId> = {
  title: "seo_metadata",
  meta_description: "seo_metadata",
  canonical: "seo_metadata",
  language: "seo_metadata",
  viewport: "seo_metadata",
  open_graph: "seo_metadata",
  structured_data: "seo_metadata",
  robots_meta: "seo_metadata",
  robots_txt: "robots",
  sitemap: "sitemap",
};

/**
 * The repository surface each live product surface corresponds to.
 *
 * Two closed vocabularies, joined once. `homepage` is deliberately absent: it is
 * a page, not a business surface, and inventing one for it would put a surface
 * in the brief that the repository analyzer never emits.
 */
const LIVE_SURFACE_TO_BUSINESS: Partial<Record<ProductSurfaceId, BusinessSurfaceId>> = {
  pricing: "pricing_page",
  login: "authentication",
  signup: "authentication",
  dashboard_app: "dashboard_app",
  checkout_billing: "checkout_billing",
  onboarding: "onboarding",
  contact: "contact",
  docs_help: "docs_help",
  blog_content: "blog_content",
  privacy: "legal",
  terms: "legal",
};

const BUSINESS_SURFACE_IDS: readonly BusinessSurfaceId[] = [
  "authentication",
  "payments",
  "pricing_page",
  "checkout_billing",
  "analytics",
  "seo_metadata",
  "sitemap",
  "robots",
  "blog_content",
  "contact",
  "docs_help",
  "legal",
  "onboarding",
  "dashboard_app",
];

const BUSINESS_SURFACE_SET = new Set<string>(BUSINESS_SURFACE_IDS);

/**
 * Change kinds that produce a repository change.
 *
 * The same set the verification classifier uses. A step that only decides,
 * analyses, measures or researches has no execution surface, and manufacturing
 * one would put page files in front of an agent that is not writing code.
 */
const MUTATING_CHANGE_KINDS: readonly StepChangeKind[] = ["product_change", "external_setup"];

type Implication = {
  scopes: readonly ExecutionSurfaceScope[];
  surfaces: readonly BusinessSurfaceId[];
};

const NOTHING: Implication = { scopes: [], surfaces: [] };

/**
 * What one Vibe-minted evidence id implies about the execution surface.
 *
 * A lookup over id *namespaces*, never a substring search over prose. Anything
 * unrecognised implies nothing at all — silence is the safe answer, and it is
 * recorded on the requirement so an unhandled family is visible rather than
 * quietly absent.
 */
export function implicationOf(evidenceId: string): Implication {
  if (evidenceId.startsWith("live.seo.")) {
    const signal = stripMissing(evidenceId.slice("live.seo.".length));
    const location = SEO_SIGNAL_LOCATION[signal as SeoSignalId];
    if (!location) return NOTHING;

    const surface = SEO_SIGNAL_SURFACE[signal as SeoSignalId];
    return location === "document"
      ? { scopes: ["public_pages", "named_surface"], surfaces: [surface] }
      : { scopes: ["named_surface"], surfaces: [surface] };
  }

  /*
   * Conversion, site metadata, forms and crawl coverage are all read by the
   * anonymous crawler off the pages it reached, so a step citing one is a step
   * about the public page set. This is where "update the primary CTA on public
   * pages" and "add analytics attribution to public entry pages" resolve through
   * exactly the same mechanism as canonical URLs, with no SEO knowledge at all.
   */
  if (
    evidenceId.startsWith("live.conversion.") ||
    evidenceId.startsWith("live.site.") ||
    evidenceId.startsWith("live.form.") ||
    evidenceId.startsWith("live.crawl.")
  ) {
    return { scopes: ["public_pages"], surfaces: [] };
  }

  /* Direct observation that a surface redirects anonymous visitors to login. */
  if (evidenceId === "live.access.protected_surface") {
    return { scopes: ["authenticated_pages"], surfaces: ["dashboard_app"] };
  }

  if (evidenceId.startsWith("live.surface.")) {
    const live = evidenceId.slice("live.surface.".length) as ProductSurfaceId;
    const surface = LIVE_SURFACE_TO_BUSINESS[live];
    if (!surface) return NOTHING;
    return surface === "dashboard_app"
      ? { scopes: ["authenticated_pages", "named_surface"], surfaces: [surface] }
      : { scopes: ["named_surface"], surfaces: [surface] };
  }

  if (evidenceId.startsWith("repo.surface.")) {
    const id = evidenceId.slice("repo.surface.".length);
    if (!BUSINESS_SURFACE_SET.has(id)) return NOTHING;
    const surface = id as BusinessSurfaceId;
    return surface === "dashboard_app"
      ? { scopes: ["authenticated_pages", "named_surface"], surfaces: [surface] }
      : { scopes: ["named_surface"], surfaces: [surface] };
  }

  return NOTHING;
}

/** `live.seo.canonical_missing` names the `canonical` signal. */
function stripMissing(value: string): string {
  return value.endsWith("_missing") ? value.slice(0, -"_missing".length) : value;
}

export type DeriveSurfaceRequirementInput = {
  changeKind: StepChangeKind;
  /** Vibe-minted ids the step cites. Validated at planning time. */
  evidenceIds: readonly string[];
};

/**
 * The step's execution surface, from trusted structured data only.
 *
 * Deterministic and order-independent: the scopes and surfaces come out in
 * vocabulary order whatever order the ids arrived in, so the same step always
 * produces the same requirement and a stored brief stays reproducible.
 */
export function deriveExecutionSurfaceRequirement(
  input: DeriveSurfaceRequirementInput,
): ExecutionSurfaceRequirement {
  if (!MUTATING_CHANGE_KINDS.includes(input.changeKind)) return EMPTY_SURFACE_REQUIREMENT;

  const scopes = new Set<ExecutionSurfaceScope>();
  const surfaces = new Set<BusinessSurfaceId>();
  const derivedFrom: string[] = [];
  const unrecognised: string[] = [];

  for (const id of input.evidenceIds) {
    const implication = implicationOf(id);
    if (implication.scopes.length === 0 && implication.surfaces.length === 0) {
      unrecognised.push(id);
      continue;
    }
    derivedFrom.push(id);
    implication.scopes.forEach((scope) => scopes.add(scope));
    implication.surfaces.forEach((surface) => surfaces.add(surface));
  }

  return {
    requirementVersion: EXECUTION_SURFACE_REQUIREMENT_VERSION,
    scopes: EXECUTION_SURFACE_SCOPES.filter((scope) => scopes.has(scope)),
    surfaces: BUSINESS_SURFACE_IDS.filter((surface) => surfaces.has(surface)),
    derivedFrom,
    unrecognised,
  };
}

/* ---------------------------------------------------------------------------
 * Resolving a requirement against stored intelligence (PART C)
 * ------------------------------------------------------------------------ */

export type ResolvedRoute = {
  /** The URL path the analyzer inferred. */
  path: string;
  /** The repository file that serves it, at the pinned commit. */
  sourcePath: string;
  confidence: Confidence;
  /** True when the anonymous live crawler actually reached this URL. */
  liveObserved: boolean;
};

export type ResolvedExecutionSurface = {
  publicPages: readonly ResolvedRoute[];
  authenticatedPages: readonly ResolvedRoute[];
  /**
   * Directories the authenticated area was observed in.
   *
   * Derived from the `dashboard_app` surface's own evidence paths, which the
   * repository analyzer produced from routes whose URL matched its app-area
   * pattern. Vibe does not decide here what "private" looks like; it reads what
   * its analyzer already concluded.
   */
  authenticatedRoots: readonly string[];
  /** True when a live scan contributed observation to the split. */
  corroboratedByLiveScan: boolean;
};

const EMPTY_RESOLUTION: ResolvedExecutionSurface = {
  publicPages: [],
  authenticatedPages: [],
  authenticatedRoots: [],
  corroboratedByLiveScan: false,
};

function directoryOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "" : path.slice(0, cut);
}

/**
 * Public and authenticated page routes, split from stored intelligence.
 *
 * ## Why the repository is primary and the live scan only corroborates
 *
 * The snapshot is pinned to the commit this run works against; the deployed site
 * is not pinned to anything (`LiveProductContext.relationToRepository` is
 * `unknown` and stays that way). So the route list comes from the repository,
 * and the live scan may only do two things: confirm that an anonymous visitor
 * really reached a URL, or report that one redirected to a login. Both narrow or
 * strengthen; neither invents a path.
 *
 * A page that the crawler saw redirect is treated as authenticated even if the
 * directory test said otherwise — that is direct observation of protection, and
 * the safe direction is to leave it out of a public-page task.
 */
export function resolveExecutionSurface(input: {
  snapshot: RepositoryIntelligenceSnapshot;
  live: LiveProductIntelligenceSnapshot | null;
  usablePath: (path: string) => boolean;
}): ResolvedExecutionSurface {
  const { snapshot, live, usablePath } = input;
  if (snapshot.routes.mode === "none" || snapshot.routes.mode === "limited") {
    return EMPTY_RESOLUTION;
  }

  const dashboard = snapshot.businessSurfaces.find((surface) => surface.id === "dashboard_app");
  const authenticatedRoots = dashboard?.detected
    ? [
        ...new Set(
          dashboard.evidence
            .filter((item) => usablePath(item.path))
            .map((item) => directoryOf(item.path))
            .filter((directory) => directory.length > 0),
        ),
      ].sort()
    : [];

  /* Live observation, keyed by the URL path the crawler requested. */
  const observed = new Map<string, { protected: boolean }>();
  for (const page of live?.pages ?? []) {
    observed.set(page.path, { protected: page.redirectedTo !== null });
  }

  const underAuthenticatedRoot = (sourcePath: string) =>
    authenticatedRoots.some(
      (root) => sourcePath === root || sourcePath.startsWith(`${root}/`),
    );

  const publicPages: ResolvedRoute[] = [];
  const authenticatedPages: ResolvedRoute[] = [];

  for (const route of snapshot.routes.routes) {
    if (route.kind !== "page" || !usablePath(route.sourcePath)) continue;

    const observation = observed.get(route.path);
    const isAuthenticated = underAuthenticatedRoot(route.sourcePath) || observation?.protected === true;
    const liveObserved = observation !== undefined && !observation.protected;

    const resolved: ResolvedRoute = {
      path: route.path,
      sourcePath: route.sourcePath,
      confidence: confidenceFor(route, liveObserved, snapshot.routes.truncated),
      liveObserved,
    };

    (isAuthenticated ? authenticatedPages : publicPages).push(resolved);
  }

  return {
    publicPages: rankResolved(publicPages),
    authenticatedPages: rankResolved(authenticatedPages),
    authenticatedRoots,
    corroboratedByLiveScan: observed.size > 0,
  };
}

/**
 * How strongly Vibe believes this file serves this page.
 *
 * `high` only when the crawler independently reached the URL. A dynamic route is
 * a template rather than one page, and a truncated route listing means the
 * analyzer stopped early — both are honest reasons to say `medium`.
 */
function confidenceFor(route: RouteSummary, liveObserved: boolean, truncated: boolean): Confidence {
  if (route.dynamic) return "low";
  if (truncated) return "medium";
  return liveObserved ? "high" : "medium";
}

/**
 * Deterministic ranking, so a cap keeps the same routes every time (PART E).
 *
 * Observed-live first, then static before dynamic, then shallower URLs, then
 * alphabetical. No model ranks this and no timestamp enters it.
 */
function rankResolved(routes: readonly ResolvedRoute[]): ResolvedRoute[] {
  return [...routes].sort((a, b) => {
    if (a.liveObserved !== b.liveObserved) return a.liveObserved ? -1 : 1;

    const depthA = a.path.split("/").length;
    const depthB = b.path.split("/").length;
    if (depthA !== depthB) return depthA - depthB;

    return a.path.localeCompare(b.path);
  });
}
