import { buildBrandSignals } from "./brand";
import type { CrawlBudgets } from "./budgets";
import { crawlSite, type CrawlFailure } from "./crawler";
import { LiveProductDomainError } from "./errors";
import type { SafeFetchDependencies } from "./net/safe-fetch";
import {
  LIVE_PRODUCT_ANALYZER_VERSION,
  LIVE_PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
  type LiveProductIntelligenceSnapshot,
  type LiveEvidence,
  type LiveWarning,
  type ProductSurfaceSignal,
} from "./schema";
import {
  buildConversionSignals,
  buildPricingSignals,
  buildPageSummaries,
  buildReadability,
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
  const { surfaces, fetchedSurfaces, perPageSurfaces } = buildProductSurfaces({
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
  const pages = buildPageSummaries(outcome.pages, perPageSurfaces);
  const readability = buildReadability(pages);

  // A page that renders in the browser was reached and read successfully, and
  // still yielded nothing. Every zero below it — no headings, no calls to
  // action, no pricing — would otherwise be persisted as a fact about the
  // product rather than as the limit of a reader that runs no browser.
  if (readability.clientRendered > 0) outcome.tracker.note("client_rendered");

  const pricing = buildPricingSignals({
    pages: outcome.pages,
    /*
     * Read, not inferred.
     *
     * This used to ask the merged `detected` flag, whose docblock said the
     * surface detector "already decided this" — but `detected` is also true for
     * a surface Vibe only saw a *link* to, so a footer link to `/pricing` was
     * enough to make this say the page had been read. The audit turns that into
     * "Your pricing page was read and states no machine-readable price", a
     * sentence about a document nobody opened.
     *
     * The two facts are genuinely separate, and the Move of 2026-09-02 collapsed
     * them: a site can show its prices without having a pricing page, and that
     * is the ordinary shape of a one-page marketing site.
     */
    pricingPageReached: fetchedSurfaces.has("pricing"),
  });

  const reconciled = reconcilePricingConfidence(surfaces, pricing);

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
    pages,
    readability,
    productSurfaces: reconciled,
    seoSignals: buildSeoSignals({
      homepage,
      pages: outcome.pages,
      robotsTxtPresent: outcome.robots.exists,
      sitemapPresent: outcome.sitemapPresent,
    }),
    conversionSignals: buildConversionSignals({
      pages: outcome.pages,
      discoveredPaths: outcome.discoveredPaths,
    }),
    pricing,
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

/**
 * A crawl may not be confidently certain of what the same crawl just found.
 *
 * ## The failure this exists for
 *
 * On 2026-09-02 one snapshot reported, of one page, both of these:
 *
 * ```
 * pricing.observedPricePoints   €0, €19 and €49, all found on "/"
 * productSurfaces.pricing       detected: false, evidence: [], confidence: "high"
 * ```
 *
 * The "high" is not a bug in isolation — `buildProductSurfaces` gives an
 * undetected surface high confidence because it did look and did not find one.
 * It becomes one when another part of the same snapshot found the thing. That
 * contradiction left this module intact, became "Vibe could not identify a
 * pricing path" in `product-understanding`, and reached a founder as a Move
 * asserting no visitor could see a price on a page that was showing three.
 *
 * ## Why it lowers confidence rather than flipping the answer
 *
 * Because `detected: false` is still the honest answer to the question this
 * detector asks: no pricing *surface* was identified. Flipping it would be the
 * opposite lie, and it would make `pricingPageReached` claim a page was read.
 *
 * What is not honest is the certainty. So the finding is recorded as evidence
 * and the confidence drops to "low", which is where a person looking at the
 * snapshot sees that the detector has a gap — one layer from the cause, instead
 * of four layers away as somebody's wrong Move.
 *
 * Anchor sections are handled properly upstream by `classifyInPageAnchor`; this
 * is the net under the next shape nobody anticipated.
 */
function reconcilePricingConfidence(
  surfaces: ProductSurfaceSignal[],
  pricing: NonNullable<LiveProductIntelligenceSnapshot["pricing"]>,
): ProductSurfaceSignal[] {
  const found: { path: string }[] = [
    ...pricing.declaredPricePoints,
    ...pricing.observedPricePoints,
  ];
  if (found.length === 0) return surfaces;

  return surfaces.map((surface): ProductSurfaceSignal => {
    if (surface.id !== "pricing" || surface.detected) return surface;

    const note: LiveEvidence = {
      kind: "url_path",
      path: found[0].path,
      detail: `${found.length} price(s) read on this page with no pricing surface identified`,
    };

    return {
      ...surface,
      confidence: "low",
      evidence: [...surface.evidence, note].slice(0, 8),
    };
  });
}
