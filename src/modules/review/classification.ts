import type {
  ExecutionSurfaceRequirement,
  ResolvedExecutionSurface,
} from "@/modules/execution-context/surface";

/**
 * Which review a prepared change actually deserves (Sprint 0048).
 *
 * ## The question this exists to ask
 *
 * A visual review is a running preview of the change, opened and clicked
 * through. It is good at what it does and it cannot ask whether it is the right
 * instrument. Start one for a backend-only change and you get a page that looks
 * exactly as it did: a confident, useless result that looks like a review — and
 * a paid sandbox to produce it.
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
 * v3 is Sprint 0114: the *rules* are identical, and what `visual` asks for is
 * not. It used to mean "photograph this page"; it now means "run this and look
 * at it" (ADR 0065). A stored classification must never be reinterpreted under
 * rules it was not decided by, and that includes what it asked someone to do.
 *
 * Not part of any identity — this output is recomputed on read and never
 * stored, so nothing can be reinterpreted under rules it was not decided by.
 * The version exists so a displayed recommendation can be traced to a policy.
 */
export const REVIEW_CLASSIFICATION_VERSION = "review-classification-v4" as const;

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
 *
 * ## Anchored at the application, not at the repository
 *
 * Every pattern is anchored, and until Stufe 4 it was anchored at the
 * repository root — which was the same place while every validatable repository
 * had its application there. It is not any more: an application in `frontend/`
 * changes `frontend/src/app/page.tsx`, and against a root-anchored pattern that
 * matches nothing. Nothing would have failed. Every change would have
 * classified as `code`, no preview would ever have been recommended, and
 * `render-impact.ts` would never have run — silently, with every test green.
 *
 * So the caller passes the workspace root and paths are made
 * application-relative first. Stripping rather than loosening the patterns is
 * deliberate: a pattern that tolerated any leading directory would also match
 * `docs/app/page.tsx`, which is prose about a page rather than a page.
 */
const RENDERABLE_PATTERNS: readonly RegExp[] = [
  /^src\/app\/(?!api\/).*\.tsx$/i,
  /^src\/components\/.*\.tsx$/i,
  /^app\/(?!api\/).*\.tsx$/i,
  /^components\/.*\.tsx$/i,
  /* Vite and its family put routed views under `src/pages/` or `src/routes/`,
     and neither has an `app/` directory to be recognised by. */
  /^src\/pages\/.*\.[jt]sx$/i,
  /^src\/routes\/.*\.[jt]sx$/i,
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
  /**
   * Paths a structural proof cleared: their non-metadata program text is
   * byte-identical between base and head, so nothing that can reach the DOM
   * changed (`render-impact.ts`).
   *
   * Absent or empty means **not proven** — never "proven visible". The path
   * rule below is what decides in that case, exactly as it did before this
   * input existed.
   */
  provenNonRendering?: readonly string[];
  /**
   * Where the application lives, so a path can be read relative to it.
   *
   * Absent means the repository root, which is what every change classified
   * before a repository could hold its application anywhere — so an old caller
   * and an old stored classification still mean the same thing.
   */
  workspaceRoot?: string;
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
  /**
   * Paths the path rule called visual and a structural proof then cleared.
   * Sorted, and always a subset of what `visualPaths` would otherwise hold.
   *
   * Carried so the panel can say *why* a page file did not earn a screenshot,
   * rather than leaving a reader to wonder whether the classifier missed it.
   */
  downgradedPaths: readonly string[];
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
function isVisual(path: string, routeSources: ReadonlySet<string>, workspaceRoot: string): boolean {
  if (TEST_FILE_PATTERN.test(path)) return false;
  // The analyzer's route table is repository-relative, like `changedPaths`, so
  // this comparison stays on the unstripped path.
  if (routeSources.has(path)) return true;

  const relative = withinWorkspace(path, workspaceRoot);
  return relative !== null && RENDERABLE_PATTERNS.some((pattern) => pattern.test(relative));
}

/**
 * A repository path expressed relative to the application, or null.
 *
 * Null means the path is outside the application entirely — a sibling service,
 * a shared `docs/` directory — which is not renderable by any pattern here and
 * should not be made to look like one by trimming a prefix that never matched.
 */
function withinWorkspace(path: string, workspaceRoot: string): string | null {
  if (workspaceRoot === "." || workspaceRoot === "") return path;

  const prefix = `${workspaceRoot}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/**
 * The recommended review for one prepared change.
 *
 * `code` is the fallback in both directions — for a change with no visual paths
 * and for the degenerate case of no changed paths at all. That asymmetry is
 * deliberate. Recommending a code diff for something visual wastes a reviewer's
 * attention; asking someone to boot a preview of something invisible spends
 * their money to show them a page that did not change.
 *
 * ## Why the proof can only ever subtract
 *
 * `provenNonRendering` is consulted **after** `isVisual` has already said yes,
 * and nowhere else. So a proof can move a path from visual to code and can
 * never move one the other way — that is a property of where the check sits,
 * not a rule anyone has to remember. `touchedRoutes` derives from the surviving
 * `visualPaths`, so a downgraded layout correctly stops naming a route too.
 */
export function classifyReview(input: ClassifyReviewInput): ReviewClassificationResult {
  const workspaceRoot = input.workspaceRoot ?? ".";
  const routes = routesOf(input.surface);
  const routeSources = new Set(routes.map((route) => route.sourcePath));
  const proven = new Set(input.provenNonRendering ?? []);

  const visualPaths: string[] = [];
  const codePaths: string[] = [];
  const downgradedPaths: string[] = [];

  for (const path of input.changedPaths) {
    if (!isVisual(path, routeSources, workspaceRoot)) {
      codePaths.push(path);
      continue;
    }

    if (proven.has(path)) {
      downgradedPaths.push(path);
      codePaths.push(path);
      continue;
    }

    visualPaths.push(path);
  }

  visualPaths.sort();
  codePaths.sort();
  downgradedPaths.sort();

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
    downgradedPaths,
  };
}

/**
 * Why a page file did not earn a preview.
 *
 * Deliberately says what *did* change rather than implying nothing did.
 * `metadata.title` really does render — in the browser tab, and on other
 * people's sites through Open Graph. What is true is narrower and is exactly
 * the point: none of it is on the page, so booting the application to look at
 * the page would answer a question nobody asked, and the diff answers the one
 * they did.
 */
export const REVIEW_DOWNGRADE_NOTE =
  "Some changed page files only alter page metadata — the title, description and " +
  "search-engine directives. What a visitor sees on the page is unchanged, so a " +
  "preview would show you exactly what is there now.";

/** Vibe's own words for the panel. Never a model's. */
export const REVIEW_CLASSIFICATION_LABELS: Record<ReviewClassification, string> = {
  visual: "Preview",
  code: "Code diff",
  visual_and_code: "Preview and code diff",
};

export const REVIEW_CLASSIFICATION_NOTES: Record<ReviewClassification, string> = {
  visual: "This change alters what a visitor sees. Opening it is the review.",
  code: "This change does not alter a rendered page. Reading the diff is the review.",
  visual_and_code:
    "This change alters both what a visitor sees and what runs behind it. Both are worth a look.",
};
