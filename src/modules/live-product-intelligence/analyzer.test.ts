import { describe, expect, it } from "vitest";
import { analyzeLiveProduct } from "./analyzer";
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
    expect(snapshot.source.analyzerVersion).toBe("live-product-analyzer-v1");
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
