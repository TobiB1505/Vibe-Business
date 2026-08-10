import { CrawlBudgetTracker, type CrawlBudgets, DEFAULT_CRAWL_BUDGETS } from "./budgets";
import { classifyLinkTarget } from "./classifier";
import { parseHtml, type ParsedHtml } from "./html";
import { safeFetch, type SafeFetchDependencies, type SafeFetchResult } from "./net/safe-fetch";
import { EMPTY_ROBOTS_POLICY, isPathAllowed, parseRobots, type RobotsPolicy } from "./robots";
import { parseSitemap } from "./sitemap";
import type { LiveWarning, ProductSurfaceId } from "./schema";
import { looksLikeNonPageAsset, normalizePathname, resolveLink } from "./url";

/**
 * Same-origin site discovery (Sprint 3 §7, §8).
 *
 * Vibe Business is not a general crawler. The frontier only ever contains
 * URLs on the one origin being analysed, every fetch goes through
 * `safeFetch`, and the whole run is bounded by the budgets in
 * `budgets.ts`. Hitting a budget stops the crawl and marks the result
 * partial — it never fails an analysis that already learned something.
 *
 * Order matters when the page budget is a dozen: the frontier is
 * prioritised so pricing, login, signup and contact are visited before
 * the ninth blog post. Ordering is deterministic, so the same site
 * produces the same crawl.
 */

export type FetchedPage = {
  /** Pathname requested, before any redirect. */
  requestedPath: string;
  /** Pathname actually served. Differs when redirected, e.g. /app → /login. */
  finalPath: string;
  status: number;
  html: ParsedHtml;
  bytes: number;
  depth: number;
  redirected: boolean;
};

export type CrawlResult = {
  effectiveOrigin: string;
  /** True when the configured URL redirected to a different origin. */
  redirectedFromConfigured: boolean;
  pages: FetchedPage[];
  robots: RobotsPolicy;
  sitemapPresent: boolean;
  sitemapUrlsConsidered: number;
  pagesDiscovered: number;
  maxDepthReached: number;
  redirectsFollowed: number;
  /** Same-origin paths seen as links but never fetched — still evidence a surface exists. */
  discoveredPaths: string[];
  warnings: LiveWarning[];
  tracker: CrawlBudgetTracker;
};

export type CrawlFailure = {
  ok: false;
  error: "homepage_unreachable" | "unsafe_destination" | "dns_resolution_failed" | "tls_error" | "site_rate_limited" | "site_forbidden" | "too_many_redirects";
};

export type CrawlOutcome = ({ ok: true } & CrawlResult) | CrawlFailure;

/** Surfaces worth spending a limited page budget on before anything else. */
const SURFACE_PRIORITY: Partial<Record<ProductSurfaceId, number>> = {
  pricing: 10,
  signup: 9,
  login: 9,
  checkout_billing: 8,
  contact: 7,
  dashboard_app: 7,
  onboarding: 6,
  docs_help: 4,
  privacy: 3,
  terms: 3,
  blog_content: 2,
};

type FrontierEntry = { url: URL; depth: number; priority: number; key: string };

function priorityFor(pathname: string): number {
  const surface = classifyLinkTarget(pathname);
  if (surface === null) return 1;
  return SURFACE_PRIORITY[surface] ?? 1;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Maps a safeFetch failure onto the crawl-level failure vocabulary. */
function toCrawlFailure(result: Exclude<SafeFetchResult, { ok: true }>): CrawlFailure {
  switch (result.error) {
    case "unsafe_destination":
      return { ok: false, error: "unsafe_destination" };
    case "dns_resolution_failed":
      return { ok: false, error: "dns_resolution_failed" };
    case "tls_error":
      return { ok: false, error: "tls_error" };
    case "site_rate_limited":
      return { ok: false, error: "site_rate_limited" };
    case "site_forbidden":
      return { ok: false, error: "site_forbidden" };
    case "too_many_redirects":
      return { ok: false, error: "too_many_redirects" };
    default:
      return { ok: false, error: "homepage_unreachable" };
  }
}

export type CrawlOptions = {
  budgets?: CrawlBudgets;
};

export async function crawlSite(
  configuredUrl: string,
  dependencies: SafeFetchDependencies,
  options: CrawlOptions = {},
): Promise<CrawlOutcome> {
  const budgets = options.budgets ?? DEFAULT_CRAWL_BUDGETS;
  const tracker = new CrawlBudgetTracker(budgets);
  const warnings: LiveWarning[] = [];

  const configured = new URL(configuredUrl);

  // ---------------------------------------------------------------
  // Homepage. Fetched without an origin restriction so a legitimate
  // example.com → www.example.com redirect is followed and adopted; every
  // hop is still SSRF-validated independently.
  // ---------------------------------------------------------------
  const homepageResult = await safeFetch(
    configured,
    {
      accept: ["html"],
      maxBytes: tracker.remainingBytesPerPage,
      timeoutMs: tracker.remainingRequestTimeoutMs,
      maxRedirects: budgets.maxRedirects,
    },
    dependencies,
  );

  if (!homepageResult.ok) return toCrawlFailure(homepageResult);

  const effectiveOrigin = homepageResult.url.origin;
  const redirectedFromConfigured = effectiveOrigin !== configured.origin;
  let redirectsFollowed = homepageResult.redirectChain.length;

  tracker.recordRequest(homepageResult.bytesRead);
  tracker.recordPage();
  if (homepageResult.truncated) tracker.note("byte_budget_reached");

  const homepageHtml = parseHtml(homepageResult.body);
  const pages: FetchedPage[] = [
    {
      requestedPath: normalizePathname(configured.pathname),
      finalPath: normalizePathname(homepageResult.url.pathname),
      status: homepageResult.status,
      html: homepageHtml,
      bytes: homepageResult.bytesRead,
      depth: 0,
      redirected: homepageResult.redirectChain.length > 0,
    },
  ];

  // ---------------------------------------------------------------
  // robots.txt, from the origin actually being crawled.
  // ---------------------------------------------------------------
  let robots: RobotsPolicy = EMPTY_ROBOTS_POLICY;
  const robotsResult = await safeFetch(
    new URL("/robots.txt", effectiveOrigin),
    {
      accept: ["text", "html"],
      maxBytes: budgets.maxRobotsBytes,
      timeoutMs: tracker.remainingRequestTimeoutMs,
      maxRedirects: 1,
      restrictToOrigin: effectiveOrigin,
    },
    dependencies,
  );

  if (robotsResult.ok) {
    tracker.recordRequest(robotsResult.bytesRead);
    robots = parseRobots(robotsResult.body);
  }

  if (robots.blanketDisallow) {
    // The site tells crawlers to stay out. We stop after the homepage the
    // user explicitly pointed us at, and say so plainly.
    tracker.note("robots_disallowed");
    warnings.push({
      code: "robots_disallowed",
      message:
        "robots.txt disallows automated crawlers for this site, so only the homepage was inspected. Allow VibeBusinessBot in robots.txt to inspect more pages.",
      path: "/robots.txt",
    });

    return {
      ok: true,
      effectiveOrigin,
      redirectedFromConfigured,
      pages,
      robots,
      sitemapPresent: robots.sitemaps.length > 0,
      sitemapUrlsConsidered: 0,
      pagesDiscovered: 1,
      maxDepthReached: 0,
      redirectsFollowed,
      discoveredPaths: [],
      warnings,
      tracker,
    };
  }

  const crawlDelayMs =
    robots.crawlDelaySeconds === null ? 0 : Math.min(robots.crawlDelaySeconds * 1000, 2000);

  // ---------------------------------------------------------------
  // Frontier: homepage links first, then sitemap URLs as extra hints.
  // ---------------------------------------------------------------
  const visited = new Set<string>([`${effectiveOrigin}${pages[0].finalPath}`]);
  const queued = new Set<string>(visited);
  const frontier: FrontierEntry[] = [];
  const discoveredPaths = new Set<string>();

  const enqueue = (rawHref: string, base: URL, depth: number) => {
    const resolved = resolveLink(rawHref, base);
    if (!resolved.ok) return;
    if (resolved.url.origin !== effectiveOrigin) return; // external domains are never followed
    if (looksLikeNonPageAsset(resolved.url.pathname)) return;

    discoveredPaths.add(resolved.url.pathname);

    // Dedup before the depth check: a link back to a page we already have
    // is not something the depth limit prevented us from seeing, and
    // counting it would report a complete crawl as partial.
    if (queued.has(resolved.key)) return;

    if (!isPathAllowed(robots, resolved.url.pathname)) {
      tracker.note("robots_disallowed");
      return;
    }

    if (depth > budgets.maxDepth) {
      tracker.note("crawl_depth_reached");
      return;
    }

    queued.add(resolved.key);
    frontier.push({
      url: resolved.url,
      depth,
      priority: priorityFor(resolved.url.pathname),
      key: resolved.key,
    });
  };

  const homepageBase = homepageResult.url;
  const homepageLinks = homepageHtml.links.slice(0, budgets.maxLinksPerPage);
  if (homepageHtml.links.length > budgets.maxLinksPerPage) tracker.note("link_budget_reached");
  for (const link of homepageLinks) enqueue(link.href, homepageBase, 1);

  // ---------------------------------------------------------------
  // Sitemap discovery — hints only, subject to every rule above.
  // ---------------------------------------------------------------
  let sitemapPresent = false;
  let sitemapUrlsConsidered = 0;

  const sitemapCandidates =
    robots.sitemaps.length > 0 ? robots.sitemaps.slice(0, 2) : [new URL("/sitemap.xml", effectiveOrigin).toString()];

  for (const candidate of sitemapCandidates) {
    if (tracker.expired) break;

    let sitemapUrl: URL;
    try {
      sitemapUrl = new URL(candidate, effectiveOrigin);
    } catch {
      continue;
    }
    if (sitemapUrl.origin !== effectiveOrigin) continue;

    const sitemapResult = await safeFetch(
      sitemapUrl,
      {
        accept: ["xml", "text"],
        maxBytes: budgets.maxSitemapBytes,
        timeoutMs: tracker.remainingRequestTimeoutMs,
        maxRedirects: 1,
        restrictToOrigin: effectiveOrigin,
      },
      dependencies,
    );

    if (!sitemapResult.ok) continue;

    tracker.recordRequest(sitemapResult.bytesRead);
    sitemapPresent = true;

    const document = parseSitemap(sitemapResult.body, budgets.maxSitemapUrls);
    if (document.truncated) tracker.note("sitemap_budget_reached");

    // A sitemap index is read one level deep only — never recursively
    // (Sprint 3 §11). A child that is itself an index ends the descent:
    // its entries are sitemaps, not pages, and following them is exactly
    // how a crawler ends up consuming a giant sitemap network.
    if (document.kind === "sitemapindex") {
      const child = document.urls[0];
      if (child === undefined) continue;
      let childUrl: URL;
      try {
        childUrl = new URL(child, effectiveOrigin);
      } catch {
        continue;
      }
      if (childUrl.origin !== effectiveOrigin) continue;

      const childResult = await safeFetch(
        childUrl,
        {
          accept: ["xml", "text"],
          maxBytes: budgets.maxSitemapBytes,
          timeoutMs: tracker.remainingRequestTimeoutMs,
          maxRedirects: 1,
          restrictToOrigin: effectiveOrigin,
        },
        dependencies,
      );
      if (!childResult.ok) continue;
      tracker.recordRequest(childResult.bytesRead);

      const childDocument = parseSitemap(childResult.body, budgets.maxSitemapUrls);
      if (childDocument.kind === "sitemapindex") {
        tracker.note("sitemap_budget_reached");
        continue;
      }
      sitemapUrlsConsidered += childDocument.urls.length;
      for (const url of childDocument.urls) enqueue(url, homepageBase, 1);
      continue;
    }

    if (document.kind !== "urlset") continue;

    sitemapUrlsConsidered += document.urls.length;
    for (const url of document.urls) enqueue(url, homepageBase, 1);
  }

  // ---------------------------------------------------------------
  // Bounded breadth-first crawl.
  // ---------------------------------------------------------------
  let maxDepthReached = 0;

  const fetchOne = async (entry: FrontierEntry): Promise<void> => {
    const result = await safeFetch(
      entry.url,
      {
        accept: ["html"],
        maxBytes: tracker.remainingBytesPerPage,
        timeoutMs: tracker.remainingRequestTimeoutMs,
        maxRedirects: budgets.maxRedirects,
        // In-crawl pages must stay on the origin; a redirect off-origin is
        // recorded as "not ours" rather than followed (Sprint 3 §7).
        restrictToOrigin: effectiveOrigin,
      },
      dependencies,
    );

    if (!result.ok) {
      if (result.error === "site_rate_limited") tracker.note("rate_limited");
      else if (result.error === "unsupported_content_type") return;
      else if (result.error !== "redirect_off_origin") tracker.note("fetch_failed");

      if (result.error === "site_rate_limited") {
        warnings.push({
          code: "rate_limited",
          message: "The site rate-limited our requests, so fewer pages were inspected.",
          path: entry.url.pathname,
        });
      }
      return;
    }

    tracker.recordRequest(result.bytesRead);
    tracker.recordPage();
    if (result.truncated) tracker.note("byte_budget_reached");

    redirectsFollowed += result.redirectChain.length;
    const finalPath = normalizePathname(result.url.pathname);
    visited.add(`${effectiveOrigin}${finalPath}`);
    maxDepthReached = Math.max(maxDepthReached, entry.depth);

    const html = parseHtml(result.body);
    pages.push({
      requestedPath: normalizePathname(entry.url.pathname),
      finalPath,
      status: result.status,
      html,
      bytes: result.bytesRead,
      depth: entry.depth,
      redirected: result.redirectChain.length > 0,
    });

    const links = html.links.slice(0, budgets.maxLinksPerPage);
    if (html.links.length > budgets.maxLinksPerPage) tracker.note("link_budget_reached");
    for (const link of links) enqueue(link.href, result.url, entry.depth + 1);
  };

  while (frontier.length > 0) {
    if (!tracker.canFetchPage()) break;

    // Re-sorted each round because newly discovered high-value pages
    // should overtake low-value ones already queued.
    frontier.sort((a, b) => b.priority - a.priority || a.depth - b.depth || a.key.localeCompare(b.key));

    const remainingPages = budgets.maxPages - tracker.stats.pagesFetched;
    const concurrency = crawlDelayMs > 0 ? 1 : budgets.maxConcurrency;
    const batch = frontier.splice(0, Math.max(1, Math.min(concurrency, remainingPages)));
    if (batch.length === 0) break;

    for (const entry of batch) visited.add(entry.key);
    await Promise.all(batch.map(fetchOne));

    // Honour Crawl-delay by pacing, capped so a hostile or careless value
    // cannot stall the request. No background retries are involved.
    if (crawlDelayMs > 0 && frontier.length > 0 && !tracker.expired) {
      await sleep(crawlDelayMs);
    }
  }

  if (frontier.length > 0) tracker.note("page_budget_reached");

  return {
    ok: true,
    effectiveOrigin,
    redirectedFromConfigured,
    pages,
    robots,
    sitemapPresent,
    sitemapUrlsConsidered,
    pagesDiscovered: queued.size,
    maxDepthReached,
    redirectsFollowed,
    discoveredPaths: [...discoveredPaths].sort(),
    warnings,
    tracker,
  };
}
