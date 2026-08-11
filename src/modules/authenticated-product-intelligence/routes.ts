import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";
import type { AuthenticatedCrawlBudgets } from "./budgets";

/**
 * Evidence-backed route discovery and origin policy (Sprint 5 §14, §15).
 *
 * The public crawler missed `/app` because nothing links to it. The wrong fix
 * is a dictionary of guesses (`/admin`, `/internal`, `/secrets`): it probes
 * surfaces we have no reason to believe exist, on someone else's application,
 * while logged in as them. The right fix is that we already have evidence —
 * Repository Intelligence enumerates the app's own routes from its file tree,
 * and the public crawl already recorded which paths bounced to a login page.
 *
 * So every candidate carries the source that justifies it. A path with no
 * source is not a candidate, and there is no code path that invents one.
 */

/** Why we believe this path is part of the product. */
export type RouteCandidateSource =
  /** The page the user was on when they confirmed login. */
  | "landing"
  /** A page route enumerated by Repository Intelligence from the file tree. */
  | "repository_route"
  /** A path the public crawl saw redirect to a login surface. */
  | "public_protected_redirect"
  /** A same-origin link visible in the authenticated UI. */
  | "authenticated_link";

export type RouteCandidate = {
  /** Origin-relative pathname. Never a full URL, never a query string. */
  path: string;
  source: RouteCandidateSource;
  /** Depth from the landing page; landing is 0. */
  depth: number;
  /** Higher is inspected first. Product-critical surfaces rank above the rest. */
  priority: number;
};

/**
 * Paths that are never worth an authenticated navigation.
 *
 * `logout` is the important one: visiting it would end the very session we are
 * analysing (Sprint 5 §17). The rest are auth surfaces we have already
 * analysed anonymously, or destructive-by-name endpoints.
 */
const NEVER_VISIT = [
  /(^|\/)(logout|signout|sign-out|log-out)(\/|$)/i,
  /(^|\/)(login|signin|sign-in|log-in|signup|sign-up|register)(\/|$)/i,
  /(^|\/)(delete|destroy|remove|cancel|unsubscribe|checkout|pay|purchase)(\/|$)/i,
];

/**
 * Product-critical surface hints, used only to *order* evidence-backed
 * candidates — never to invent them. A path scores only if something already
 * put it on the list.
 */
const PRIORITY_HINTS: { pattern: RegExp; priority: number }[] = [
  // Anchored to the app *root* only. A greedy `(^|/)app(/|$)` would rank every
  // page under `/app/` as the top-priority dashboard, including
  // `/app/legal/imprint`, and starve the surfaces we actually want first.
  { pattern: /^\/(app|dashboard|home)\/?$/i, priority: 100 },
  { pattern: /(^|\/)(onboarding|welcome|get-?started|setup)(\/|$)/i, priority: 90 },
  { pattern: /(^|\/)(projects?|workspaces?|teams?|organizations?)(\/|$)/i, priority: 80 },
  { pattern: /(^|\/)(settings|account|profile|preferences)(\/|$)/i, priority: 70 },
  { pattern: /(^|\/)(billing|subscription|plan|usage|credits)(\/|$)/i, priority: 60 },
  { pattern: /(^|\/)(analytics|insights|reports?|metrics)(\/|$)/i, priority: 50 },
];

function priorityFor(path: string): number {
  for (const hint of PRIORITY_HINTS) {
    if (hint.pattern.test(path)) return hint.priority;
  }
  return 10;
}

/**
 * Evidence-strength adjustments on top of the path hints (Sprint 6 §5).
 *
 * A Deep Scan gets a handful of page visits, so the ordering decides what the
 * audit actually learns. Two facts we already hold are better signals than the
 * path alone:
 *
 *  - A path the public crawl watched bounce to a login page is *proven* to be
 *    protected. That is the strongest evidence a route is part of the signed-in
 *    product, so it outranks a same-named route merely declared in the file
 *    tree.
 *  - A path the public crawl already fetched successfully has, by definition,
 *    already been described by Public Product Intelligence.
 *
 * The second is a **demotion, never a removal**. A marketing page and `/` often
 * render differently once signed in — a logged-in `/` that shows a dashboard is
 * exactly the kind of thing worth seeing — so these stay on the list, just
 * behind routes that can only be reached with a session. Priorities are floored
 * at 1 so no adjustment can push a candidate to the bottom by accident.
 */
const PROTECTED_ROUTE_BONUS = 15;
const AUTHENTICATED_LINK_BONUS = 5;
const PUBLIC_OVERLAP_PENALTY = 8;
const MIN_PRIORITY = 1;

export function candidatePriority(
  path: string,
  source: RouteCandidateSource,
  publiclyRendered: ReadonlySet<string> = new Set(),
): number {
  let priority = priorityFor(path);

  if (source === "public_protected_redirect") {
    priority += PROTECTED_ROUTE_BONUS;
  } else if (source === "authenticated_link") {
    priority += AUTHENTICATED_LINK_BONUS;
  } else if (source === "repository_route" && publiclyRendered.has(path)) {
    priority -= PUBLIC_OVERLAP_PENALTY;
  }
  // The landing page is never adjusted: it is where the browser already is.

  return Math.max(priority, MIN_PRIORITY);
}

export function isNeverVisit(path: string): boolean {
  return NEVER_VISIT.some((pattern) => pattern.test(path));
}

/**
 * Normalizes a URL to an origin-relative pathname, or rejects it.
 *
 * Rejects anything that is not same-origin as the configured production
 * origin, and strips query and fragment: a query string on an authenticated
 * page routinely carries tokens, invite codes and email addresses, and we do
 * not want them in a candidate list, a snapshot, or a log (Sprint 5 §21).
 */
export function toSameOriginPath(candidate: string, origin: string): string | null {
  let expected: URL;
  try {
    expected = new URL(origin);
  } catch {
    return null;
  }

  let url: URL;
  try {
    // A relative candidate resolves against the origin; an absolute one keeps
    // its own origin and is then compared.
    url = new URL(candidate, expected);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.origin !== expected.origin) return null;

  const path = url.pathname === "" ? "/" : url.pathname;
  // Bound the path: an absurd path is either an attack or a bug, and it has no
  // business reaching a navigation or a database row.
  if (path.length > 512) return null;
  return path;
}

/** True when a URL is safe to navigate the *analysis* browser to. */
export function isSafeAnalysisTarget(candidate: string, origin: string): boolean {
  const path = toSameOriginPath(candidate, origin);
  return path !== null && !isNeverVisit(path);
}

export type RouteSeedInput = {
  origin: string;
  /** Where the browser actually was when the user confirmed login. */
  landingPath: string;
  repository: RepositoryIntelligenceSnapshot | null;
  publicProduct: LiveProductIntelligenceSnapshot | null;
  budgets: AuthenticatedCrawlBudgets;
};

/**
 * Builds the initial candidate list from evidence that already exists.
 *
 * Dynamic repository routes (`/project/[id]`) are deliberately dropped: we
 * have no id to substitute, and inventing one would either 404 or — worse —
 * address a real record belonging to a real customer.
 */
export function buildRouteCandidates(input: RouteSeedInput): RouteCandidate[] {
  const { origin, landingPath, repository, publicProduct, budgets } = input;
  const byPath = new Map<string, RouteCandidate>();

  // Paths the public crawl already fetched and rendered anonymously. Used only
  // to demote overlapping repository routes — see `candidatePriority`.
  const publiclyRendered = new Set<string>();
  for (const page of publicProduct?.pages ?? []) {
    if (page.redirectedTo !== null) continue;
    if (page.status < 200 || page.status >= 300) continue;
    const path = toSameOriginPath(page.path, origin);
    if (path !== null) publiclyRendered.add(path);
  }

  const add = (raw: string, source: RouteCandidateSource, depth: number): void => {
    if (byPath.size >= budgets.maxCandidates) return;
    const path = toSameOriginPath(raw, origin);
    if (path === null || isNeverVisit(path)) return;
    const existing = byPath.get(path);
    if (existing && existing.depth <= depth) return;
    byPath.set(path, { path, source, depth, priority: candidatePriority(path, source, publiclyRendered) });
  };

  // 1. Where the user already is. Always first, always depth 0.
  add(landingPath, "landing", 0);

  // 2. Paths the public crawl saw bounce to a login surface. This is the
  //    Sprint 3 limitation turned into evidence: `/app -> /login` is a strong
  //    signal that `/app` exists and is protected.
  for (const page of publicProduct?.pages ?? []) {
    if (page.redirectedTo && /login|signin|sign-in/i.test(page.redirectedTo)) {
      add(page.path, "public_protected_redirect", 1);
    }
  }

  // 3. Page routes the repository itself declares. `api` and `layout` routes
  //    are not user-visible surfaces; dynamic segments have no safe value.
  for (const route of repository?.routes.routes ?? []) {
    if (route.kind !== "page") continue;
    if (route.dynamic) continue;
    add(route.path, "repository_route", 1);
  }

  return sortCandidates([...byPath.values()]);
}

/** Deterministic ordering: priority, then shallower, then alphabetical. */
export function sortCandidates(candidates: RouteCandidate[]): RouteCandidate[] {
  return [...candidates].sort(
    (a, b) => b.priority - a.priority || a.depth - b.depth || a.path.localeCompare(b.path),
  );
}

/**
 * Adds same-origin links harvested from an authenticated page.
 *
 * Returns only genuinely new candidates, so the caller's budget accounting
 * stays honest.
 */
export function extendCandidates(
  existing: RouteCandidate[],
  links: string[],
  options: { origin: string; depth: number; budgets: AuthenticatedCrawlBudgets },
): RouteCandidate[] {
  const seen = new Set(existing.map((candidate) => candidate.path));
  const added: RouteCandidate[] = [];

  for (const link of links.slice(0, options.budgets.maxLinksPerPage)) {
    if (existing.length + added.length >= options.budgets.maxCandidates) break;
    if (options.depth > options.budgets.maxDepth) break;

    const path = toSameOriginPath(link, options.origin);
    if (path === null || isNeverVisit(path) || seen.has(path)) continue;

    seen.add(path);
    added.push({
      path,
      source: "authenticated_link",
      depth: options.depth,
      priority: candidatePriority(path, "authenticated_link"),
    });
  }

  return sortCandidates(added);
}
