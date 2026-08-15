import { buildBrandSignals } from "./brand";
import type { CrawlBudgets } from "./budgets";
import { crawlSite, type CrawlFailure } from "./crawler";
import { LiveProductDomainError } from "./errors";
import type { SafeFetchDependencies } from "./net/safe-fetch";
import {
  LIVE_PRODUCT_ANALYZER_VERSION,
  LIVE_PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
  type LiveProductIntelligenceSnapshot,
  type LiveWarning,
} from "./schema";
import {
  buildConversionSignals,
  buildPageSummaries,
  buildProductSurfaces,
  buildSeoSignals,
  buildSiteMetadata,
} from "./signals";

/**
 * Deterministic live-product analysis pipeline (Sprint 3 §33):
 *
 *   safe url → safe fetch → site discovery → html parse
 *            → page classify → signal aggregate → snapshot
 *
 * Every stage after the crawl is a pure function over plain data, so the
 * whole thing is testable with a fake transport and fake DNS — CI never
 * touches the internet (Sprint 3 §34).
 *
 * No AI is involved anywhere in this path (Sprint 3 §38), and no page
 * content is executed or interpreted as instructions (Sprint 3 §12).
 */

export type AnalyzeLiveProductInput = {
  /** Already normalized by `normalizeProductionUrl`. */
  configuredUrl: string;
  dependencies: SafeFetchDependencies;
  budgets?: CrawlBudgets;
};

/** Crawl-level failures are surfaced as typed domain errors for the service layer. */
function toDomainError(failure: CrawlFailure): LiveProductDomainError {
  switch (failure.error) {
    case "unsafe_destination":
      return new LiveProductDomainError("unsafe_destination");
    case "dns_resolution_failed":
      return new LiveProductDomainError("dns_resolution_failed");
    case "tls_error":
      return new LiveProductDomainError("tls_error");
    case "site_rate_limited":
      return new LiveProductDomainError("site_rate_limited");
    case "site_forbidden":
      return new LiveProductDomainError("site_forbidden");
    case "too_many_redirects":
      return new LiveProductDomainError("too_many_redirects");
    default:
      return new LiveProductDomainError("homepage_unreachable");
  }
}

export async function analyzeLiveProduct(
  input: AnalyzeLiveProductInput,
): Promise<LiveProductIntelligenceSnapshot> {
  const outcome = await crawlSite(input.configuredUrl, input.dependencies, { budgets: input.budgets });

  if (!outcome.ok) throw toDomainError(outcome);

  const warnings: LiveWarning[] = [...outcome.warnings];

  const homepage = outcome.pages.find((page) => page.depth === 0);
  const { surfaces, perPageSurfaces } = buildProductSurfaces({
    pages: outcome.pages,
    discoveredPaths: outcome.discoveredPaths,
  });

  if (outcome.redirectedFromConfigured) {
    warnings.push({
      code: "origin_redirected",
      message: `The configured URL redirected to ${outcome.effectiveOrigin}, which was analysed instead.`,
    });
  }

  const stats = outcome.tracker.stats;

  return {
    schemaVersion: LIVE_PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
    source: {
      configuredUrl: input.configuredUrl,
      effectiveOrigin: outcome.effectiveOrigin,
      analyzerVersion: LIVE_PRODUCT_ANALYZER_VERSION,
      redirected: outcome.redirectedFromConfigured,
      analyzedAt: new Date().toISOString(),
    },
    crawl: {
      pagesInspected: outcome.pages.length,
      pagesDiscovered: outcome.pagesDiscovered,
      maxDepthReached: outcome.maxDepthReached,
      robotsTxtPresent: outcome.robots.exists,
      robotsRespected: true,
      sitemapPresent: outcome.sitemapPresent,
      sitemapUrlsConsidered: outcome.sitemapUrlsConsidered,
      redirectsFollowed: outcome.redirectsFollowed,
    },
    siteMetadata: buildSiteMetadata(homepage),
    pages: buildPageSummaries(outcome.pages, perPageSurfaces),
    productSurfaces: surfaces,
    seoSignals: buildSeoSignals({
      homepage,
      robotsTxtPresent: outcome.robots.exists,
      sitemapPresent: outcome.sitemapPresent,
    }),
    conversionSignals: buildConversionSignals({
      pages: outcome.pages,
      discoveredPaths: outcome.discoveredPaths,
    }),
    brandSignals: buildBrandSignals({ homepage, effectiveOrigin: outcome.effectiveOrigin }),
    metrics: {
      pagesFetched: stats.pagesFetched,
      bytesFetched: stats.bytesFetched,
      requestCount: stats.requestCount,
      durationMs: stats.durationMs,
    },
    completeness: {
      status: outcome.tracker.completeness,
      reasons: outcome.tracker.completenessReasons,
    },
    warnings,
  };
}
