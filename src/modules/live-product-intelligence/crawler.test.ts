import { describe, expect, it } from "vitest";
import { DEFAULT_CRAWL_BUDGETS, type CrawlBudgets } from "./budgets";
import { crawlSite } from "./crawler";
import {
  fakeDependencies,
  htmlResponse,
  landingPageHtml,
  redirectResponse,
  textResponse,
  xmlResponse,
} from "./test-support";

/**
 * Crawl behaviour (Sprint 3 §35). Every case runs against the in-memory
 * transport, so the suite never touches the network.
 */

function budgets(overrides: Partial<CrawlBudgets> = {}): CrawlBudgets {
  return { ...DEFAULT_CRAWL_BUDGETS, ...overrides };
}

const page = (title: string, body = "") =>
  htmlResponse(`<html lang="en"><head><title>${title}</title></head><body>${body}</body></html>`);

describe("crawlSite — same-origin enforcement", () => {
  it("fetches the homepage and follows same-origin links only", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/": htmlResponse(
        `<html><head><title>Acme</title></head><body>
           <a href="/pricing">Pricing</a>
           <a href="https://twitter.com/acme">Twitter</a>
           <a href="https://blog.other.test/post">External blog</a>
         </body></html>`,
      ),
      "https://acme.test/pricing": page("Pricing"),
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paths = result.pages.map((item) => item.finalPath).sort();
    expect(paths).toEqual(["/", "/pricing"]);

    // Neither external domain was ever requested.
    expect(dependencies.transport.requestedUrls.some((url) => url.includes("twitter.com"))).toBe(false);
    expect(dependencies.transport.requestedUrls.some((url) => url.includes("other.test"))).toBe(false);
  });

  it("adopts the effective origin when the configured URL redirects", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/": redirectResponse("https://www.acme.test/"),
      "https://www.acme.test/": page("Acme", '<a href="/pricing">Pricing</a>'),
      "https://www.acme.test/pricing": page("Pricing"),
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effectiveOrigin).toBe("https://www.acme.test");
    expect(result.redirectedFromConfigured).toBe(true);
    expect(result.pages.map((item) => item.finalPath).sort()).toEqual(["/", "/pricing"]);
  });

  it("does not follow an in-crawl redirect that leaves the origin", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/": page("Acme", '<a href="/go">Partner</a>'),
      "https://acme.test/go": redirectResponse("https://partner.test/landing"),
      "https://partner.test/landing": page("Partner"),
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((item) => item.finalPath)).toEqual(["/"]);
    expect(dependencies.transport.requestedUrls.some((url) => url.includes("partner.test"))).toBe(false);
  });

  it("records a same-origin redirect as evidence of a protected surface", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/": page("Acme", '<a href="/app">Dashboard</a>'),
      "https://acme.test/app": redirectResponse("https://acme.test/login"),
      "https://acme.test/login": page("Log in", '<form><input type="password"></form>'),
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const appPage = result.pages.find((item) => item.requestedPath === "/app");
    expect(appPage?.finalPath).toBe("/login");
    expect(appPage?.redirected).toBe(true);
  });
});

describe("crawlSite — deduplication and query explosion", () => {
  it("does not fetch the same pathname twice via query variants", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/": page(
        "Acme",
        `<a href="/blog?utm_source=a">A</a>
         <a href="/blog?utm_source=b">B</a>
         <a href="/blog?page=2">C</a>
         <a href="/blog/">D</a>`,
      ),
      "https://acme.test/blog": page("Blog"),
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    const blogRequests = dependencies.transport.requestedUrls.filter((url) => url.includes("/blog"));
    expect(blogRequests).toHaveLength(1);
  });
});

describe("crawlSite — budgets", () => {
  it("stops at the page budget and reports partial completeness", async () => {
    const links = Array.from({ length: 20 }, (_, index) => `<a href="/p${index}">P${index}</a>`).join("");
    const routes: Record<string, ReturnType<typeof page>> = {
      "https://acme.test/": page("Acme", links),
    };
    for (let index = 0; index < 20; index += 1) {
      routes[`https://acme.test/p${index}`] = page(`P${index}`);
    }

    const dependencies = fakeDependencies(routes);
    const result = await crawlSite("https://acme.test/", dependencies, {
      budgets: budgets({ maxPages: 4 }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toHaveLength(4);
    expect(result.tracker.completeness).toBe("partial");
    expect(result.tracker.completenessReasons).toContain("page_budget_reached");
  });

  it("respects the crawl depth limit", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/": page("Home", '<a href="/one">One</a>'),
      "https://acme.test/one": page("One", '<a href="/two">Two</a>'),
      "https://acme.test/two": page("Two", '<a href="/three">Three</a>'),
      "https://acme.test/three": page("Three"),
    });

    const result = await crawlSite("https://acme.test/", dependencies, {
      budgets: budgets({ maxDepth: 1 }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((item) => item.finalPath).sort()).toEqual(["/", "/one"]);
    expect(result.tracker.completenessReasons).toContain("crawl_depth_reached");
  });

  it("reports a fully crawled site as complete even when pages link back to each other", async () => {
    // Regression: mutual links between already-visited pages used to trip
    // the depth counter and report a complete crawl as partial. Found by
    // dogfooding the real Vibe Business deployment (Sprint 3 §40).
    const dependencies = fakeDependencies({
      "https://acme.test/": page("Home", '<a href="/login">Log in</a>'),
      "https://acme.test/login": page("Log in", '<a href="/signup">Sign up</a>'),
      "https://acme.test/signup": page("Sign up", '<a href="/login">Log in</a>'),
    });

    const result = await crawlSite("https://acme.test/", dependencies, {
      budgets: budgets({ maxDepth: 2 }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toHaveLength(3);
    expect(result.tracker.completenessReasons).not.toContain("crawl_depth_reached");
    expect(result.tracker.completeness).toBe("complete");
  });

  it("notes the link budget when a page has more links than allowed", async () => {
    const links = Array.from({ length: 30 }, (_, index) => `<a href="/p${index}">P${index}</a>`).join("");
    const dependencies = fakeDependencies({ "https://acme.test/": page("Acme", links) });

    const result = await crawlSite("https://acme.test/", dependencies, {
      budgets: budgets({ maxLinksPerPage: 5, maxPages: 1 }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tracker.completenessReasons).toContain("link_budget_reached");
  });

  it("marks byte truncation as partial", async () => {
    const big = `<html><head><title>Big</title></head><body>${"x".repeat(20_000)}</body></html>`;
    const dependencies = fakeDependencies({ "https://acme.test/": htmlResponse(big) });

    const result = await crawlSite("https://acme.test/", dependencies, {
      budgets: budgets({ maxBytesPerPage: 1000, maxTotalBytes: 5000 }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tracker.completenessReasons).toContain("byte_budget_reached");
  });
});

describe("crawlSite — robots.txt", () => {
  it("skips paths disallowed for our user agent", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/robots.txt": textResponse("User-agent: *\nDisallow: /admin\n"),
      "https://acme.test/": page("Acme", '<a href="/admin">Admin</a><a href="/pricing">Pricing</a>'),
      "https://acme.test/admin": page("Admin"),
      "https://acme.test/pricing": page("Pricing"),
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((item) => item.finalPath).sort()).toEqual(["/", "/pricing"]);
    expect(dependencies.transport.requestedUrls.some((url) => url.endsWith("/admin"))).toBe(false);
    expect(result.tracker.completenessReasons).toContain("robots_disallowed");
  });

  it("honours a group naming our crawler over the wildcard group", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/robots.txt": textResponse(
        "User-agent: *\nDisallow: /\n\nUser-agent: VibeBusinessBot\nDisallow:\n",
      ),
      "https://acme.test/": page("Acme", '<a href="/pricing">Pricing</a>'),
      "https://acme.test/pricing": page("Pricing"),
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((item) => item.finalPath).sort()).toEqual(["/", "/pricing"]);
  });

  it("stops after the homepage when robots blanket-disallows crawlers", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/robots.txt": textResponse("User-agent: *\nDisallow: /\n"),
      "https://acme.test/": page("Acme", '<a href="/pricing">Pricing</a>'),
      "https://acme.test/pricing": page("Pricing"),
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((item) => item.finalPath)).toEqual(["/"]);
    expect(result.warnings.some((warning) => warning.code === "robots_disallowed")).toBe(true);
    expect(dependencies.transport.requestedUrls.some((url) => url.endsWith("/pricing"))).toBe(false);
  });

  it("treats a missing robots.txt as no restrictions", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/": page("Acme", '<a href="/pricing">Pricing</a>'),
      "https://acme.test/pricing": page("Pricing"),
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.robots.exists).toBe(false);
    expect(result.pages).toHaveLength(2);
  });
});

describe("crawlSite — sitemap", () => {
  it("discovers pages through a sitemap referenced by robots.txt", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/robots.txt": textResponse("Sitemap: https://acme.test/sitemap.xml\n"),
      "https://acme.test/sitemap.xml": xmlResponse(
        `<urlset><url><loc>https://acme.test/pricing</loc></url><url><loc>https://acme.test/contact</loc></url></urlset>`,
      ),
      "https://acme.test/": page("Acme"),
      "https://acme.test/pricing": page("Pricing"),
      "https://acme.test/contact": page("Contact"),
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sitemapPresent).toBe(true);
    expect(result.pages.map((item) => item.finalPath).sort()).toEqual(["/", "/contact", "/pricing"]);
  });

  it("ignores sitemap entries pointing at another origin", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/sitemap.xml": xmlResponse(
        `<urlset><url><loc>https://evil.test/x</loc></url><url><loc>https://acme.test/ok</loc></url></urlset>`,
      ),
      "https://acme.test/": page("Acme"),
      "https://acme.test/ok": page("OK"),
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    expect(dependencies.transport.requestedUrls.some((url) => url.includes("evil.test"))).toBe(false);
  });

  it("reads a sitemap index only one level deep", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/sitemap.xml": xmlResponse(
        `<sitemapindex><sitemap><loc>https://acme.test/sitemap-1.xml</loc></sitemap></sitemapindex>`,
      ),
      "https://acme.test/sitemap-1.xml": xmlResponse(
        `<sitemapindex><sitemap><loc>https://acme.test/sitemap-2.xml</loc></sitemap></sitemapindex>`,
      ),
      "https://acme.test/": page("Acme"),
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    // The nested index is never opened.
    expect(dependencies.transport.requestedUrls.some((url) => url.includes("sitemap-2"))).toBe(false);
  });
});

describe("crawlSite — failures", () => {
  it("reports an unreachable homepage as a typed failure", async () => {
    const dependencies = fakeDependencies({ "https://acme.test/": { fail: "connection_failed" } });
    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });
    expect(result).toEqual({ ok: false, error: "homepage_unreachable" });
  });

  it("reports a TLS failure distinctly", async () => {
    const dependencies = fakeDependencies({ "https://acme.test/": { fail: "tls_error" } });
    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });
    expect(result).toEqual({ ok: false, error: "tls_error" });
  });

  it("notes rate limiting without failing the whole crawl", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/": page("Acme", '<a href="/pricing">Pricing</a>'),
      "https://acme.test/pricing": { status: 429, headers: { "retry-after": "60" } },
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tracker.completenessReasons).toContain("rate_limited");
    expect(result.pages.map((item) => item.finalPath)).toEqual(["/"]);
  });

  it("skips a non-HTML page without failing the crawl", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/": page("Acme", '<a href="/report">Report</a>'),
      "https://acme.test/report": { status: 200, headers: { "content-type": "application/pdf" }, body: "%PDF" },
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((item) => item.finalPath)).toEqual(["/"]);
  });

  it("prioritises high-value surfaces when the page budget is tight", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/": htmlResponse(
        `<html><head><title>Acme</title></head><body>
           <a href="/blog/post-1">Post 1</a>
           <a href="/blog/post-2">Post 2</a>
           <a href="/pricing">Pricing</a>
         </body></html>`,
      ),
      "https://acme.test/pricing": page("Pricing"),
      "https://acme.test/blog/post-1": page("Post 1"),
      "https://acme.test/blog/post-2": page("Post 2"),
    });

    const result = await crawlSite("https://acme.test/", dependencies, {
      budgets: budgets({ maxPages: 2 }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((item) => item.finalPath).sort()).toEqual(["/", "/pricing"]);
  });

  it("uses the landing page fixture end to end", async () => {
    const dependencies = fakeDependencies({
      "https://acme.test/": htmlResponse(landingPageHtml()),
      "https://acme.test/pricing": page("Pricing"),
      "https://acme.test/login": page("Log in"),
      "https://acme.test/signup": page("Sign up"),
      "https://acme.test/privacy": page("Privacy"),
      "https://acme.test/terms": page("Terms"),
    });

    const result = await crawlSite("https://acme.test/", dependencies, { budgets: budgets() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.length).toBeGreaterThan(3);
    expect(result.discoveredPaths).toContain("/pricing");
  });
});
