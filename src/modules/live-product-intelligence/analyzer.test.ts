import { describe, expect, it } from "vitest";
import { buildLiveProductHumanView } from "./human-view";
import { analyzeLiveProduct } from "./analyzer";
import { buildPricingSignals, buildSeoSignals } from "./signals";
import type { FetchedPage } from "./crawler";
import type { ParsedOffer } from "./html";
import type { ObservedPrice } from "./pricing-text";
import { DEFAULT_CRAWL_BUDGETS } from "./budgets";
import { LiveProductDomainError } from "./errors";
import {
  fakeDependencies,
  htmlResponse,
  redirectResponse,
  textResponse,
  xmlResponse,
} from "./test-support";

/**
 * End-to-end snapshot construction against representative site fixtures
 * (Sprint 3 §36). No browser, no network.
 */

const SAAS_SITE = {
  "https://acme.test/robots.txt": textResponse("User-agent: *\nAllow: /\nSitemap: https://acme.test/sitemap.xml\n"),
  "https://acme.test/sitemap.xml": xmlResponse(
    `<urlset><url><loc>https://acme.test/</loc></url><url><loc>https://acme.test/pricing</loc></url></urlset>`,
  ),
  "https://acme.test/": htmlResponse(`<!doctype html>
<html lang="en">
<head>
  <title>Acme — Ship faster</title>
  <meta name="description" content="Acme helps teams ship faster.">
  <meta name="viewport" content="width=device-width">
  <link rel="canonical" href="https://acme.test/">
  <meta property="og:title" content="Acme">
  <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
</head>
<body>
  <nav><a href="/pricing">Pricing</a><a href="/login">Log in</a><a href="/docs">Docs</a></nav>
  <h1>Ship faster</h1>
  <a href="/signup">Start free</a>
  <footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
</body></html>`),
  "https://acme.test/pricing": htmlResponse(
    `<html lang="en"><head><title>Pricing — Acme</title></head><body><h1>Plans</h1><a href="/signup">Choose a plan</a></body></html>`,
  ),
  "https://acme.test/login": htmlResponse(
    `<html lang="en"><head><title>Log in</title></head><body><form action="/login"><input type="email"><input type="password"><button>Log in</button></form></body></html>`,
  ),
  "https://acme.test/signup": htmlResponse(
    `<html lang="en"><head><title>Sign up</title></head><body><form><input type="email"><input type="password"><input type="password"><button>Sign up</button></form></body></html>`,
  ),
  "https://acme.test/docs": htmlResponse(`<html lang="en"><head><title>Docs</title></head><body><h1>Docs</h1></body></html>`),
  "https://acme.test/privacy": htmlResponse(`<html lang="en"><head><title>Privacy Policy</title></head><body><h1>Privacy</h1></body></html>`),
  "https://acme.test/terms": htmlResponse(`<html lang="en"><head><title>Terms of Service</title></head><body><h1>Terms</h1></body></html>`),
};

describe("analyzeLiveProduct — full SaaS site", () => {
  it("builds a versioned snapshot with surfaces, CTAs and SEO signals", async () => {
    const snapshot = await analyzeLiveProduct({
      configuredUrl: "https://acme.test/",
      dependencies: fakeDependencies(SAAS_SITE),
    });

    expect(snapshot.schemaVersion).toBe("live-product-intelligence.v1");
    expect(snapshot.source.analyzerVersion).toBe("live-product-analyzer-v3");
    expect(snapshot.source.effectiveOrigin).toBe("https://acme.test");

    const detected = snapshot.productSurfaces.filter((surface) => surface.detected).map((surface) => surface.id);
    expect(detected).toEqual(expect.arrayContaining(["homepage", "pricing", "login", "signup", "docs_help", "privacy", "terms"]));

    expect(snapshot.conversionSignals.primaryCta?.label).toBe("Start free");
    expect(snapshot.conversionSignals.signupCtaPresent).toBe(true);

    const seo = new Map(snapshot.seoSignals.map((signal) => [signal.id, signal.present]));
    expect(seo.get("title")).toBe(true);
    expect(seo.get("meta_description")).toBe(true);
    expect(seo.get("canonical")).toBe(true);
    expect(seo.get("open_graph")).toBe(true);
    expect(seo.get("structured_data")).toBe(true);
    expect(seo.get("robots_txt")).toBe(true);
    expect(seo.get("sitemap")).toBe(true);

    expect(snapshot.siteMetadata.title).toBe("Acme — Ship faster");
    expect(snapshot.crawl.pagesInspected).toBeGreaterThan(3);
  });

  it("persists no raw HTML anywhere in the snapshot", async () => {
    const snapshot = await analyzeLiveProduct({
      configuredUrl: "https://acme.test/",
      dependencies: fakeDependencies(SAAS_SITE),
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("<html");
    expect(serialized).not.toContain("<body");
    expect(serialized).not.toContain("<script");
    expect(serialized).not.toContain("doctype");
    expect(serialized).not.toContain("<a href");
  });

  it("persists no query strings", async () => {
    const site = {
      ...SAAS_SITE,
      "https://acme.test/": htmlResponse(
        `<html><head><title>Acme</title></head><body><a href="/pricing?utm_source=news&token=abc123">Pricing</a></body></html>`,
      ),
    };

    const snapshot = await analyzeLiveProduct({
      configuredUrl: "https://acme.test/",
      dependencies: fakeDependencies(site),
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("utm_source");
    expect(serialized).not.toContain("token=abc123");
    expect(serialized).not.toContain("?");
  });
});

describe("analyzeLiveProduct — other site shapes", () => {
  it("handles a site with no metadata at all", async () => {
    const snapshot = await analyzeLiveProduct({
      configuredUrl: "https://bare.test/",
      dependencies: fakeDependencies({
        "https://bare.test/": htmlResponse("<html><body><p>Hello</p></body></html>"),
      }),
    });

    expect(snapshot.siteMetadata.title).toBeNull();
    const seo = new Map(snapshot.seoSignals.map((signal) => [signal.id, signal.present]));
    expect(seo.get("title")).toBe(false);
    expect(seo.get("meta_description")).toBe(false);
    expect(seo.get("robots_txt")).toBe(false);
    expect(seo.get("sitemap")).toBe(false);
    expect(snapshot.conversionSignals.primaryCta).toBeNull();
  });

  it("reports a protected dashboard that redirects anonymous visitors to login", async () => {
    const snapshot = await analyzeLiveProduct({
      configuredUrl: "https://acme.test/",
      dependencies: fakeDependencies({
        "https://acme.test/": htmlResponse(
          `<html><head><title>Acme</title></head><body><a href="/app">Dashboard</a></body></html>`,
        ),
        "https://acme.test/app": redirectResponse("https://acme.test/login"),
        "https://acme.test/login": htmlResponse(
          `<html><head><title>Log in</title></head><body><form><input type="email"><input type="password"></form></body></html>`,
        ),
      }),
    });

    const dashboard = snapshot.productSurfaces.find((surface) => surface.id === "dashboard_app");
    expect(dashboard?.detected).toBe(true);
    expect(dashboard?.evidence.some((item) => item.kind === "redirect")).toBe(true);

    const appPage = snapshot.pages.find((page) => page.path === "/app");
    expect(appPage?.redirectedTo).toBe("/login");
  });

  it("records the redirect when the configured origin moves to www", async () => {
    const snapshot = await analyzeLiveProduct({
      configuredUrl: "https://acme.test/",
      dependencies: fakeDependencies({
        "https://acme.test/": redirectResponse("https://www.acme.test/"),
        "https://www.acme.test/": htmlResponse("<html><head><title>Acme</title></head><body></body></html>"),
      }),
    });

    expect(snapshot.source.redirected).toBe(true);
    expect(snapshot.source.effectiveOrigin).toBe("https://www.acme.test");
    expect(snapshot.warnings.some((warning) => warning.code === "origin_redirected")).toBe(true);
  });

  it("infers a linked-but-uninspected surface at medium confidence", async () => {
    const snapshot = await analyzeLiveProduct({
      configuredUrl: "https://acme.test/",
      dependencies: fakeDependencies({
        "https://acme.test/": htmlResponse(
          `<html><head><title>Acme</title></head><body><a href="/pricing">Pricing</a></body></html>`,
        ),
        // /pricing itself is never served, so it is only ever a link.
        "https://acme.test/pricing": { status: 500, headers: {} },
      }),
    });

    const pricing = snapshot.productSurfaces.find((surface) => surface.id === "pricing");
    expect(pricing?.detected).toBe(true);
    expect(pricing?.confidence).toBe("medium");
  });

  it("reports partial completeness when a budget is reached", async () => {
    const links = Array.from({ length: 30 }, (_, index) => `<a href="/p${index}">P${index}</a>`).join("");
    const routes: Record<string, ReturnType<typeof htmlResponse>> = {
      "https://acme.test/": htmlResponse(`<html><head><title>Acme</title></head><body>${links}</body></html>`),
    };
    for (let index = 0; index < 30; index += 1) {
      routes[`https://acme.test/p${index}`] = htmlResponse(`<html><head><title>P${index}</title></head></html>`);
    }

    const snapshot = await analyzeLiveProduct({
      configuredUrl: "https://acme.test/",
      dependencies: fakeDependencies(routes),
      budgets: { ...DEFAULT_CRAWL_BUDGETS, maxPages: 3 },
    });

    expect(snapshot.completeness.status).toBe("partial");
    expect(snapshot.completeness.reasons).toContain("page_budget_reached");
    // A partial result is still a useful result.
    expect(snapshot.pages).toHaveLength(3);
  });
});

describe("analyzeLiveProduct — failures", () => {
  it("throws a typed domain error for an unreachable homepage", async () => {
    await expect(
      analyzeLiveProduct({
        configuredUrl: "https://down.test/",
        dependencies: fakeDependencies({ "https://down.test/": { fail: "connection_failed" } }),
      }),
    ).rejects.toThrow(LiveProductDomainError);
  });

  it("throws unsafe_destination when the homepage resolves privately", async () => {
    const dependencies = fakeDependencies({ "https://evil.test/": htmlResponse("<html></html>") }, {
      "evil.test": ["127.0.0.1"],
    });

    await expect(
      analyzeLiveProduct({ configuredUrl: "https://evil.test/", dependencies }),
    ).rejects.toMatchObject({ code: "unsafe_destination" });

    expect(dependencies.transport.requests).toHaveLength(0);
  });
});

/**
 * What the site says it charges.
 *
 * Monetization is one of the five dimensions the audit scores, and the
 * snapshot could previously say a pricing *page* existed and nothing about
 * what was on it.
 */
describe("buildPricingSignals", () => {
  const page = (
    finalPath: string,
    offers: ParsedOffer[],
    observedPrices: ObservedPrice[] = [],
  ): FetchedPage =>
    ({
      requestedPath: finalPath,
      finalPath,
      status: 200,
      bytes: 100,
      depth: 1,
      redirected: false,
      // Both lists, always. `parseHtml` sets each on every page, so a fixture
      // omitting one describes a page that cannot exist — and the builder
      // reading it would throw rather than reveal anything about the code.
      html: { offers, observedPrices } as unknown as FetchedPage["html"],
    }) as FetchedPage;

  it("records what each page declares, and where", () => {
    const signals = buildPricingSignals({
      pages: [
        page("/", [{ price: 0, currency: "EUR", period: null, name: "Free" }]),
        page("/pricing", [{ price: 29, currency: "EUR", period: "month", name: "Pro" }]),
      ],
      pricingPageReached: true,
    });

    expect(signals.declaredPricePoints).toEqual([
      { price: 0, currency: "EUR", period: null, planName: "Free", path: "/" },
      { price: 29, currency: "EUR", period: "month", planName: "Pro", path: "/pricing" },
    ]);
    expect(signals.hasFreeDeclaredTier).toBe(true);
    expect(signals.declaredCurrencies).toEqual(["EUR"]);
  });

  /**
   * Read from every page, not only the pricing surface. Plenty of products
   * declare their Offer on the homepage, and a founder asking "does my site
   * say what this costs" is not asking "does /pricing say it".
   */
  it("finds an offer declared away from the pricing page", () => {
    const signals = buildPricingSignals({
      pages: [page("/", [{ price: 19, currency: "USD", period: "month", name: null }])],
      pricingPageReached: false,
    });

    expect(signals.declaredPricePoints).toHaveLength(1);
    expect(signals.declaredPricePoints[0]?.path).toBe("/");
  });

  it("notices more than one currency", () => {
    const signals = buildPricingSignals({
      pages: [
        page("/pricing", [
          { price: 29, currency: "EUR", period: "month", name: "Pro" },
          { price: 32, currency: "USD", period: "month", name: "Pro" },
        ]),
      ],
      pricingPageReached: true,
    });

    expect(signals.declaredCurrencies).toEqual(["EUR", "USD"]);
  });

  /**
   * The distinction the whole type exists to keep.
   *
   * No declared price is not a free product, and it is not even a finding
   * unless the pricing page was actually read — otherwise it reports Vibe's
   * own coverage gap as a fact about the founder's business.
   */
  it("does not mistake silence for a free product", () => {
    const signals = buildPricingSignals({ pages: [page("/", [])], pricingPageReached: false });

    expect(signals.declaredPricePoints).toEqual([]);
    expect(signals.hasFreeDeclaredTier).toBe(false);
    expect(signals.pricingPageReached).toBe(false);
  });

  it("treats a declared zero as a stated free tier", () => {
    // Zero *is* a price when the site publishes it. That is different from
    // publishing nothing, which the case above covers.
    const signals = buildPricingSignals({
      pages: [page("/pricing", [{ price: 0, currency: "USD", period: "month", name: "Starter" }])],
      pricingPageReached: true,
    });

    expect(signals.hasFreeDeclaredTier).toBe(true);
  });
});

/**
 * The two sources stay apart.
 *
 * A declared offer is what the operator published; an observed one is a glyph
 * and a number that sat next to each other. Merging them would launder the
 * second into the first, and the whole value of the declared list is that a
 * founder can trust it more.
 */
describe("buildPricingSignals — observed prices", () => {
  const page = (
    finalPath: string,
    offers: ParsedOffer[],
    observedPrices: ObservedPrice[] = [],
  ): FetchedPage =>
    ({
      requestedPath: finalPath,
      finalPath,
      status: 200,
      bytes: 100,
      depth: 1,
      redirected: false,
      html: { offers, observedPrices } as unknown as FetchedPage["html"],
    }) as FetchedPage;

  it("keeps an observation out of the declared list", () => {
    const signals = buildPricingSignals({
      pages: [page("/pricing", [], [{ amount: 29, currencyToken: "$", period: "month" }])],
      pricingPageReached: true,
    });

    expect(signals.declaredPricePoints).toEqual([]);
    expect(signals.observedPricePoints).toEqual([
      { amount: 29, currencyToken: "$", period: "month", path: "/pricing" },
    ]);
  });

  /**
   * An observed zero is not a stated free tier.
   *
   * `hasFreeDeclaredTier` is named for the declared list and must stay that
   * way: a "0" somewhere on a page is not the site saying it has a free plan.
   */
  it("does not let an observed zero claim a free tier", () => {
    const signals = buildPricingSignals({
      pages: [page("/pricing", [], [{ amount: 0, currencyToken: "$", period: null }])],
      pricingPageReached: true,
    });

    expect(signals.hasFreeDeclaredTier).toBe(false);
  });

  it("does not let an observation into the declared currency list", () => {
    const signals = buildPricingSignals({
      pages: [page("/pricing", [], [{ amount: 29, currencyToken: "USD", period: null }])],
      pricingPageReached: true,
    });

    expect(signals.declaredCurrencies).toEqual([]);
  });
});

/**
 * The half the homepage could not see.
 *
 * Eight of the ten SEO signals are document-level, and all eight were read from
 * the homepage alone — so a site whose homepage has a description and whose
 * four other pages do not was reported as entirely fine.
 */
describe("buildSeoSignals — coverage", () => {
  const page = (finalPath: string, html: Partial<FetchedPage["html"]>): FetchedPage =>
    ({
      requestedPath: finalPath,
      finalPath,
      status: 200,
      bytes: 100,
      depth: finalPath === "/" ? 0 : 1,
      redirected: false,
      html: { openGraph: {}, ...html } as unknown as FetchedPage["html"],
    }) as FetchedPage;

  const seo = (pages: FetchedPage[]) =>
    buildSeoSignals({ homepage: pages[0], pages, robotsTxtPresent: true, sitemapPresent: true });

  const find = (pages: FetchedPage[], id: string) =>
    seo(pages).find((signal) => signal.id === id);

  it("counts how many inspected pages carry a signal", () => {
    const signal = find(
      [
        page("/", { title: "Acme" }),
        page("/pricing", { title: "Pricing" }),
        page("/about", { title: null }),
      ],
      "title",
    );

    expect(signal?.coverage).toEqual({ pagesWith: 2, pagesInspected: 3 });
  });

  /**
   * The property that keeps stored citations meaning what they meant.
   *
   * `live.seo.title` and `live.seo.title_missing` are minted straight off
   * `present`, and those are stored in four durable places. Redefining it to
   * mean "every page" would silently change what every one of them asserted.
   */
  it("leaves present meaning the homepage", () => {
    const signal = find([page("/", { title: "Acme" }), page("/about", { title: null })], "title");

    expect(signal?.present).toBe(true);
    expect(signal?.coverage?.pagesWith).toBe(1);
  });

  /**
   * robots.txt and sitemap.xml are properties of the site, not of a page. A
   * per-page count there would be a category error dressed as a number.
   */
  it.each(["robots_txt", "sitemap"])("does not put a page count on %s", (id) => {
    expect(find([page("/", { title: "Acme" })], id)?.coverage).toBeUndefined();
  });

  it("reports full coverage when every page carries it", () => {
    const signal = find(
      [page("/", { hasViewportMeta: true }), page("/pricing", { hasViewportMeta: true })],
      "viewport",
    );

    expect(signal?.coverage).toEqual({ pagesWith: 2, pagesInspected: 2 });
  });
});

/* ---------------------------------------------------------------------------
 * Sprint 0082 — a product that builds itself in the browser
 * ------------------------------------------------------------------------ */

/**
 * The whole site is a shell. Every page returns 200 and a few hundred bytes,
 * every budget is respected, and nothing is readable — which before this sprint
 * produced a `complete` snapshot asserting the product has no headings, no
 * calls to action, no forms and no pricing.
 */
const CLIENT_RENDERED_SITE: Record<string, ReturnType<typeof htmlResponse>> = {
  "https://spa.test/": htmlResponse(`<!doctype html><html lang="en"><head>
<title>Acme</title><meta name="viewport" content="width=device-width">
<script type="module" src="/assets/index.js"></script></head>
<body><noscript>You need to enable JavaScript to run this app.</noscript>
<div id="root"></div></body></html>`),
};

describe("analyzeLiveProduct — a client-rendered product", () => {
  it("does not report an unread page as a product without calls to action", async () => {
    const snapshot = await analyzeLiveProduct({
      configuredUrl: "https://spa.test/",
      dependencies: fakeDependencies(CLIENT_RENDERED_SITE),
    });

    // The zeroes are still there — they are what the markup said.
    expect(snapshot.conversionSignals.ctas).toEqual([]);

    // What changed is that the snapshot no longer presents them as the truth.
    expect(snapshot.completeness.status).toBe("partial");
    expect(snapshot.completeness.reasons).toContain("client_rendered");
    expect(snapshot.readability).toEqual({
      readable: 0,
      empty: 0,
      clientRendered: 1,
      clientRenderedPaths: ["/"],
    });
    expect(snapshot.pages[0].rendering).toBe("client_rendered");
  });

  it("tells a founder it could not see the page, not that the page is empty", async () => {
    const snapshot = await analyzeLiveProduct({
      configuredUrl: "https://spa.test/",
      dependencies: fakeDependencies(CLIENT_RENDERED_SITE),
    });

    const view = buildLiveProductHumanView(snapshot);
    expect(view.incompleteReason).toContain("builds themselves in your visitor's browser");
    expect(view.incompleteReason).toContain("Vibe could not see it");
    expect(view.incompleteReason).not.toContain("client_rendered");
  });

  it("leaves a readable site complete", async () => {
    const snapshot = await analyzeLiveProduct({
      configuredUrl: "https://acme.test/",
      dependencies: fakeDependencies(SAAS_SITE),
    });

    expect(snapshot.completeness.reasons).not.toContain("client_rendered");
    expect(snapshot.readability?.clientRendered).toBe(0);
    expect(snapshot.readability?.readable).toBeGreaterThan(0);
  });
});
