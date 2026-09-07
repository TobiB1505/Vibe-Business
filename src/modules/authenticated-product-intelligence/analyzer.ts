import { AuthenticatedBudgetTracker, DEFAULT_AUTHENTICATED_BUDGETS, type AuthenticatedCrawlBudgets } from "./budgets";
import type { AuthenticatedAnalysisFailure, AuthenticatedWarningCode } from "./errors";
import { readSameOriginLinks, sanitizePageExtraction, type RawPageExtraction } from "./extract";
import {
  buildRouteCandidates,
  extendCandidates,
  isSafeAnalysisTarget,
  routeShape,
  sortCandidates,
  toSameOriginPath,
  type RouteCandidateSource,
} from "./routes";
import {
  AUTHENTICATED_PRODUCT_ANALYZER_VERSION,
  AUTHENTICATED_PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
  AUTHENTICATED_SURFACE_LABELS,
  type AuthenticatedEvidence,
  type AuthenticatedPageSummary,
  type AuthenticatedProductIntelligenceSnapshot,
  type AuthenticatedSurfaceId,
  type AuthenticatedSurfaceSignal,
  type AuthenticatedWarning,
  type Confidence,
} from "./schema";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";

/**
 * Deterministic authenticated analysis (Sprint 5 §13–§23).
 *
 * Drives an already-authenticated browser through evidence-backed same-origin
 * paths and reduces each one to derived structure. There is no AI in this loop
 * and no model decides where to navigate — every destination comes from
 * `routes.ts`, which requires evidence for each candidate.
 *
 * The browser is reached through `AnalysisBrowserPort`, so the whole pipeline is
 * unit-testable with a fake and CI never starts a real browser (Sprint 5 §31).
 */

/** One page in the live browser, reduced to what analysis needs. */
export type AnalysisPagePort = {
  /** Current top-level URL. Used for origin verification. */
  url(): string;
  /** Same-origin GET navigation. Returns the HTTP status when known. */
  goto(url: string, options: { timeoutMs: number }): Promise<{ status: number | null }>;
  /**
   * Waits until the page stops navigating itself.
   *
   * Required rather than optional, and never allowed to throw. An optional
   * method is one a fake can omit and a production path can quietly skip —
   * this module has already paid for that once, with a connector mock that
   * never provided `openSessionAtOrigin` and a `catch {}` that hid it.
   */
  settle(options: { quietMs: number; timeoutMs: number }): Promise<void>;
  /** Runs the extraction script in the page. */
  extract(): Promise<RawPageExtraction>;
};

export type AnalysisBrowserPort = {
  /** Every open tab, including ones the user's OAuth flow opened. */
  pages(): Promise<AnalysisPagePort[]>;
  /** Blocked-request and download counters recorded by the transport. */
  readonly blocked: {
    /**
     * Blocked non-GET requests that could plausibly have rendered something.
     *
     * The count that decides whether the result admits to being incomplete.
     */
    mutatingRequests: number;
    /**
     * Blocked non-GET requests that definitionally could not — beacons,
     * images, fonts. Counted, reported, and never allowed to downgrade a
     * scan: a blocked analytics beacon does not change what a page displays.
     */
    mutatingBeacons: number;
    downloads: number;
    externalNavigations: number;
  };
};

export type AnalyzeInput = {
  origin: string;
  /** Vibe's own session id — never the provider's (Sprint 5 §12). */
  sessionId: string;
  browserProvider: string;
  browser: AnalysisBrowserPort;
  repository: RepositoryIntelligenceSnapshot | null;
  publicProduct: LiveProductIntelligenceSnapshot | null;
  budgets?: AuthenticatedCrawlBudgets;
  now?: () => number;
  /** Provider session wall-clock, when known. Cost signal only. */
  browserSessionDurationMs?: number | null;
  /**
   * Where a page failure goes, other than into a sentence for the customer.
   *
   * A scan reported twenty pages unreachable and inspected one — including
   * `/privacy` and `/terms`, which are static and need nothing to render. The
   * snapshot said `A page could not be loaded.` twenty times and the reason was
   * discarded in a bare `catch`, so "the app needs POST to render", "the
   * navigation timed out" and "the browser was in a bad state" were the same
   * observation.
   *
   * A seam rather than an import: the analyzer stays a function of its inputs,
   * and the caller decides where a diagnosis goes. Nothing here reaches the
   * snapshot — provider text belongs to the operator, never to a stored row
   * (ADR 0011).
   */
  onDiagnostic?: (event: { step: string; path: string; detail: string }) => void;
  /**
   * A page was read, and how many that makes.
   *
   * The one honest source of progress this scan has. The analysis runs inside
   * a single request and reports nothing until it returns, so a founder
   * watched ninety seconds of animation that could not say whether anything
   * was happening — and the alternative on offer was a bar timed against a
   * guess, which is a percentage nobody measured.
   *
   * Called after a page is *recorded*, never before it is read: the number is
   * pages that exist in the snapshot, not pages attempted. A page that failed
   * to load moves nothing, which is correct — it taught us nothing.
   *
   * A seam rather than a write, for the same reason `onDiagnostic` is one: the
   * analyzer stays a function of its inputs, and where progress goes is the
   * caller's business.
   */
  onProgress?: (progress: { pagesInspected: number; maxPages: number }) => void;
};

export type AnalyzeResult =
  | { ok: true; snapshot: AuthenticatedProductIntelligenceSnapshot }
  | { ok: false; error: AuthenticatedAnalysisFailure };

function warning(code: AuthenticatedWarningCode, message: string, path?: string): AuthenticatedWarning {
  return path === undefined ? { code, message } : { code, message, path };
}

/**
 * Finds the tab to analyse.
 *
 * OAuth and MFA routinely leave extra tabs open — an identity provider, a
 * consent screen, a "you may close this window" page. Those are other
 * companies' properties: we neither analyse nor even read them (Sprint 5 §13).
 * The analysis target must be a top-level page already on the configured
 * origin.
 */
export async function selectAuthenticatedPage(
  browser: AnalysisBrowserPort,
  origin: string,
): Promise<{ page: AnalysisPagePort; path: string; ignoredTabCount: number } | null> {
  const pages = await browser.pages();
  let ignoredTabCount = 0;
  let match: { page: AnalysisPagePort; path: string } | null = null;

  for (const page of pages) {
    const path = toSameOriginPath(page.url(), origin);
    if (path === null) {
      ignoredTabCount += 1;
      continue;
    }
    // First same-origin tab wins; later ones are counted as ignored so the
    // snapshot can say the session had extra tabs.
    if (match === null) match = { page, path };
    else ignoredTabCount += 1;
  }

  return match === null ? null : { ...match, ignoredTabCount };
}

function confidenceFor(evidenceCount: number, pathBacked: boolean): Confidence {
  if (pathBacked && evidenceCount >= 2) return "high";
  if (pathBacked || evidenceCount >= 2) return "medium";
  return "low";
}

/** Rolls per-page surface detections up into signals with evidence. */
function buildSurfaceSignals(pages: AuthenticatedPageSummary[]): AuthenticatedSurfaceSignal[] {
  const ids = Object.keys(AUTHENTICATED_SURFACE_LABELS) as AuthenticatedSurfaceId[];

  return ids.map((id) => {
    const matching = pages.filter((page) => page.surfaces.includes(id));
    const evidence = matching.slice(0, 4).flatMap((page): AuthenticatedEvidence[] => {
      const items: AuthenticatedEvidence[] = [{ kind: "url_path", path: page.path }];
      if (page.mainHeading) {
        items.push({ kind: "heading", path: page.path, detail: page.mainHeading });
      }
      return items;
    });

    return {
      id,
      name: AUTHENTICATED_SURFACE_LABELS[id],
      detected: matching.length > 0,
      confidence: confidenceFor(evidence.length, matching.length > 0),
      evidence,
    };
  });
}

/**
 * A failure as a short string, never an object and never a stack.
 *
 * Playwright's messages carry a call log and sometimes a URL. Bounded here, and
 * scrubbed again on the way to Sentry — this is the first of three layers, not
 * the only one.
 */
function describeFailure(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 300);
  return typeof error === "string" ? error.slice(0, 300) : "non-error thrown";
}

/**
 * Whether a navigation failed because the *previous* one was still settling.
 *
 * Not a broken page. A single-page application answers `goto` as soon as the
 * document is there and then routes on its own — an auth check, a redirect to
 * a canonical path — and that late navigation aborts whatever `goto` started
 * next. A real scan lost eighteen pages in a chain to it, each one interrupted
 * by the target before it:
 *
 * ```
 * page.goto: Navigation to ".../plan" is interrupted by
 *            another navigation to ".../app"
 * ```
 *
 * The page is fine. The timing is not.
 */
function interruptedByAnotherNavigation(error: unknown): boolean {
  return error instanceof Error && /interrupted by another navigation/i.test(error.message);
}

/**
 * One navigation, retried once when the previous page interrupted it.
 *
 * Once, and only for that one cause: by the time the error is raised the
 * interrupting navigation has finished, so the second attempt starts from a
 * settled page. A retry loop would turn a genuinely unreachable page into a
 * budget spent on it, which is the failure the budgets exist to prevent.
 */
async function navigate(
  page: AnalysisPagePort,
  target: string,
  options: { timeoutMs: number; quietMs: number; settleTimeoutMs: number },
): Promise<{ status: number | null }> {
  try {
    return await page.goto(target, { timeoutMs: options.timeoutMs });
  } catch (error) {
    if (!interruptedByAnotherNavigation(error)) throw error;
    /*
     * Wait for the interrupting navigation before asking again.
     *
     * The first version of this retried immediately, and the message it
     * produced changed from "interrupted by another navigation to /app" to
     * "interrupted by another navigation to /plan" — the same URL, because the
     * second attempt was now being aborted by the tail of the first. Retrying
     * without settling is not a retry; it is the same collision one step
     * later.
     */
    await page.settle({ quietMs: options.quietMs, timeoutMs: options.settleTimeoutMs });
    return await page.goto(target, { timeoutMs: options.timeoutMs });
  }
}

export async function analyzeAuthenticatedProduct(input: AnalyzeInput): Promise<AnalyzeResult> {
  const budgets = input.budgets ?? DEFAULT_AUTHENTICATED_BUDGETS;
  const now = input.now ?? Date.now;
  const tracker = new AuthenticatedBudgetTracker(budgets, now);
  const warnings: AuthenticatedWarning[] = [];

  /*
   * Paths the live product scan already read anonymously.
   *
   * Derived here as well as inside `buildRouteCandidates`, because links
   * harvested mid-crawl never pass through that function — and links are how
   * `/privacy` and `/terms` actually reached a real scan's candidate list.
   */
  const publiclyRendered = new Set<string>();
  for (const page of input.publicProduct?.pages ?? []) {
    if (page.redirectedTo !== null) continue;
    if (page.status < 200 || page.status >= 300) continue;
    // Normalized the same way a candidate is, or the two sets would never
    // match: one holds `/privacy`, the other whatever the public snapshot
    // happened to store.
    const path = toSameOriginPath(page.path, input.origin);
    if (path !== null) publiclyRendered.add(path);
  }

  const selected = await selectAuthenticatedPage(input.browser, input.origin);
  if (selected === null) {
    // The user may still be mid-login, or logged into the wrong origin. This is
    // recoverable: the caller keeps them in the login step.
    return { ok: false, error: "authenticated_origin_not_reached" };
  }

  const { page, path: landingPath, ignoredTabCount } = selected;
  if (ignoredTabCount > 0) {
    warnings.push(
      warning("extra_tab_ignored", `${ignoredTabCount} tab(s) on other origins were ignored.`),
    );
  }

  let candidates = buildRouteCandidates({
    origin: input.origin,
    landingPath,
    repository: input.repository,
    publicProduct: input.publicProduct,
    budgets,
  });

  const pages: AuthenticatedPageSummary[] = [];
  const visited = new Set<string>();
  /*
   * How many pages each route template has already spent, and which templates
   * had more instances than the budget inspects. The second is a warning, not
   * a failure: skipping a repeat is the budget working, and the founder is
   * told the product has more of a screen than Vibe looked at.
   */
  const shapeVisits = new Map<string, number>();
  const repeatedScreens = new Set<string>();
  const candidateSources: Record<RouteCandidateSource, number> = {
    landing: 0,
    repository_route: 0,
    public_protected_redirect: 0,
    authenticated_link: 0,
  };
  for (const candidate of candidates) candidateSources[candidate.source] += 1;

  let navigationCount = 0;
  let maxDepthReached = 0;

  while (candidates.length > 0) {
    if (!tracker.canInspectPage()) {
      warnings.push(warning("budget_reached", "The page budget was reached before every candidate was inspected."));
      break;
    }

    const candidate = candidates.shift()!;
    if (visited.has(candidate.path)) continue;

    /*
     * A screen is worth a page; the same screen with different rows is not.
     *
     * `/app/projects/<a>/settings` and `/app/projects/<b>/settings` are one
     * template. The first run that read pages properly spent all 25 on four
     * copies of a project workspace's seven tabs, and then reported
     * `integrations` and `onboarding` as absent — it had never reached
     * `/app/connect/github` or `/app/onboarding`, because seventeen of its
     * pages went on repetitions.
     *
     * Checked before the navigation, so a skipped repeat costs nothing at all,
     * and counted on *inspected* pages rather than on candidates: a page that
     * failed to load taught us nothing and must not hold a slot.
     */
    const shape = routeShape(candidate.path);
    if ((shapeVisits.get(shape) ?? 0) >= budgets.maxPagesPerRouteShape) {
      repeatedScreens.add(shape);
      continue;
    }

    visited.add(candidate.path);

    const target = `${new URL(input.origin).origin}${candidate.path}`;
    // Belt and braces: the candidate list is already origin-filtered, but the
    // final gate before a real navigation is checked again here.
    if (!isSafeAnalysisTarget(target, input.origin)) {
      warnings.push(warning("origin_mismatch_skipped", "A candidate failed origin validation.", candidate.path));
      continue;
    }

    let status: number | null = null;
    // The landing page is already open; navigating to it again would be a
    // pointless round trip and could re-trigger its side effects.
    if (!(candidate.source === "landing" && navigationCount === 0)) {
      try {
        navigationCount += 1;
        status = (
          await navigate(page, target, {
            timeoutMs: tracker.remainingNavigationTimeoutMs,
            quietMs: budgets.settleQuietMs,
            settleTimeoutMs: budgets.settleTimeoutMs,
          })
        ).status;
      } catch (error) {
        tracker.note("navigation_failed");
        warnings.push(warning("page_unreachable", "A page could not be loaded.", candidate.path));
        input.onDiagnostic?.({
          step: "navigate",
          path: candidate.path,
          detail: describeFailure(error),
        });
        continue;
      }
    }

    /*
     * Let the page finish arriving before anything is read from it.
     *
     * This is the line the whole scan was missing. Without it the loop read a
     * page mid-boot and then navigated away mid-boot, so a run inspected one
     * page of sixteen and every other failure named the page before it —
     * "Execution context was destroyed" for the read, "interrupted by another
     * navigation" for the next hop. Both are the same missing wait.
     *
     * It also decides *where* we think we are: an application that redirects
     * itself after `goto` returns has not finished choosing its URL yet, so
     * reading `page.url()` before this settles records the wrong path.
     */
    await page.settle({ quietMs: budgets.settleQuietMs, timeoutMs: budgets.settleTimeoutMs });

    // After navigating, confirm we are still where we think we are: a redirect
    // to an identity provider or a marketing site must not be analysed.
    const landedPath = toSameOriginPath(page.url(), input.origin);
    if (landedPath === null) {
      tracker.note("external_navigation_blocked");
      warnings.push(
        warning("external_navigation_blocked", "A navigation left the product's origin and was not analysed.", candidate.path),
      );
      continue;
    }

    // `visited` was keyed on the *candidate* path, but a navigation can land
    // somewhere else — and the summary below records where we landed. Without
    // this, a redirect leaves the landed path unmarked, so a later candidate
    // for that same path is inspected a second time: a duplicate entry, a
    // wasted page from the budget, and the same evidence counted twice.
    //
    // Found on the first real Deep Scan, which inspected
    // /app/connect/github/repositories twice — once via a link (200) and once
    // as a repository route (404).
    if (landedPath !== candidate.path) {
      if (visited.has(landedPath)) {
        /*
         * Said, not swallowed.
         *
         * A real scan reported `onboarding` as **not detected** with no
         * evidence. `/app/onboarding` exists, was a candidate, and was
         * navigated to — and it redirected to the dashboard, because the
         * founder is long past onboarding. The loop dropped it here without a
         * trace, so the snapshot's only account of it was an absence.
         *
         * "This surface sent Vibe somewhere it had already been" is a fact
         * about the product. "Vibe found no onboarding" is not the same
         * sentence, and reading the first as the second is how a scan comes to
         * report a budget as a finding (rule 44).
         */
        warnings.push(
          warning(
            "redirected_to_seen_page",
            "This path redirected to a page Vibe had already inspected, so it added no new evidence.",
            candidate.path,
          ),
        );
        continue;
      }
      visited.add(landedPath);
    }

    let raw: RawPageExtraction;
    try {
      raw = await page.extract();
    } catch (error) {
      input.onDiagnostic?.({
        step: "extract",
        path: candidate.path,
        detail: describeFailure(error),
      });
      warnings.push(warning("page_unreachable", "A page could not be inspected.", candidate.path));
      continue;
    }

    const summary = sanitizePageExtraction(raw, {
      path: landedPath,
      source: candidate.source,
      status,
      depth: candidate.depth,
      budgets,
    });

    pages.push(summary);
    // Counted on the landed path, because that is the page that was read.
    const landedShape = routeShape(landedPath);
    shapeVisits.set(landedShape, (shapeVisits.get(landedShape) ?? 0) + 1);
    tracker.recordPage();
    input.onProgress?.({ pagesInspected: pages.length, maxPages: budgets.maxPages });
    maxDepthReached = Math.max(maxDepthReached, candidate.depth);

    if (candidate.depth < budgets.maxDepth) {
      const discovered = extendCandidates(
        [...candidates, ...pages.map((entry) => ({ path: entry.path, source: entry.source, depth: entry.depth, priority: 0 }))],
        readSameOriginLinks(raw),
        { origin: input.origin, depth: candidate.depth + 1, budgets, publiclyRendered },
      );
      for (const entry of discovered) {
        if (!tracker.acceptCandidate()) break;
        candidateSources[entry.source] += 1;
        candidates.push(entry);
      }
      candidates = sortCandidates(candidates);
    }
  }

  if (pages.length === 0) {
    return { ok: false, error: "analysis_failed" };
  }

  if (repeatedScreens.size > 0) {
    /*
     * Said once, with a count, and never as a failure. The founder should know
     * their product has more instances of a screen than Vibe looked at — that
     * is a fact about the product — without a warning per skipped page turning
     * a working budget into a list of complaints.
     */
    warnings.push(
      warning(
        "repeated_screen_skipped",
        `${repeatedScreens.size} screen(s) exist in more copies than Vibe inspected. Each was read up to ${budgets.maxPagesPerRouteShape} time(s).`,
      ),
    );
  }

  const blocked = input.browser.blocked;
  const refused = blocked.mutatingRequests + blocked.mutatingBeacons;
  if (refused > 0) {
    warnings.push(
      warning(
        "non_get_request_blocked",
        `${refused} non-GET request(s) were blocked during analysis; ${blocked.mutatingBeacons} of them were beacons or media that cannot affect a page.`,
      ),
    );
  }
  if (blocked.mutatingRequests > 0) {
    /*
     * Said plainly rather than implied: if the app needed those requests to
     * render, what we saw is incomplete and the result must not claim
     * otherwise.
     *
     * But only for requests that could have. A scan of 21 pages reported 53
     * blocked non-GET requests and downgraded itself on all of them, when most
     * were analytics beacons fired once per page view. Blocking is unchanged —
     * every non-GET is still refused — and what changed is only what Vibe
     * concludes from having refused it.
     */
    warnings.push(
      warning(
        "application_requires_mutating_method_for_render",
        "Parts of this application may render via non-GET requests, which were blocked. Some surfaces may be incomplete.",
      ),
    );
    tracker.note("mutation_blocked");
  }
  if (blocked.downloads > 0) {
    warnings.push(warning("download_blocked", `${blocked.downloads} download(s) were blocked.`));
  }
  if (blocked.externalNavigations > 0) {
    warnings.push(
      warning("external_navigation_blocked", `${blocked.externalNavigations} navigation(s) off-origin were blocked.`),
    );
    tracker.note("external_navigation_blocked");
  }

  const navLabels = [...new Set(pages.flatMap((page) => page.navLabels))].slice(0, 24);
  const surfaces = buildSurfaceSignals(pages);
  const detected = (id: AuthenticatedSurfaceId): boolean =>
    surfaces.find((surface) => surface.id === id)?.detected ?? false;

  const snapshot: AuthenticatedProductIntelligenceSnapshot = {
    schemaVersion: AUTHENTICATED_PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
    source: {
      origin: new URL(input.origin).origin,
      analyzerVersion: AUTHENTICATED_PRODUCT_ANALYZER_VERSION,
      browserProvider: input.browserProvider,
      analyzedAt: new Date(now()).toISOString(),
    },
    session: { sessionId: input.sessionId, landingPath, ignoredTabCount },
    crawl: {
      pagesInspected: pages.length,
      candidatesConsidered: tracker.stats.candidatesConsidered + Object.values(candidateSources).reduce((a, b) => a + b, 0),
      maxDepthReached,
      candidateSources,
    },
    pages,
    productSurfaces: surfaces,
    navigation: { labels: navLabels, paths: pages.map((page) => page.path) },
    applicationSignals: {
      appShellPresent: detected("app_shell"),
      authenticatedAreaReached: true,
      reachableSurfaceCount: pages.length,
      dataTablePresent: detected("data_table"),
      emptyStatePresent: detected("empty_state"),
      settingsPresent: detected("settings"),
      billingPresent: detected("billing"),
      onboardingPresent: detected("onboarding"),
    },
    metrics: {
      pagesInspected: pages.length,
      navigationCount,
      durationMs: tracker.stats.durationMs,
      browserSessionDurationMs: input.browserSessionDurationMs ?? null,
    },
    completeness: { status: tracker.completeness, reasons: tracker.completenessReasons },
    warnings,
  };

  return { ok: true, snapshot };
}
