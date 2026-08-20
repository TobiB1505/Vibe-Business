import type {
  ExecutionSurfaceRequirement,
  ResolvedExecutionSurface,
} from "@/modules/execution-context/surface";

/**
 * Which review a prepared change actually deserves (Sprint 0048).
 *
 * ## The question this exists to ask
 *
 * `src/modules/review/` has exactly one profile — `public_visual_review_v1`, a
 * before/after screenshot comparison. It is good at what it does and it cannot
 * ask whether it is the right instrument. Photograph a backend-only change and
 * you get two identical pictures of a page that did not change: a confident,
 * useless result that looks like a review.
 *
 * So this answers the prior question, and only that. It starts nothing, gates
 * nothing and authorizes nothing — it is a recommendation attached to a change
 * that has already been prepared and verified.
 *
 * ## What decides it
 *
 * Three inputs, all minted or verified by Vibe:
 *
 * - the changed paths from `prepared_changes.files`, which are Vibe's own
 *   observation of the commit rather than the agent's account of it;
 * - the analyzer's resolved execution surface, whose routes each name the
 *   repository file that serves them;
 * - the evidence-derived `ExecutionSurfaceRequirement` from Sprint 0044.
 *
 * No model call, no commit message, no agent explanation — the same rule the
 * risk classifier and the depth resolver already hold to, and for the same
 * reason: the thing being reviewed must not get to choose how it is reviewed.
 *
 * ## Why the route table comes first
 *
 * Because "does this file put pixels on a page?" is a question the repository
 * analyzer has already answered, for real routes, at the pinned commit. Reading
 * that answer is not a filename heuristic; it is the analyzer's own conclusion
 * about this specific repository.
 *
 * The structural test below is the fallback for everything the route table
 * cannot cover — components, stylesheets, and any repository whose route
 * analysis came back `limited` or `none`.
 */

export const REVIEW_CLASSIFICATIONS = ["visual", "code", "visual_and_code"] as const;
export type ReviewClassification = (typeof REVIEW_CLASSIFICATIONS)[number];

/**
 * Bumped when the rules below change what a classification means.
 *
 * Not part of any identity — this output is recomputed on read and never
 * stored, so nothing can be reinterpreted under rules it was not decided by.
 * The version exists so a displayed recommendation can be traced to a policy.
 */
export const REVIEW_CLASSIFICATION_VERSION = "review-classification-v1" as const;

/**
 * Files whose contents can only reach rendered output.
 *
 * The same structural distinction Sprint 0047's depth policy relies on, and
 * deliberately the same reasoning: under the App Router a single character
 * separates the renderable from the not — route handlers (`route.ts`), server
 * actions (`actions.ts`) and every library module are `.ts`, while pages,
 * layouts and components are `.tsx`.
 *
 * That is why this is a rule about *file kind and location*, not a list of
 * names. `api/` is excluded explicitly because a `.tsx` under an API route
 * would be a surprising thing to call presentational.
 */
const RENDERABLE_PATTERNS: readonly RegExp[] = [
  /^src\/app\/(?!api\/).*\.tsx$/i,
  /^src\/components\/.*\.tsx$/i,
  /^app\/(?!api\/).*\.tsx$/i,
  /^components\/.*\.tsx$/i,
  /\.(css|scss|svg)$/i,
];

/**
 * Test files, which are never shipped and never rendered.
 *
 * Held out of the visual set for the same reason Sprint 0047 holds them out of
 * its presentational set: a Playwright spec named after a page is not that
 * page. They fall through to `code`, which is correct — a spec change is
 * reviewed by reading it.
 */
const TEST_FILE_PATTERN = /(^|\/)(e2e\/.*\.spec\.[cm]?[jt]sx?|.*\.test\.[cm]?[jt]sx?)$/i;

export type ClassifyReviewInput = {
  /** Paths Vibe verified as changed. Never the agent's own list. */
  changedPaths: readonly string[];
  /**
   * The analyzer's route table for the pinned commit, when one resolved.
   *
   * Null when route analysis was `limited` or `none`. That is not an error and
   * not a reason to refuse: the structural test below still answers, it just
   * answers without the repository-specific corroboration.
   */
  surface: ResolvedExecutionSurface | null;
  /** Evidence-derived scopes, for the explanation rather than the decision. */
  requirement: ExecutionSurfaceRequirement | null;
};

export type ReviewClassificationResult = {
  classification: ReviewClassification;
  policyVersion: typeof REVIEW_CLASSIFICATION_VERSION;
  /** Changed paths that put something on a screen. Sorted. */
  visualPaths: readonly string[];
  /** Changed paths that do not. Sorted. */
  codePaths: readonly string[];
  /**
   * URL paths served by a changed file, when the route table resolved one.
   *
   * The concrete reason a change is visual, and the list a later review flow
   * would photograph. Empty when the decision rested on the structural test
   * alone.
   */
  routes: readonly string[];
  /** Evidence-derived scopes carried through, for display. */
  scopes: readonly string[];
};

/** Every route in the resolved surface, public and authenticated alike. */
function routesOf(surface: ResolvedExecutionSurface | null) {
  if (!surface) return [];
  return [...surface.publicPages, ...surface.authenticatedPages];
}

/**
 * Whether a changed path can affect what a person sees.
 *
 * Route table first, structure second. Both are positive tests: a path that
 * satisfies neither is not "unknown", it is code — and a code diff is a review
 * that always works.
 */
function isVisual(path: string, routeSources: ReadonlySet<string>): boolean {
  if (TEST_FILE_PATTERN.test(path)) return false;
  if (routeSources.has(path)) return true;
  return RENDERABLE_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * The recommended review for one prepared change.
 *
 * `code` is the fallback in both directions — for a change with no visual paths
 * and for the degenerate case of no changed paths at all. That asymmetry is
 * deliberate. Recommending a code diff for something visual wastes a reviewer's
 * attention; recommending a screenshot comparison for something invisible
 * produces two identical images and the false impression that the change was
 * looked at.
 */
export function classifyReview(input: ClassifyReviewInput): ReviewClassificationResult {
  const routes = routesOf(input.surface);
  const routeSources = new Set(routes.map((route) => route.sourcePath));

  const visualPaths: string[] = [];
  const codePaths: string[] = [];

  for (const path of input.changedPaths) {
    if (isVisual(path, routeSources)) visualPaths.push(path);
    else codePaths.push(path);
  }

  visualPaths.sort();
  codePaths.sort();

  const touchedRoutes = [
    ...new Set(
      routes.filter((route) => visualPaths.includes(route.sourcePath)).map((route) => route.path),
    ),
  ].sort();

  const classification: ReviewClassification =
    visualPaths.length > 0 && codePaths.length > 0
      ? "visual_and_code"
      : visualPaths.length > 0
        ? "visual"
        : "code";

  return {
    classification,
    policyVersion: REVIEW_CLASSIFICATION_VERSION,
    visualPaths,
    codePaths,
    routes: touchedRoutes,
    scopes: input.requirement?.scopes ?? [],
  };
}

/** Vibe's own words for the panel. Never a model's. */
export const REVIEW_CLASSIFICATION_LABELS: Record<ReviewClassification, string> = {
  visual: "Visual preview",
  code: "Code diff",
  visual_and_code: "Visual preview and code diff",
};

export const REVIEW_CLASSIFICATION_NOTES: Record<ReviewClassification, string> = {
  visual: "This change alters what a visitor sees. Looking at it is the review.",
  code: "This change does not alter a rendered page. Reading the diff is the review.",
  visual_and_code:
    "This change alters both what a visitor sees and what runs behind it. Both are worth a look.",
};
