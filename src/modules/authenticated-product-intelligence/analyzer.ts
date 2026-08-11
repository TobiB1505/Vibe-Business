import { AuthenticatedBudgetTracker, DEFAULT_AUTHENTICATED_BUDGETS, type AuthenticatedCrawlBudgets } from "./budgets";
import type { AuthenticatedAnalysisFailure, AuthenticatedWarningCode } from "./errors";
import { readSameOriginLinks, sanitizePageExtraction, type RawPageExtraction } from "./extract";
import {
  buildRouteCandidates,
  extendCandidates,
  isSafeAnalysisTarget,
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
  /** Runs the extraction script in the page. */
  extract(): Promise<RawPageExtraction>;
};

export type AnalysisBrowserPort = {
  /** Every open tab, including ones the user's OAuth flow opened. */
  pages(): Promise<AnalysisPagePort[]>;
  /** Blocked-request and download counters recorded by the transport. */
  readonly blocked: { mutatingRequests: number; downloads: number; externalNavigations: number };
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

export async function analyzeAuthenticatedProduct(input: AnalyzeInput): Promise<AnalyzeResult> {
  const budgets = input.budgets ?? DEFAULT_AUTHENTICATED_BUDGETS;
  const now = input.now ?? Date.now;
  const tracker = new AuthenticatedBudgetTracker(budgets, now);
  const warnings: AuthenticatedWarning[] = [];

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
        const result = await page.goto(target, { timeoutMs: tracker.remainingNavigationTimeoutMs });
        status = result.status;
      } catch {
        tracker.note("navigation_failed");
        warnings.push(warning("page_unreachable", "A page could not be loaded.", candidate.path));
        continue;
      }
    }

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

    let raw: RawPageExtraction;
    try {
      raw = await page.extract();
    } catch {
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
    tracker.recordPage();
    maxDepthReached = Math.max(maxDepthReached, candidate.depth);

    if (candidate.depth < budgets.maxDepth) {
      const discovered = extendCandidates(
        [...candidates, ...pages.map((entry) => ({ path: entry.path, source: entry.source, depth: entry.depth, priority: 0 }))],
        readSameOriginLinks(raw),
        { origin: input.origin, depth: candidate.depth + 1, budgets },
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

  const blocked = input.browser.blocked;
  if (blocked.mutatingRequests > 0) {
    warnings.push(
      warning(
        "non_get_request_blocked",
        `${blocked.mutatingRequests} non-GET request(s) were blocked during analysis.`,
      ),
    );
    // Said plainly rather than implied: if the app needed those requests to
    // render, what we saw is incomplete and the result must not claim otherwise.
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
