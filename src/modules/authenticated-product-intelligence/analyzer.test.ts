import { describe, expect, it, vi } from "vitest";

import { analyzeAuthenticatedProduct, selectAuthenticatedPage, type AnalysisBrowserPort, type AnalysisPagePort } from "./analyzer";
import { DEFAULT_AUTHENTICATED_BUDGETS } from "./budgets";
import { routeShape } from "./routes";
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
    settle: vi.fn(async () => undefined),
    extract: vi.fn(async () => {
      const path = new URL(current).pathname;
      return options.extractionFor ? options.extractionFor(path) : extraction();
    }),
  };

  const extraTabs = (options.urls ?? []).slice(1).map<AnalysisPagePort>((url) => ({
    url: () => url,
    goto: vi.fn(async () => ({ status: 200 })),
    settle: vi.fn(async () => undefined),
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
      settle: async () => undefined,
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
      settle: async () => undefined,
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

/*
 * A real scan reported eighteen unreachable pages and inspected one. Every
 * message was the same shape:
 *
 *   page.goto: Navigation to ".../plan" is interrupted by
 *              another navigation to ".../app"
 *
 * The app routes on its own after `goto` resolves — an auth check, a canonical
 * redirect — and that late navigation aborts the *next* one. Each page was
 * killed by the page before it, so a single interruption emptied the rest of
 * the crawl.
 */
describe("analyzeAuthenticatedProduct — a single-page app interrupting its own navigation", () => {
  function interruptingBrowser(interruptOnce: Set<string>) {
    let current = `${ORIGIN}/app`;
    const attempts: string[] = [];

    const page: AnalysisPagePort = {
      url: () => current,
      goto: async (url: string) => {
        const path = new URL(url).pathname;
        attempts.push(path);
        if (interruptOnce.has(path)) {
          interruptOnce.delete(path);
          throw new Error(
            `page.goto: Navigation to "${url}" is interrupted by another navigation to "${ORIGIN}/app"`,
          );
        }
        current = url;
        return { status: 200 };
      },
      settle: async () => undefined,
      extract: async () => extraction(),
    };

    const browser: AnalysisBrowserPort = {
      pages: async () => [page],
      blocked: { mutatingRequests: 0, downloads: 0, externalNavigations: 0 },
    };

    return { browser, attempts };
  }

  it("retries the interrupted navigation once and reads the page", async () => {
    const { browser, attempts } = interruptingBrowser(new Set(["/app/plan"]));

    const result = await analyzeAuthenticatedProduct({
      ...baseInput,
      browser,
      repository: repositoryWith(["/app/plan"]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(attempts.filter((path) => path === "/app/plan")).toHaveLength(2);
    expect(result.snapshot.pages.map((page) => page.path)).toContain("/app/plan");
  });

  it("does not retry a genuine navigation failure", async () => {
    let attempts = 0;
    let current = `${ORIGIN}/app`;

    const page: AnalysisPagePort = {
      url: () => current,
      goto: async (url: string) => {
        const path = new URL(url).pathname;
        if (path === "/app/plan") {
          attempts += 1;
          throw new Error("page.goto: Timeout 15000ms exceeded");
        }
        current = url;
        return { status: 200 };
      },
      settle: async () => undefined,
      extract: async () => extraction(),
    };

    const result = await analyzeAuthenticatedProduct({
      ...baseInput,
      browser: {
        pages: async () => [page],
        blocked: { mutatingRequests: 0, downloads: 0, externalNavigations: 0 },
      },
      repository: repositoryWith(["/app/plan"]),
    });

    expect(result.ok).toBe(true);
    // A retry loop would turn an unreachable page into a budget spent on it.
    expect(attempts).toBe(1);
  });
});

/*
 * The founder's instruction, after watching a 25-page budget go on `/`,
 * `/privacy`, `/terms`, `/forgot-password` and `/reset-password`:
 *
 *   "er sollte auf keinen fall die public sites lesen die ohne Login möglich
 *    sind das machen wir schon mit dem live product scan"
 *
 * Those paths arrived as links in the signed-in shell's own footer, which is
 * why the exclusion has to live here and not only in `buildRouteCandidates`.
 */
describe("analyzeAuthenticatedProduct — pages the public scan already read", () => {
  it("does not spend a page visit on a link the public crawl rendered anonymously", async () => {
    let current = `${ORIGIN}/app`;
    const visited: string[] = [];

    const page: AnalysisPagePort = {
      url: () => current,
      goto: async (url: string) => {
        visited.push(new URL(url).pathname);
        current = url;
        return { status: 200 };
      },
      settle: async () => undefined,
      extract: async () =>
        extraction({ sameOriginLinks: [`${ORIGIN}/privacy`, `${ORIGIN}/app/settings`] }),
    };

    const result = await analyzeAuthenticatedProduct({
      ...baseInput,
      browser: {
        pages: async () => [page],
        blocked: { mutatingRequests: 0, downloads: 0, externalNavigations: 0 },
      },
      publicProduct: publicWith([{ path: "/privacy", redirectedTo: null }]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(visited).not.toContain("/privacy");
    expect(visited).toContain("/app/settings");
    expect(result.snapshot.pages.map((entry) => entry.path)).not.toContain("/privacy");
  });

  it("still inspects a path the public crawl saw bounce to a login page", async () => {
    const { browser, visited } = fakeBrowser();

    const result = await analyzeAuthenticatedProduct({
      ...baseInput,
      browser,
      publicProduct: publicWith([{ path: "/app/reports", redirectedTo: "/login" }]),
    });

    expect(result.ok).toBe(true);
    expect(visited.map((url) => new URL(url).pathname)).toContain("/app/reports");
  });
});

/*
 * The wait the whole loop was missing.
 *
 * A run inspected **one** page of sixteen. Every other failure named the page
 * before it: "Execution context was destroyed" when Vibe read, "interrupted by
 * another navigation" when it moved on. The founder described it exactly —
 * "er liest nicht sondern springt im Sekundentakt" — because a single-page
 * application answers `goto` when the document exists and then keeps routing:
 * an auth check, a canonical redirect, a shell replacing the URL once its data
 * lands. Reading and navigating both landed inside that window.
 *
 * The first attempt at a fix retried the interrupted navigation immediately,
 * and the production message changed from "interrupted by … /app" to
 * "interrupted by … /plan" — the same URL, the second attempt now aborted by
 * the tail of the first. Retrying without settling is the same collision one
 * step later, which is why these tests assert *order*, not counts.
 */
describe("analyzeAuthenticatedProduct — a page is let go still before it is read", () => {
  /** A tab that behaves like a framework: it is unreadable until it settles. */
  function routingBrowser(options: { interrupt?: Set<string> } = {}) {
    const interrupt = options.interrupt ?? new Set<string>();
    let current = `${ORIGIN}/app`;
    let settled = true;
    const order: string[] = [];

    const page: AnalysisPagePort = {
      url: () => current,
      goto: async (url: string) => {
        const path = new URL(url).pathname;
        order.push(`goto ${path}`);
        if (interrupt.has(path)) {
          interrupt.delete(path);
          settled = false;
          throw new Error(
            `page.goto: Navigation to "${url}" is interrupted by another navigation to "${url}"`,
          );
        }
        current = url;
        // The document exists; the application has not finished with it.
        settled = false;
        return { status: 200 };
      },
      settle: async () => {
        order.push("settle");
        settled = true;
      },
      extract: async () => {
        order.push("extract");
        if (!settled) {
          throw new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation");
        }
        return extraction();
      },
    };

    return {
      browser: {
        pages: async () => [page],
        blocked: { mutatingRequests: 0, downloads: 0, externalNavigations: 0 },
      } satisfies AnalysisBrowserPort,
      order,
    };
  }

  it("settles every page before reading it", async () => {
    const { browser, order } = routingBrowser();

    const result = await analyzeAuthenticatedProduct({
      ...baseInput,
      browser,
      repository: repositoryWith(["/app/settings", "/app/billing"]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The point of the fake: an unsettled read throws, so a page in the
    // snapshot is a page that was let go still first.
    expect(result.snapshot.pages.map((page) => page.path)).toEqual(
      expect.arrayContaining(["/app", "/app/settings", "/app/billing"]),
    );
    expect(result.snapshot.warnings.filter((w) => w.code === "page_unreachable")).toHaveLength(0);

    // Never `extract` straight after `goto`.
    for (let i = 0; i < order.length - 1; i += 1) {
      if (order[i]!.startsWith("goto")) expect(order[i + 1]).toBe("settle");
    }
  });

  it("settles before retrying an interrupted navigation, not immediately", async () => {
    const { browser, order } = routingBrowser({ interrupt: new Set(["/app/settings"]) });

    const result = await analyzeAuthenticatedProduct({
      ...baseInput,
      browser,
      repository: repositoryWith(["/app/settings"]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const settings = order.indexOf("goto /app/settings");
    expect(settings).toBeGreaterThanOrEqual(0);
    // The retry waits for the interrupting navigation instead of racing it.
    expect(order.slice(settings, settings + 3)).toEqual([
      "goto /app/settings",
      "settle",
      "goto /app/settings",
    ]);
    expect(result.snapshot.pages.map((page) => page.path)).toContain("/app/settings");
  });

  it("reads the path the application chose, not the one it was sent to", async () => {
    // An application that redirects itself after `goto` returns has not
    // finished choosing its URL. Reading `page.url()` before settling records
    // the wrong path — and marks the wrong one visited.
    let current = `${ORIGIN}/app`;
    let redirecting = false;

    const page: AnalysisPagePort = {
      url: () => current,
      goto: async (url: string) => {
        current = url;
        redirecting = new URL(url).pathname === "/app/settings";
        return { status: 200 };
      },
      settle: async () => {
        if (redirecting) {
          current = `${ORIGIN}/app/settings/profile`;
          redirecting = false;
        }
      },
      extract: async () => extraction(),
    };

    const result = await analyzeAuthenticatedProduct({
      ...baseInput,
      browser: {
        pages: async () => [page],
        blocked: { mutatingRequests: 0, downloads: 0, externalNavigations: 0 },
      },
      repository: repositoryWith(["/app/settings"]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paths = result.snapshot.pages.map((entry) => entry.path);
    expect(paths).toContain("/app/settings/profile");
    expect(paths).not.toContain("/app/settings");
  });
});

/*
 * The run that finally read pages properly, reproduced.
 *
 * Snapshot `97cecfa7`: 25 pages inspected, 106 seconds, no navigation failure
 * — and **8 screens**. Four projects × seven workspace tabs filled the budget,
 * so `/app/billing`, `/app/settings`, `/app/products`, `/app/onboarding` and
 * `/app/connect/github` were never reached, and the snapshot reported
 * `integrations` and `onboarding` as *not detected*. That is a scan answering
 * a question about the product with a fact about its own budget.
 */
describe("analyzeAuthenticatedProduct — a screen is worth a page, a copy of it is not", () => {
  const PROJECTS = [
    "88d1c463-74f4-43a4-b2ce-8b58cfdfbb4b",
    "9b702a96-7863-4c29-8ece-c0055bfac24f",
    "b95779dc-73ca-40d8-bc60-40878d079ca7",
    "c0c9bec0-519d-43a3-89ac-78bb9216557e",
  ];
  const TABS = ["", "/agent", "/experiments", "/health", "/plan", "/product", "/settings"];
  const SINGLETONS = [
    "/app/billing",
    "/app/settings",
    "/app/products",
    "/app/onboarding",
    "/app/connect/github",
  ];

  /** The shell links to every project tab and to the account-level screens. */
  function workspaceBrowser() {
    let current = `${ORIGIN}/app`;
    const visited: string[] = [];
    const links = [
      ...PROJECTS.flatMap((id) => TABS.map((tab) => `${ORIGIN}/app/projects/${id}${tab}`)),
      ...SINGLETONS.map((path) => `${ORIGIN}${path}`),
    ];

    const page: AnalysisPagePort = {
      url: () => current,
      goto: async (url: string) => {
        visited.push(new URL(url).pathname);
        current = url;
        return { status: 200 };
      },
      settle: async () => undefined,
      extract: async () => extraction({ sameOriginLinks: links }),
    };

    return {
      browser: {
        pages: async () => [page],
        blocked: { mutatingRequests: 0, downloads: 0, externalNavigations: 0 },
      } satisfies AnalysisBrowserPort,
      visited,
    };
  }

  it("reads two of a repeated screen and spends the rest on screens it has not seen", async () => {
    const { browser } = workspaceBrowser();

    const result = await analyzeAuthenticatedProduct({ ...baseInput, browser });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paths = result.snapshot.pages.map((page) => page.path);
    const shapes = new Map<string, number>();
    for (const path of paths) {
      const shape = routeShape(path);
      shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    }

    // No template is read more than the budget allows.
    for (const [shape, count] of shapes) {
      expect(count, shape).toBeLessThanOrEqual(DEFAULT_AUTHENTICATED_BUDGETS.maxPagesPerRouteShape);
    }

    // And the pages that were freed went to the screens the real run missed.
    for (const path of SINGLETONS) {
      expect(paths, `${path} should have been reached`).toContain(path);
    }
  });

  it("says the product has more copies than it looked at", async () => {
    const { browser } = workspaceBrowser();

    const result = await analyzeAuthenticatedProduct({ ...baseInput, browser });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const repeated = result.snapshot.warnings.filter((w) => w.code === "repeated_screen_skipped");
    // Once, with a count — not one warning per skipped page.
    expect(repeated).toHaveLength(1);
    expect(repeated[0]!.message).toMatch(/screen\(s\) exist in more copies/);
  });

  it("never spends a navigation on a copy it is going to skip", async () => {
    const { browser, visited } = workspaceBrowser();

    const result = await analyzeAuthenticatedProduct({ ...baseInput, browser });
    expect(result.ok).toBe(true);

    const perShape = new Map<string, number>();
    for (const path of visited) {
      const shape = routeShape(path);
      perShape.set(shape, (perShape.get(shape) ?? 0) + 1);
    }
    for (const [shape, count] of perShape) {
      expect(count, shape).toBeLessThanOrEqual(DEFAULT_AUTHENTICATED_BUDGETS.maxPagesPerRouteShape);
    }
  });

  it("does not let a page that failed to load hold a slot", async () => {
    // A screen read zero times has taught us nothing, so the next instance of
    // it is still worth a page.
    let current = `${ORIGIN}/app`;
    const read: string[] = [];
    const broken = `${ORIGIN}/app/projects/${PROJECTS[0]}/settings`;

    const page: AnalysisPagePort = {
      url: () => current,
      goto: async (url: string) => {
        if (url === broken) throw new Error("page.goto: Timeout 15000ms exceeded");
        current = url;
        return { status: 200 };
      },
      settle: async () => undefined,
      extract: async () => {
        read.push(new URL(current).pathname);
        return extraction({
          sameOriginLinks: PROJECTS.map((id) => `${ORIGIN}/app/projects/${id}/settings`),
        });
      },
    };

    const result = await analyzeAuthenticatedProduct({
      ...baseInput,
      browser: {
        pages: async () => [page],
        blocked: { mutatingRequests: 0, downloads: 0, externalNavigations: 0 },
      },
    });

    expect(result.ok).toBe(true);
    const settings = read.filter((path) => path.endsWith("/settings"));
    expect(settings).toHaveLength(DEFAULT_AUTHENTICATED_BUDGETS.maxPagesPerRouteShape);
    expect(settings).not.toContain(new URL(broken).pathname);
  });
});
