import { describe, expect, it, vi } from "vitest";

import { analyzeAuthenticatedProduct, selectAuthenticatedPage, type AnalysisBrowserPort, type AnalysisPagePort } from "./analyzer";
import { DEFAULT_AUTHENTICATED_BUDGETS } from "./budgets";
import type { RawPageExtraction } from "./extract";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";

const ORIGIN = "https://app.example.com";

function extraction(overrides: Partial<RawPageExtraction> = {}): RawPageExtraction {
  return {
    title: "App",
    mainHeading: "Overview",
    headingCount: 2,
    navLabels: ["Dashboard", "Settings"],
    actionLabels: ["New project"],
    formCount: 0,
    formFieldTypes: [],
    tableCount: 0,
    rowCount: 0,
    emptyStateLabels: [],
    sameOriginLinks: [],
    hasAppShell: true,
    ...overrides,
  };
}

/** A fake browser: one tab whose URL follows navigation, plus block counters. */
function fakeBrowser(options: {
  urls?: string[];
  extractionFor?: (path: string) => RawPageExtraction;
  blocked?: Partial<AnalysisBrowserPort["blocked"]>;
  gotoImpl?: (url: string) => Promise<{ status: number | null }>;
} = {}) {
  let current = options.urls?.[0] ?? `${ORIGIN}/app`;
  const visited: string[] = [];

  const page: AnalysisPagePort = {
    url: () => current,
    goto: vi.fn(async (url: string) => {
      visited.push(url);
      if (options.gotoImpl) return options.gotoImpl(url);
      current = url;
      return { status: 200 };
    }),
    extract: vi.fn(async () => {
      const path = new URL(current).pathname;
      return options.extractionFor ? options.extractionFor(path) : extraction();
    }),
  };

  const extraTabs = (options.urls ?? []).slice(1).map<AnalysisPagePort>((url) => ({
    url: () => url,
    goto: vi.fn(async () => ({ status: 200 })),
    extract: vi.fn(async () => extraction()),
  }));

  const browser: AnalysisBrowserPort & { visited: string[] } = {
    pages: async () => [page, ...extraTabs],
    blocked: { mutatingRequests: 0, downloads: 0, externalNavigations: 0, ...options.blocked },
    visited,
  };

  return { browser, page, visited };
}

function repositoryWith(paths: string[]): RepositoryIntelligenceSnapshot {
  return {
    routes: {
      mode: "app_router",
      truncated: false,
      routes: paths.map((path) => ({ path, kind: "page", dynamic: false, sourcePath: `src/app${path}/page.tsx` })),
    },
  } as unknown as RepositoryIntelligenceSnapshot;
}

function publicWith(pages: { path: string; redirectedTo: string | null }[]): LiveProductIntelligenceSnapshot {
  return { pages: pages.map((page) => ({ ...page, status: 200 })) } as unknown as LiveProductIntelligenceSnapshot;
}

const baseInput = {
  origin: ORIGIN,
  sessionId: "vibe-session-1",
  browserProvider: "browserbase",
  repository: null,
  publicProduct: null,
};

describe("selectAuthenticatedPage", () => {
  it("selects the tab on the configured origin", async () => {
    const { browser } = fakeBrowser({ urls: [`${ORIGIN}/app`] });
    const selected = await selectAuthenticatedPage(browser, ORIGIN);

    expect(selected).not.toBeNull();
    expect(selected!.path).toBe("/app");
    expect(selected!.ignoredTabCount).toBe(0);
  });

  it("ignores OAuth and unrelated tabs rather than analysing them", async () => {
    const { browser } = fakeBrowser({
      urls: [
        "https://accounts.google.com/o/oauth2/consent",
        `${ORIGIN}/app`,
        "https://github.com/login/oauth/authorize",
      ],
    });

    const selected = await selectAuthenticatedPage(browser, ORIGIN);
    // The first tab is an identity provider; it must not become the target.
    expect(selected!.path).toBe("/app");
    expect(selected!.ignoredTabCount).toBe(2);
  });

  it("returns null when no tab reached the product origin", async () => {
    const { browser } = fakeBrowser({ urls: ["https://accounts.google.com/signin"] });
    expect(await selectAuthenticatedPage(browser, ORIGIN)).toBeNull();
  });
});

describe("analyzeAuthenticatedProduct", () => {
  it("fails with authenticated_origin_not_reached when login did not land on the product", async () => {
    const { browser } = fakeBrowser({ urls: ["https://accounts.google.com/signin"] });
    const result = await analyzeAuthenticatedProduct({ ...baseInput, browser });

    expect(result).toEqual({ ok: false, error: "authenticated_origin_not_reached" });
  });

  it("analyses the landing page without re-navigating to it", async () => {
    const { browser, page } = fakeBrowser({ urls: [`${ORIGIN}/app`] });
    const result = await analyzeAuthenticatedProduct({ ...baseInput, browser });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.pages).toHaveLength(1);
    expect(result.snapshot.session.landingPath).toBe("/app");
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("resolves the Sprint 3 limitation: an unlinked /app is analysed while authenticated", async () => {
    const { browser } = fakeBrowser({ urls: [`${ORIGIN}/app`] });
    const result = await analyzeAuthenticatedProduct({
      ...baseInput,
      browser,
      // Exactly what the public crawl recorded: /app bounced to /login.
      publicProduct: publicWith([
        { path: "/", redirectedTo: null },
        { path: "/app", redirectedTo: "/login" },
      ]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.pages.map((page) => page.path)).toContain("/app");
    expect(result.snapshot.applicationSignals.authenticatedAreaReached).toBe(true);
  });

  it("visits repository-derived routes and records their evidence source", async () => {
    const { browser, visited } = fakeBrowser({ urls: [`${ORIGIN}/app`] });
    const result = await analyzeAuthenticatedProduct({
      ...baseInput,
      browser,
      repository: repositoryWith(["/app/settings", "/app/onboarding"]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(visited).toContain(`${ORIGIN}/app/settings`);
    expect(visited).toContain(`${ORIGIN}/app/onboarding`);
    expect(result.snapshot.crawl.candidateSources.repository_route).toBeGreaterThanOrEqual(2);
    expect(result.snapshot.productSurfaces.find((s) => s.id === "settings")!.detected).toBe(true);
  });

  it("never navigates off-origin, even when links point elsewhere", async () => {
    const { browser, visited } = fakeBrowser({
      urls: [`${ORIGIN}/app`],
      extractionFor: () =>
        extraction({
          sameOriginLinks: [
            "https://accounts.google.com/signin",
            "https://stripe.com/billing",
            `${ORIGIN}/app/settings`,
          ],
        }),
    });

    const result = await analyzeAuthenticatedProduct({ ...baseInput, browser });
    expect(result.ok).toBe(true);
    for (const url of visited) {
      expect(new URL(url).origin).toBe(ORIGIN);
    }
    expect(visited.some((url) => url.includes("google.com") || url.includes("stripe.com"))).toBe(false);
  });

  it("never navigates to logout, which would end the session under analysis", async () => {
    const { browser, visited } = fakeBrowser({
      urls: [`${ORIGIN}/app`],
      extractionFor: () => extraction({ sameOriginLinks: [`${ORIGIN}/logout`, `${ORIGIN}/app/settings`] }),
    });

    await analyzeAuthenticatedProduct({ ...baseInput, browser });
    expect(visited.some((url) => url.includes("logout"))).toBe(false);
  });

  it("skips a page that redirected off-origin mid-analysis", async () => {
    let current = `${ORIGIN}/app`;
    const page: AnalysisPagePort = {
      url: () => current,
      goto: vi.fn(async (url: string) => {
        // The app bounces this route to an identity provider.
        current = url.includes("settings") ? "https://accounts.google.com/reauth" : url;
        return { status: 200 };
      }),
      extract: vi.fn(async () => extraction()),
    };
    const browser: AnalysisBrowserPort = {
      pages: async () => [page],
      blocked: { mutatingRequests: 0, downloads: 0, externalNavigations: 0 },
    };

    const result = await analyzeAuthenticatedProduct({
      ...baseInput,
      browser,
      repository: repositoryWith(["/app/settings"]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.pages.map((p) => p.path)).not.toContain("/app/settings");
    expect(result.snapshot.warnings.map((w) => w.code)).toContain("external_navigation_blocked");
  });

  it("reports blocked mutations honestly instead of claiming a complete analysis", async () => {
    const { browser } = fakeBrowser({
      urls: [`${ORIGIN}/app`],
      blocked: { mutatingRequests: 3 },
    });

    const result = await analyzeAuthenticatedProduct({ ...baseInput, browser });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const codes = result.snapshot.warnings.map((warning) => warning.code);
    expect(codes).toContain("non_get_request_blocked");
    expect(codes).toContain("application_requires_mutating_method_for_render");
    expect(result.snapshot.completeness.status).toBe("partial");
    expect(result.snapshot.completeness.reasons).toContain("mutation_blocked");
  });

  it("reports blocked downloads", async () => {
    const { browser } = fakeBrowser({ urls: [`${ORIGIN}/app`], blocked: { downloads: 2 } });
    const result = await analyzeAuthenticatedProduct({ ...baseInput, browser });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.warnings.map((w) => w.code)).toContain("download_blocked");
  });

  it("honours the page budget and degrades to partial", async () => {
    const { browser } = fakeBrowser({ urls: [`${ORIGIN}/app`] });
    const result = await analyzeAuthenticatedProduct({
      ...baseInput,
      browser,
      repository: repositoryWith(["/app/a", "/app/b", "/app/c", "/app/d", "/app/e"]),
      budgets: { ...DEFAULT_AUTHENTICATED_BUDGETS, maxPages: 2 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.pages).toHaveLength(2);
    expect(result.snapshot.completeness.status).toBe("partial");
    expect(result.snapshot.completeness.reasons).toContain("page_budget_reached");
  });

  it("stops when the duration budget is exhausted", async () => {
    let clock = 0;
    const { browser } = fakeBrowser({ urls: [`${ORIGIN}/app`] });

    const result = await analyzeAuthenticatedProduct({
      ...baseInput,
      browser,
      repository: repositoryWith(["/app/a", "/app/b", "/app/c"]),
      budgets: { ...DEFAULT_AUTHENTICATED_BUDGETS, maxDurationMs: 50 },
      now: () => (clock += 30),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.completeness.reasons).toContain("timeout");
  });

  it("persists no authentication material, raw DOM, or capability URL", async () => {
    const { browser } = fakeBrowser({
      urls: [`${ORIGIN}/app`],
      extractionFor: () =>
        ({
          ...extraction(),
          html: "<html>secret</html>",
          cookies: "session=abc123",
          connectUrl: "wss://connect.browserbase.com/?signingKey=SECRET",
        }) as unknown as RawPageExtraction,
    });

    const result = await analyzeAuthenticatedProduct({ ...baseInput, browser });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.snapshot);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("session=abc123");
    expect(serialized).not.toContain("signingKey");
    expect(serialized).not.toContain("browserbase.com");
    // Vibe's own session id is present; the provider's is not exposed here.
    expect(result.snapshot.session.sessionId).toBe("vibe-session-1");
  });

  it("records only structural facts, never record contents", async () => {
    const { browser } = fakeBrowser({
      urls: [`${ORIGIN}/app`],
      extractionFor: () =>
        extraction({
          tableCount: 1,
          rowCount: 12,
          // A real customer's data, as a page would render it.
          actionLabels: ["Open ACME Corp — $12,381.00 MRR"],
        }),
    });

    const result = await analyzeAuthenticatedProduct({ ...baseInput, browser });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The structural fact is kept…
    expect(result.snapshot.applicationSignals.dataTablePresent).toBe(true);
    // …and no row contents are stored anywhere.
    expect(JSON.stringify(result.snapshot.pages[0]!.tableCount)).toBe("1");
    expect(result.snapshot.pages[0]).not.toHaveProperty("rows");
  });
});

/**
 * Regression from the first real Deep Scan.
 *
 * `/app/connect/github/repositories` was inspected twice — once reached via an
 * authenticated link (200) and once as a repository-route candidate (404) —
 * producing a duplicate page entry, a wasted page from the budget, and the same
 * surface evidence counted twice.
 *
 * Cause: `visited` was keyed on the candidate path, while the page summary
 * records the path actually landed on. A redirect therefore left the landed
 * path unmarked, so a later candidate for it looked fresh.
 */
describe("analyzeAuthenticatedProduct — a redirect must not cause a second visit", () => {
  /** A tab that honours a redirect map, so landed path can differ from requested. */
  function redirectingBrowser(redirects: Record<string, string>, links: string[]) {
    let current = `${ORIGIN}/app`;
    const requested: string[] = [];

    const page: AnalysisPagePort = {
      url: () => current,
      goto: async (url: string) => {
        requested.push(new URL(url).pathname);
        const path = new URL(url).pathname;
        current = `${ORIGIN}${redirects[path] ?? path}`;
        return { status: 200 };
      },
      extract: async () => extraction({ sameOriginLinks: links }),
    };

    const browser: AnalysisBrowserPort = {
      pages: async () => [page],
      blocked: { mutatingRequests: 0, downloads: 0, externalNavigations: 0 },
    };

    return { browser, requested };
  }

  it("does not record a path twice when a candidate redirects onto another candidate", async () => {
    const { browser } = redirectingBrowser(
      { "/app/profile": "/app/settings" },
      [`${ORIGIN}/app/profile`, `${ORIGIN}/app/settings`],
    );

    const result = await analyzeAuthenticatedProduct({ ...baseInput, browser });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paths = result.snapshot.pages.map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((path) => path === "/app/settings")).toHaveLength(1);
  });

  it("inspects a path once when two independent sources offer it", async () => {
    const { browser } = redirectingBrowser({}, [`${ORIGIN}/app/billing`]);

    const result = await analyzeAuthenticatedProduct({
      ...baseInput,
      browser,
      // Offered as a repository route *and* discovered as a link.
      repository: repositoryWith(["/app/billing"]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paths = result.snapshot.pages.map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
