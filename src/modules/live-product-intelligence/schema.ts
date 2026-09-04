import type { CrawlCompleteness, CrawlCompletenessReason } from "./budgets";

/**
 * Versioned Live Product Intelligence schema (Sprint 3 §14).
 *
 * The counterpart to the repository snapshot: that one describes what the
 * code contains, this one describes what a visitor actually sees. They
 * stay separate on purpose (Sprint 3 §24) — a future Business Audit
 * consumes both, and merging them now would destroy the ability to say
 * "the code has a pricing route but the live site does not serve one".
 *
 * Two rules keep this payload safe to store:
 *
 *  1. No raw page content. Only derived facts plus short labels
 *     (titles, headings, CTA text) as evidence (Sprint 3 §13).
 *  2. No query strings. Evidence is origin + pathname only, because query
 *     strings carry tokens, emails and tracking ids (Sprint 3 §22).
 *
 * Everything here originates from a third-party website and is therefore
 * UNTRUSTED DATA. A future AI consumer must treat every string as input
 * to reason about, never as instructions to follow (CLAUDE.md rule 25).
 */

import type { PageRendering } from "./rendering";

export const LIVE_PRODUCT_INTELLIGENCE_SCHEMA_VERSION = "live-product-intelligence.v1" as const;

/**
 * Bumped whenever detection rules change materially, invalidating reuse.
 *
 * ## v4 — and the incident that named it
 *
 * `findReusableLiveSnapshot` keys reuse on this string, and it is the **only**
 * thing standing between a corrected detector and every audit downstream of a
 * snapshot the old one produced. On 2026-09-02 a fix landed that taught the
 * classifier to see a pricing surface that is an anchor section rather than a
 * route (`b29f3ce`) — and this constant was not bumped. So the snapshot taken
 * eight hours earlier, which had recorded "no pricing surface" about a page
 * displaying three prices, stayed reusable. Two days later it produced an
 * audit whose highest-priority contradiction, its critical rank-1 blocker and
 * the founder's whole plan all rested on it.
 *
 * The lesson is not "remember to bump". A behaviour change to any detector
 * this snapshot carries — the classifier, the surface rules, the pricing text
 * reader — is a new analyzer, and shipping it without saying so is how a fixed
 * bug keeps being served. v4 covers that fix and the pricing-period reader
 * corrected alongside it.
 */
export const LIVE_PRODUCT_ANALYZER_VERSION = "live-product-analyzer-v4" as const;

/** Deliberately coarse — no fake numeric precision (Sprint 3 §14). */
export type Confidence = "high" | "medium" | "low";

/**
 * Why a detection was made. `kind` records the strength of the evidence:
 * a URL path is a weaker signal than a password field in a form.
 */
export type LiveEvidence = {
  kind:
    | "url_path"
    | "page_title"
    | "heading"
    | "nav_label"
    | "link_text"
    | "form_structure"
    | "redirect"
    | "http_header";
  /** Origin-relative pathname the evidence came from — never a full URL with query. */
  path: string;
  /** A short label, e.g. a heading or CTA text. Never a page body. */
  detail?: string;
};

export type ProductSurfaceId =
  | "homepage"
  | "pricing"
  | "login"
  | "signup"
  | "dashboard_app"
  | "checkout_billing"
  | "onboarding"
  | "contact"
  | "docs_help"
  | "blog_content"
  | "privacy"
  | "terms";

export type ProductSurfaceSignal = {
  id: ProductSurfaceId;
  name: string;
  detected: boolean;
  confidence: Confidence;
  evidence: LiveEvidence[];
};

export type CtaCategory =
  | "get_started"
  | "signup"
  | "trial"
  | "purchase"
  | "subscribe"
  | "demo"
  | "contact"
  | "login";

export type CtaSignal = {
  category: CtaCategory;
  /** The visible label, capped in length. Untrusted third-party text. */
  label: string;
  confidence: Confidence;
  /** Pathname the CTA was found on. */
  path: string;
  /** True when found in a nav/header region rather than page body. */
  inNav: boolean;
};

export type FormKind =
  | "login_like"
  | "signup_like"
  | "contact_like"
  | "newsletter_like"
  | "search_like"
  | "unknown";

export type FormSignal = {
  kind: FormKind;
  confidence: Confidence;
  /** Input *types* only — never field names, values or defaults (Sprint 3 §18). */
  fieldTypes: string[];
  fieldCount: number;
  path: string;
};

/** A single inspected page, reduced to derived facts (Sprint 3 §15). */
export type PageSummary = {
  /** The origin-relative pathname requested. No query string, ever. */
  path: string;
  status: number;
  /**
   * Where the request actually landed, when it was redirected. `/app`
   * with `redirectedTo: "/login"` is how a protected application surface
   * shows up (Sprint 3 §19). Null when the page served itself.
   */
  redirectedTo: string | null;
  title: string | null;
  headingCount: number;
  formCount: number;
  linkCount: number;
  /** CTA labels found on this page, capped. */
  ctas: string[];
  surfaces: ProductSurfaceId[];
  bytes: number;
  /**
   * Whether this page could be read at all (Sprint 0082).
   *
   * Optional so a stored snapshot taken before this existed still parses. Read
   * it as `"readable"` when absent — that is what every consumer assumed for
   * every page before this field, and inventing a warning for old snapshots
   * would be a claim no analyzer ever made.
   */
  rendering?: PageRendering;
};

export type SeoSignalId =
  | "title"
  | "meta_description"
  | "canonical"
  | "language"
  | "viewport"
  | "open_graph"
  | "structured_data"
  | "robots_txt"
  | "sitemap"
  | "robots_meta";

/** A deterministic fact about a page's foundations — never a score or recommendation (Sprint 3 §20). */
export type SeoSignal = {
  id: SeoSignalId;
  name: string;
  /**
   * Whether the **homepage** carries it.
   *
   * Deliberately unchanged. `buildLiveEvidence` mints `live.seo.<id>` and
   * `live.seo.<id>_missing` straight off this boolean, and those citations are
   * stored in four durable places — so redefining `present` to mean "every
   * page" would quietly change what every already-stored citation asserted.
   * The wider fact goes in `coverage` instead, where it is additive.
   */
  present: boolean;
  evidence: LiveEvidence[];
  /**
   * How many inspected pages carry it (document-level signals only).
   *
   * Optional, so a snapshot taken before this existed still parses and rebuilds
   * to the same evidence ids. Absent on `robots_txt` and `sitemap`, where it
   * would be meaningless: those are properties of the site, not of a page.
   *
   * This is the half the homepage could not see. A site whose homepage has a
   * description and whose four other pages do not was reported as fine.
   */
  coverage?: SeoSignalCoverage;
};

export type SeoSignalCoverage = {
  pagesWith: number;
  pagesInspected: number;
};

export type ConversionSignals = {
  /** The most likely primary action, or null when none was detected. */
  primaryCta: CtaSignal | null;
  ctas: CtaSignal[];
  signupCtaPresent: boolean;
  pricingCtaPresent: boolean;
  contactCtaPresent: boolean;
  formCount: number;
  forms: FormSignal[];
  /** Same-origin links pointing at conversion surfaces (pricing, signup, checkout). */
  conversionPathLinks: string[];
};

/**
 * What a product charges, as far as the site says so out loud.
 *
 * Two sources, kept apart because they carry different weight. A **declared**
 * price is a schema.org `Offer` the operator published — a statement about
 * their own business. Anything read out of rendered text would be an
 * observation that could as easily be a discount, a struck-through figure or
 * an "from" amount, and mixing the two would launder the second into the
 * first.
 *
 * Absence is a real answer and the common one: most sites publish no `Offer`
 * at all. `declaredPricePoints: []` means "the site did not say", never "this
 * product is free" — the distinction the audit's own `insufficient_evidence`
 * rule exists to keep.
 *
 * Derived facts only (Rule 37). Amounts, currency codes, periods and short
 * plan labels; never page source, never body text.
 */
export type PricingSignals = {
  /** Whether a pricing surface was reached at all. Nothing below means much without it. */
  pricingPageReached: boolean;
  /** Prices the site declares in JSON-LD, in the order found. May be empty. */
  declaredPricePoints: DeclaredPricePoint[];
  /**
   * Whether any declared offer costs nothing.
   *
   * Recorded rather than derived at read time, because "there is a free tier"
   * is a business fact a founder reasons about directly.
   */
  hasFreeDeclaredTier: boolean;
  /** Distinct currencies declared. More than one is itself worth noticing. */
  declaredCurrencies: string[];
  /**
   * Prices read off the visible text, and never merged into the list above.
   *
   * Separate because they carry different weight. A declared offer is what the
   * operator published; an observed one is a glyph and a number that sat next
   * to each other, and could be a discount, a struck-through figure or an
   * "from" amount. One list would launder the second into the first.
   */
  observedPricePoints: ObservedPricePoint[];
};

export type ObservedPricePoint = {
  amount: number;
  /** Exactly as written — a symbol or a code. Never mapped: `$` is not USD. */
  currencyToken: string;
  period: "day" | "week" | "month" | "year" | "one_time" | null;
  /** The same-origin path it was read on. */
  path: string;
};

export type DeclaredPricePoint = {
  price: number;
  currency: string;
  period: "day" | "week" | "month" | "year" | "one_time" | null;
  planName: string | null;
  /** The same-origin path the offer was declared on. */
  path: string;
};

export type SiteMetadata = {
  title: string | null;
  description: string | null;
  language: string | null;
  canonical: string | null;
  openGraph: Record<string, string>;
  structuredDataTypes: string[];
};

/**
 * What a served page says about its own brand (CORE-1 §11–§13).
 *
 * The counterpart to the repository's `BrandIntelligence`, and deliberately
 * not the same shape: the repository knows what a design system *declares*,
 * while this knows what a visitor is actually served. Where they agree, the
 * claim is strong. Where they disagree — a logo in `/public` that no page
 * references — that disagreement is itself the finding.
 *
 * Paths only, never bytes. No image, icon, or stylesheet is downloaded here;
 * a URL recorded in this payload is a reference the page published, and
 * whether it resolves is not something static HTML inspection can say.
 */
export type LiveBrandAsset = {
  role: "favicon" | "app_icon" | "logo" | "open_graph_image" | "web_manifest";
  /** Origin-relative path, query stripped (Sprint 3 §22). Absolute for off-origin. */
  path: string;
  /** The image's own alt text, when it had one. Untrusted third-party text. */
  label: string | null;
  confidence: Confidence;
  evidence: LiveEvidence[];
};

export type LiveBrandColor = {
  /** Where the value came from — a declaration, not an inference. */
  source: "theme_color_meta" | "style_token";
  value: string;
  /** Custom-property name for a style token; null for `theme-color`. */
  token: string | null;
  confidence: Confidence;
  evidence: LiveEvidence[];
};

export type LiveBrandSignals = {
  /** The name the site gives itself, from og:site_name or application-name. */
  siteName: string | null;
  assets: LiveBrandAsset[];
  colors: LiveBrandColor[];
  /** Font families named in inline custom properties, e.g. "Space Grotesk". */
  typefaces: string[];
};

export type LiveAnalysisSource = {
  /** The normalized URL the user configured. */
  configuredUrl: string;
  /** The origin actually crawled — differs when the configured URL redirected. */
  effectiveOrigin: string;
  analyzerVersion: string;
  /** True when the configured URL redirected to a different origin. */
  redirected: boolean;
  analyzedAt: string;
};

export type CrawlSummary = {
  pagesInspected: number;
  pagesDiscovered: number;
  maxDepthReached: number;
  robotsTxtPresent: boolean;
  robotsRespected: boolean;
  sitemapPresent: boolean;
  sitemapUrlsConsidered: number;
  redirectsFollowed: number;
};

export type LiveAnalysisMetrics = {
  pagesFetched: number;
  bytesFetched: number;
  requestCount: number;
  durationMs: number;
};

export type LiveCompleteness = {
  status: CrawlCompleteness;
  reasons: CrawlCompletenessReason[];
};

/**
 * How much of the site Vibe could actually read (Sprint 0082).
 *
 * Separate from `completeness`, which answers a different question. Completeness
 * says how much of the site was *reached*; this says how much of what was
 * reached could be *understood*. A crawl can hit every page under every budget
 * and still come back with nothing, and before this existed that outcome was
 * indistinguishable in the snapshot from a product that genuinely has no
 * headings, no calls to action and no pricing.
 *
 * Optional, so a snapshot stored before this existed still parses.
 */
export type LiveReadability = {
  /** Pages whose markup carried content a reader would use. */
  readable: number;
  /** Pages that were read correctly and are genuinely almost empty. */
  empty: number;
  /**
   * Pages that render in the browser, so what Vibe fetched is not what a
   * person sees. Vibe runs no browser by decision — [ADR 0010](../../../docs/decisions/0010-safe-outbound-http-inspection.md)
   * and rule 38 — so this is a limit reported, never one worked around.
   */
  clientRendered: number;
  /** Paths of the client-rendered pages, capped, as evidence for the count. */
  clientRenderedPaths: string[];
};

/** A non-fatal observation worth surfacing, e.g. a page that failed to load. */
export type LiveWarning = {
  code: string;
  message: string;
  path?: string;
};

export type LiveProductIntelligenceSnapshot = {
  schemaVersion: typeof LIVE_PRODUCT_INTELLIGENCE_SCHEMA_VERSION;
  source: LiveAnalysisSource;
  crawl: CrawlSummary;
  siteMetadata: SiteMetadata;
  pages: PageSummary[];
  readability?: LiveReadability;
  productSurfaces: ProductSurfaceSignal[];
  seoSignals: SeoSignal[];
  conversionSignals: ConversionSignals;
  /**
   * Optional so a snapshot taken before this existed still parses.
   *
   * That matters beyond tolerance: the Opportunity Engine and the Action
   * Planner rebuild a stored audit's evidence pack from its snapshots, and a
   * builder that read this unconditionally would mint ids for an old snapshot
   * that the audit never cited. Absent means absent.
   */
  pricing?: PricingSignals;
  brandSignals: LiveBrandSignals;
  metrics: LiveAnalysisMetrics;
  completeness: LiveCompleteness;
  warnings: LiveWarning[];
};
