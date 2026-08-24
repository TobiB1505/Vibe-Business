import { ALL_SURFACES, classifyLinkTarget, classifyPage, surfaceName } from "./classifier";
import { detectCtas, selectPrimaryCta, type CtaCandidate } from "./cta";
import { toFormSignal } from "./forms";
import type { FetchedPage } from "./crawler";
import type {
  DeclaredPricePoint,
  ObservedPricePoint,
  PricingSignals,
  ConversionSignals,
  LiveEvidence,
  PageSummary,
  ProductSurfaceId,
  ProductSurfaceSignal,
  SeoSignal,
  SeoSignalId,
  SiteMetadata,
} from "./schema";

/**
 * Aggregates per-page observations into site-level signals
 * (Sprint 3 §20, §21).
 *
 * Everything produced here is a structural fact with evidence attached.
 * There is no scoring, no ranking, no recommendation — "canonical: not
 * present" is a fact; "you should add a canonical tag" is advice, and
 * advice belongs to the later Business Audit (Sprint 3 §42).
 */

const SEO_SIGNAL_NAMES: Record<SeoSignalId, string> = {
  title: "Title",
  meta_description: "Meta description",
  canonical: "Canonical URL",
  language: "Language",
  viewport: "Viewport",
  open_graph: "Open Graph",
  structured_data: "Structured data",
  robots_txt: "robots.txt",
  sitemap: "Sitemap",
  robots_meta: "Robots meta",
};

/** Surfaces whose presence is meaningful enough to infer from a link alone. */
const LINK_INFERABLE_SURFACES = new Set<ProductSurfaceId>([
  "pricing",
  "login",
  "signup",
  "contact",
  "privacy",
  "terms",
  "docs_help",
  "blog_content",
  "checkout_billing",
  "dashboard_app",
]);

export function buildSiteMetadata(homepage: FetchedPage | undefined): SiteMetadata {
  if (!homepage) {
    return {
      title: null,
      description: null,
      language: null,
      canonical: null,
      openGraph: {},
      structuredDataTypes: [],
    };
  }

  return {
    title: homepage.html.title,
    description: homepage.html.metaDescription,
    language: homepage.html.language,
    canonical: homepage.html.canonical,
    openGraph: homepage.html.openGraph,
    structuredDataTypes: homepage.html.structuredDataTypes,
  };
}

export function buildSeoSignals(input: {
  homepage: FetchedPage | undefined;
  robotsTxtPresent: boolean;
  sitemapPresent: boolean;
}): SeoSignal[] {
  const { homepage, robotsTxtPresent, sitemapPresent } = input;
  const path = homepage?.finalPath ?? "/";

  const signal = (id: SeoSignalId, present: boolean, evidence: LiveEvidence[] = []): SeoSignal => ({
    id,
    name: SEO_SIGNAL_NAMES[id],
    present,
    evidence,
  });

  const pageEvidence = (detail?: string): LiveEvidence[] =>
    detail === undefined ? [] : [{ kind: "page_title", path, detail: detail.slice(0, 120) }];

  return [
    signal("title", Boolean(homepage?.html.title), pageEvidence(homepage?.html.title ?? undefined)),
    signal(
      "meta_description",
      Boolean(homepage?.html.metaDescription),
      pageEvidence(homepage?.html.metaDescription ?? undefined),
    ),
    signal(
      "canonical",
      Boolean(homepage?.html.canonical),
      homepage?.html.canonical ? [{ kind: "url_path", path, detail: "canonical link present" }] : [],
    ),
    signal(
      "language",
      Boolean(homepage?.html.language),
      pageEvidence(homepage?.html.language ?? undefined),
    ),
    signal("viewport", Boolean(homepage?.html.hasViewportMeta)),
    signal(
      "open_graph",
      Object.keys(homepage?.html.openGraph ?? {}).length > 0,
      Object.keys(homepage?.html.openGraph ?? {})
        .slice(0, 4)
        .map((property) => ({ kind: "page_title" as const, path, detail: property })),
    ),
    signal(
      "structured_data",
      Boolean(homepage?.html.hasStructuredData),
      (homepage?.html.structuredDataTypes ?? []).slice(0, 4).map((type) => ({
        kind: "page_title" as const,
        path,
        detail: type,
      })),
    ),
    signal(
      "robots_meta",
      Boolean(homepage?.html.robotsMeta),
      pageEvidence(homepage?.html.robotsMeta ?? undefined),
    ),
    signal(
      "robots_txt",
      robotsTxtPresent,
      robotsTxtPresent ? [{ kind: "url_path", path: "/robots.txt" }] : [],
    ),
    signal("sitemap", sitemapPresent, sitemapPresent ? [{ kind: "url_path", path: "/sitemap.xml" }] : []),
  ];
}

export type AggregatedSurfaces = {
  surfaces: ProductSurfaceSignal[];
  perPageSurfaces: Map<string, ProductSurfaceId[]>;
};

/**
 * Merges per-page classifications and link-derived hints into one signal
 * per known surface.
 *
 * Confidence reflects how the surface was found: a page we actually
 * fetched and classified is `high`; a surface only ever seen as a link
 * the site exposes is `medium`, because the link is real but the page
 * behind it was never verified.
 */
export function buildProductSurfaces(input: {
  pages: FetchedPage[];
  discoveredPaths: string[];
}): AggregatedSurfaces {
  const evidenceBySurface = new Map<ProductSurfaceId, LiveEvidence[]>();
  const fetchedSurfaces = new Set<ProductSurfaceId>();
  const perPageSurfaces = new Map<string, ProductSurfaceId[]>();

  for (const page of input.pages) {
    const classification = classifyPage({
      requestedPath: page.requestedPath,
      finalPath: page.finalPath,
      html: page.html,
    });

    perPageSurfaces.set(page.requestedPath, classification.surfaces);

    for (const surface of classification.surfaces) fetchedSurfaces.add(surface);
    for (const [surface, items] of classification.evidence) {
      const existing = evidenceBySurface.get(surface) ?? [];
      evidenceBySurface.set(surface, [...existing, ...items].slice(0, 8));
    }
  }

  const linkOnlySurfaces = new Set<ProductSurfaceId>();
  for (const path of input.discoveredPaths) {
    const surface = classifyLinkTarget(path);
    if (surface === null || !LINK_INFERABLE_SURFACES.has(surface)) continue;
    if (fetchedSurfaces.has(surface)) continue;

    linkOnlySurfaces.add(surface);
    const existing = evidenceBySurface.get(surface) ?? [];
    if (existing.length < 8) {
      evidenceBySurface.set(surface, [
        ...existing,
        { kind: "link_text", path, detail: "linked from the site, not inspected" },
      ]);
    }
  }

  const surfaces: ProductSurfaceSignal[] = ALL_SURFACES.map((id) => {
    const detected = fetchedSurfaces.has(id) || linkOnlySurfaces.has(id);
    return {
      id,
      name: surfaceName(id),
      detected,
      confidence: fetchedSurfaces.has(id) ? "high" : detected ? "medium" : "high",
      evidence: evidenceBySurface.get(id) ?? [],
    };
  });

  return { surfaces, perPageSurfaces };
}

/**
 * What the site says it charges.
 *
 * Read from **every** page the crawl reached, not only the pricing surface.
 * Plenty of products declare their `Offer` on the homepage, and a founder
 * asking "does my site say what this costs" is not asking "does /pricing say
 * it". The path each offer was found on is recorded so the answer stays
 * checkable.
 *
 * `pricingPageReached` is carried alongside because everything else is close
 * to meaningless without it: no declared prices on a site whose pricing page
 * was never fetched says nothing at all, while the same emptiness on a site
 * whose pricing page *was* read is a real finding.
 *
 * Deliberately not merged with a text-scraped price. A declared offer is the
 * operator's own statement; a number lifted from rendered text could be a
 * discount, a struck-through figure or an "from" amount, and putting them in
 * one list would launder the second into the first.
 */
export function buildPricingSignals(input: {
  pages: FetchedPage[];
  pricingPageReached: boolean;
}): PricingSignals {
  const declaredPricePoints: DeclaredPricePoint[] = [];
  const observedPricePoints: ObservedPricePoint[] = [];

  for (const page of input.pages) {
    for (const observed of page.html.observedPrices) {
      observedPricePoints.push({
        amount: observed.amount,
        currencyToken: observed.currencyToken,
        period: observed.period,
        path: page.finalPath,
      });
    }

    for (const offer of page.html.offers) {
      declaredPricePoints.push({
        price: offer.price,
        currency: offer.currency,
        period: offer.period,
        planName: offer.name,
        path: page.finalPath,
      });
    }
  }

  return {
    pricingPageReached: input.pricingPageReached,
    declaredPricePoints,
    // Zero is a price, and a declared zero is a stated free tier. Absence of
    // any offer is not — see the type's own note.
    hasFreeDeclaredTier: declaredPricePoints.some((point) => point.price === 0),
    declaredCurrencies: [...new Set(declaredPricePoints.map((point) => point.currency))].sort(),
    observedPricePoints,
  };
}

export function buildConversionSignals(input: {
  pages: FetchedPage[];
  discoveredPaths: string[];
}): ConversionSignals {
  const candidates: CtaCandidate[] = [];

  for (const page of input.pages) {
    for (const link of page.html.links) {
      candidates.push({ label: link.text, path: page.finalPath, inNav: link.inNav || link.inFooter });
    }
    for (const buttonLabel of page.html.buttons) {
      candidates.push({ label: buttonLabel, path: page.finalPath, inNav: false });
    }
  }

  const ctas = detectCtas(candidates);
  const forms = input.pages.flatMap((page) =>
    page.html.forms.map((form) => toFormSignal(form, page.finalPath)),
  );

  const conversionPathLinks = [
    ...new Set(
      input.discoveredPaths.filter((path) => {
        const surface = classifyLinkTarget(path);
        return surface === "pricing" || surface === "signup" || surface === "checkout_billing";
      }),
    ),
  ].slice(0, 20);

  return {
    primaryCta: selectPrimaryCta(ctas),
    ctas: ctas.slice(0, 40),
    signupCtaPresent: ctas.some(
      (cta) => cta.category === "signup" || cta.category === "trial" || cta.category === "get_started",
    ),
    pricingCtaPresent: ctas.some((cta) => cta.category === "subscribe" || cta.category === "purchase"),
    contactCtaPresent: ctas.some((cta) => cta.category === "contact" || cta.category === "demo"),
    formCount: forms.length,
    forms: forms.slice(0, 20),
    conversionPathLinks,
  };
}

/** Reduces a fetched page to the derived summary that gets persisted (Sprint 3 §15). */
export function buildPageSummaries(
  pages: FetchedPage[],
  perPageSurfaces: Map<string, ProductSurfaceId[]>,
): PageSummary[] {
  return pages.map((page) => {
    const ctas = detectCtas([
      ...page.html.links.map((link) => ({
        label: link.text,
        path: page.finalPath,
        inNav: link.inNav || link.inFooter,
      })),
      ...page.html.buttons.map((label) => ({ label, path: page.finalPath, inNav: false })),
    ]);

    return {
      // The requested path is what the site's URL structure actually
      // offers; `redirectedTo` records where it led.
      path: page.requestedPath,
      status: page.status,
      redirectedTo: page.requestedPath !== page.finalPath ? page.finalPath : null,
      title: page.html.title,
      headingCount: page.html.headings.length,
      formCount: page.html.forms.length,
      linkCount: page.html.links.length,
      ctas: [...new Set(ctas.map((cta) => cta.label))].slice(0, 6),
      surfaces: perPageSurfaces.get(page.requestedPath) ?? [],
      bytes: page.bytes,
    };
  });
}
