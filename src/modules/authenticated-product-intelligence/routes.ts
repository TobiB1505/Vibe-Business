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
 * audit actually learns, and one fact we already hold is a better signal than
 * the path alone: a path the public crawl watched bounce to a login page is
 * *proven* to be protected. That is the strongest evidence a route is part of
 * the signed-in product, so it outranks a same-named route merely declared in
 * the file tree.
 *
 * Sprint 6 §5 also carried a *penalty* for a path the public crawl had already
 * fetched successfully — a demotion rather than a removal, on the argument that
 * a signed-in `/` may be a different page entirely. That penalty is gone: such
 * a path is no longer ranked lower, it is not a candidate at all (see
 * `buildRouteCandidates`). Priorities are floored at 1 so no adjustment can
 * push a candidate to the bottom by accident.
 */
const PROTECTED_ROUTE_BONUS = 15;
const AUTHENTICATED_LINK_BONUS = 5;
const MIN_PRIORITY = 1;

export function candidatePriority(path: string, source: RouteCandidateSource): number {
  let priority = priorityFor(path);

  if (source === "public_protected_redirect") {
    priority += PROTECTED_ROUTE_BONUS;
  } else if (source === "authenticated_link") {
    priority += AUTHENTICATED_LINK_BONUS;
  }
  // The landing page is never adjusted: it is where the browser already is.

  return Math.max(priority, MIN_PRIORITY);
}

/**
 * The template a path belongs to, with its identifiers replaced.
 *
 * `/app/projects/88d1c463-…/settings` and `/app/projects/9b702a96-…/settings`
 * are the same screen holding different rows. A scan that treats them as two
 * discoveries spends its budget learning the same thing twice — the first run
 * that read pages properly inspected **25 pages and saw 8 screens**, four
 * copies each of a project workspace's seven tabs, and reported `integrations`
 * and `onboarding` as absent because it never reached `/app/connect/github` or
 * `/app/onboarding` at all.
 *
 * Deliberately conservative. A segment is only an identifier when it could not
 * plausibly be a word someone chose: a UUID, a run of digits, a long hex
 * string, or a long opaque token with both digits and letters. `/app/billing`
 * and `/app/settings` must survive this untouched, because collapsing a real
 * route into a shape would hide a surface rather than a duplicate.
 */
const IDENTIFIER_SEGMENT = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\d+$/,
  /^[0-9a-f]{12,}$/i,
  // A nanoid, a Stripe id, a base62 key: long, and mixing digits with letters
  // in a way a hand-written slug does not.
  /^(?=.*\d)(?=.*[a-z])[A-Za-z0-9_-]{12,}$/,
];

export function routeShape(path: string): string {
  return path
    .split("/")
    .map((segment) =>
      segment !== "" && IDENTIFIER_SEGMENT.some((pattern) => pattern.test(segment))
        ? ":id"
        : segment,
    )
    .join("/");
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

  /*
   * Paths the public crawl already fetched and rendered **anonymously**.
   *
   * These are skipped outright now, where they used to be merely demoted — and
   * demoted only when they arrived as a repository route, which is why a real
   * scan spent candidates on `/`, `/privacy`, `/terms`, `/forgot-password` and
   * `/reset-password`: they arrived as links from the signed-in shell, and the
   * penalty never applied to those.
   *
   * A page that renders the same to nobody is not authenticated product. The
   * live product scan reads it already, statically, for no browser seconds and
   * no Credits — reading it again here spends a page of a budget sized against
   * the ten surfaces that only exist behind a login.
   *
   * The landing page is exempt, because it is where the browser already is.
   */
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
    if (source !== "landing" && publiclyRendered.has(path)) return;
    const existing = byPath.get(path);
    if (existing && existing.depth <= depth) return;
    byPath.set(path, { path, source, depth, priority: candidatePriority(path, source) });
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
  options: {
    origin: string;
    depth: number;
    budgets: AuthenticatedCrawlBudgets;
    /**
     * Paths the public scan already read anonymously, skipped here too.
     *
     * This is the path `/privacy` and `/terms` actually arrived by: not as
     * repository routes, but as links in the signed-in shell's own footer. An
     * exclusion that only covered `buildRouteCandidates` would have left the
     * one source that produced them.
     */
    publiclyRendered?: ReadonlySet<string>;
  },
): RouteCandidate[] {
  const seen = new Set(existing.map((candidate) => candidate.path));
  const added: RouteCandidate[] = [];

  for (const link of links.slice(0, options.budgets.maxLinksPerPage)) {
    if (existing.length + added.length >= options.budgets.maxCandidates) break;
    if (options.depth > options.budgets.maxDepth) break;

    const path = toSameOriginPath(link, options.origin);
    if (path === null || isNeverVisit(path) || seen.has(path)) continue;
    if (options.publiclyRendered?.has(path)) continue;

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
