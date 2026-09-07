import { describe, expect, it } from "vitest";

import { DEFAULT_AUTHENTICATED_BUDGETS } from "./budgets";
import {
  buildRouteCandidates,
  extendCandidates,
  isNeverVisit,
  isSafeAnalysisTarget,
  routeShape,
  toSameOriginPath,
} from "./routes";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";

const ORIGIN = "https://app.example.com";

function repositoryWith(routes: { path: string; kind: "page" | "api" | "layout"; dynamic: boolean }[]) {
  return {
    routes: {
      mode: "app_router",
      truncated: false,
      routes: routes.map((route) => ({ ...route, sourcePath: `src/app${route.path}/page.tsx` })),
    },
  } as unknown as RepositoryIntelligenceSnapshot;
}

function publicWith(pages: { path: string; redirectedTo: string | null }[]) {
  return {
    pages: pages.map((page) => ({ ...page, status: 200 })),
  } as unknown as LiveProductIntelligenceSnapshot;
}

describe("toSameOriginPath", () => {
  it("accepts a same-origin absolute url and returns its pathname", () => {
    expect(toSameOriginPath("https://app.example.com/dashboard", ORIGIN)).toBe("/dashboard");
  });

  it("resolves a relative path against the configured origin", () => {
    expect(toSameOriginPath("/settings/billing", ORIGIN)).toBe("/settings/billing");
  });

  it("strips query strings and fragments, which carry tokens and emails", () => {
    expect(toSameOriginPath("/invite?token=abc123&email=a@b.com#x", ORIGIN)).toBe("/invite");
  });

  it("rejects a different origin, including a subdomain and a lookalike", () => {
    expect(toSameOriginPath("https://evil.example.com/app", ORIGIN)).toBeNull();
    expect(toSameOriginPath("https://app.example.com.evil.com/app", ORIGIN)).toBeNull();
    expect(toSameOriginPath("https://api.app.example.com/app", ORIGIN)).toBeNull();
  });

  it("rejects a different port and scheme", () => {
    expect(toSameOriginPath("https://app.example.com:8443/app", ORIGIN)).toBeNull();
    expect(toSameOriginPath("http://app.example.com/app", ORIGIN)).toBeNull();
  });

  it("rejects non-http schemes outright", () => {
    for (const candidate of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "about:blank"]) {
      expect(toSameOriginPath(candidate, ORIGIN)).toBeNull();
    }
  });

  it("rejects an absurdly long path", () => {
    expect(toSameOriginPath(`/${"a".repeat(600)}`, ORIGIN)).toBeNull();
  });
});

describe("isNeverVisit", () => {
  it("refuses logout, which would destroy the session under analysis", () => {
    for (const path of ["/logout", "/auth/signout", "/account/sign-out", "/log-out"]) {
      expect(isNeverVisit(path)).toBe(true);
    }
  });

  it("refuses auth surfaces and destructive-looking endpoints", () => {
    for (const path of ["/login", "/signup", "/checkout", "/projects/1/delete", "/billing/cancel"]) {
      expect(isNeverVisit(path)).toBe(true);
    }
  });

  it("allows ordinary product surfaces", () => {
    for (const path of ["/app", "/dashboard", "/settings", "/projects", "/onboarding"]) {
      expect(isNeverVisit(path)).toBe(false);
    }
  });
});

describe("isSafeAnalysisTarget", () => {
  it("requires both same-origin and non-forbidden", () => {
    expect(isSafeAnalysisTarget("https://app.example.com/dashboard", ORIGIN)).toBe(true);
    expect(isSafeAnalysisTarget("https://app.example.com/logout", ORIGIN)).toBe(false);
    expect(isSafeAnalysisTarget("https://accounts.google.com/o/oauth2/v2/auth", ORIGIN)).toBe(false);
  });
});

describe("buildRouteCandidates", () => {
  const budgets = DEFAULT_AUTHENTICATED_BUDGETS;

  it("discovers an unlinked /app from the public crawl's login redirect", () => {
    // This is the exact Sprint 3 limitation: /app existed, redirected
    // anonymously to /login, and no public page linked to it.
    const candidates = buildRouteCandidates({
      origin: ORIGIN,
      landingPath: "/app",
      repository: null,
      publicProduct: publicWith([
        { path: "/", redirectedTo: null },
        { path: "/app", redirectedTo: "/login" },
      ]),
      budgets,
    });

    const app = candidates.find((candidate) => candidate.path === "/app");
    expect(app).toBeDefined();
    expect(app!.source).toBe("landing");
  });

  it("marks a protected redirect as its own evidence source when it is not the landing page", () => {
    const candidates = buildRouteCandidates({
      origin: ORIGIN,
      landingPath: "/dashboard",
      repository: null,
      publicProduct: publicWith([{ path: "/app", redirectedTo: "/login" }]),
      budgets,
    });

    expect(candidates.find((c) => c.path === "/app")?.source).toBe("public_protected_redirect");
  });

  it("seeds page routes from repository intelligence", () => {
    const candidates = buildRouteCandidates({
      origin: ORIGIN,
      landingPath: "/app",
      repository: repositoryWith([
        { path: "/app/settings", kind: "page", dynamic: false },
        { path: "/app/onboarding", kind: "page", dynamic: false },
      ]),
      publicProduct: null,
      budgets,
    });

    const paths = candidates.map((candidate) => candidate.path);
    expect(paths).toContain("/app/settings");
    expect(paths).toContain("/app/onboarding");
    for (const path of ["/app/settings", "/app/onboarding"]) {
      expect(candidates.find((c) => c.path === path)!.source).toBe("repository_route");
    }
  });

  it("ignores api and layout routes, and dynamic segments with no safe value", () => {
    const candidates = buildRouteCandidates({
      origin: ORIGIN,
      landingPath: "/app",
      repository: repositoryWith([
        { path: "/api/webhook", kind: "api", dynamic: false },
        { path: "/app/layout", kind: "layout", dynamic: false },
        { path: "/app/projects/[projectId]", kind: "page", dynamic: true },
      ]),
      publicProduct: null,
      budgets,
    });

    const paths = candidates.map((candidate) => candidate.path);
    expect(paths).not.toContain("/api/webhook");
    expect(paths).not.toContain("/app/layout");
    expect(paths.some((path) => path.includes("["))).toBe(false);
  });

  it("never invents a candidate — no evidence means no candidates beyond the landing page", () => {
    const candidates = buildRouteCandidates({
      origin: ORIGIN,
      landingPath: "/app",
      repository: null,
      publicProduct: null,
      budgets,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.path).toBe("/app");
    // The dictionary-probing paths a naive crawler would try.
    const paths = candidates.map((c) => c.path);
    for (const guess of ["/admin", "/private", "/internal", "/secrets", "/dashboard"]) {
      expect(paths).not.toContain(guess);
    }
  });

  it("still applies origin validation to repository-derived candidates", () => {
    const candidates = buildRouteCandidates({
      origin: ORIGIN,
      landingPath: "/app",
      // A repository can declare anything, including an absolute external URL.
      repository: repositoryWith([
        { path: "https://evil.example.com/steal", kind: "page", dynamic: false },
        { path: "/app/ok", kind: "page", dynamic: false },
      ]),
      publicProduct: null,
      budgets,
    });

    const paths = candidates.map((candidate) => candidate.path);
    expect(paths).toContain("/app/ok");
    expect(paths.some((path) => path.includes("evil"))).toBe(false);
  });

  it("drops a repository route that would log the session out", () => {
    const candidates = buildRouteCandidates({
      origin: ORIGIN,
      landingPath: "/app",
      repository: repositoryWith([{ path: "/logout", kind: "page", dynamic: false }]),
      publicProduct: null,
      budgets,
    });

    expect(candidates.map((c) => c.path)).not.toContain("/logout");
  });

  it("orders product-critical surfaces first", () => {
    const candidates = buildRouteCandidates({
      origin: ORIGIN,
      landingPath: "/app",
      repository: repositoryWith([
        { path: "/app/legal/imprint", kind: "page", dynamic: false },
        { path: "/app/settings", kind: "page", dynamic: false },
        { path: "/app/onboarding", kind: "page", dynamic: false },
      ]),
      publicProduct: null,
      budgets,
    });

    const ranked = candidates.map((candidate) => candidate.path);
    expect(ranked.indexOf("/app/onboarding")).toBeLessThan(ranked.indexOf("/app/settings"));
    expect(ranked.indexOf("/app/settings")).toBeLessThan(ranked.indexOf("/app/legal/imprint"));
  });

  it("honours the candidate budget", () => {
    const many = Array.from({ length: 200 }, (_, index) => ({
      path: `/app/page-${index}`,
      kind: "page" as const,
      dynamic: false,
    }));

    const candidates = buildRouteCandidates({
      origin: ORIGIN,
      landingPath: "/app",
      repository: repositoryWith(many),
      publicProduct: null,
      budgets: { ...DEFAULT_AUTHENTICATED_BUDGETS, maxCandidates: 12 },
    });

    expect(candidates.length).toBeLessThanOrEqual(12);
  });
});

describe("extendCandidates", () => {
  const budgets = DEFAULT_AUTHENTICATED_BUDGETS;

  it("adds new same-origin links only", () => {
    const added = extendCandidates(
      [{ path: "/app", source: "landing", depth: 0, priority: 100 }],
      [
        "https://app.example.com/app/settings",
        "https://accounts.google.com/signin",
        "/app",
        "https://twitter.com/product",
      ],
      { origin: ORIGIN, depth: 1, budgets },
    );

    expect(added.map((candidate) => candidate.path)).toEqual(["/app/settings"]);
    expect(added[0]!.source).toBe("authenticated_link");
  });

  it("refuses to go past max depth", () => {
    const added = extendCandidates([], ["/app/deep"], {
      origin: ORIGIN,
      depth: budgets.maxDepth + 1,
      budgets,
    });
    expect(added).toEqual([]);
  });

  it("caps links considered from one page", () => {
    const links = Array.from({ length: 500 }, (_, index) => `/app/l-${index}`);
    const added = extendCandidates([], links, {
      origin: ORIGIN,
      depth: 1,
      budgets: { ...budgets, maxLinksPerPage: 5, maxCandidates: 50 },
    });
    expect(added.length).toBeLessThanOrEqual(5);
  });
});

describe("route priority refinement (Sprint 6 §5)", () => {
  function candidates(input: {
    landingPath?: string;
    repositoryRoutes?: { path: string; kind: "page" | "api" | "layout"; dynamic: boolean }[];
    publicPages?: { path: string; redirectedTo: string | null }[];
  }) {
    return buildRouteCandidates({
      origin: ORIGIN,
      landingPath: input.landingPath ?? "/app",
      repository: repositoryWith(input.repositoryRoutes ?? []),
      publicProduct: publicWith(input.publicPages ?? []),
      budgets: DEFAULT_AUTHENTICATED_BUDGETS,
    });
  }

  it("ranks a path proven to be protected above the same path merely declared in code", () => {
    const protectedFirst = candidates({
      repositoryRoutes: [{ path: "/reports", kind: "page", dynamic: false }],
      publicPages: [{ path: "/insights", redirectedTo: "/login" }],
    });

    const insights = protectedFirst.find((candidate) => candidate.path === "/insights");
    const reports = protectedFirst.find((candidate) => candidate.path === "/reports");

    // Both match the same analytics hint, so only the evidence separates them.
    expect(insights).toBeDefined();
    expect(reports).toBeDefined();
    expect(insights!.priority).toBeGreaterThan(reports!.priority);
    expect(protectedFirst.indexOf(insights!)).toBeLessThan(protectedFirst.indexOf(reports!));
  });

  /*
   * Sprint 6 §5 demoted a page the public crawl had already rendered, and kept
   * it on the list: the signed-in view of `/` is often a different page, so a
   * blanket removal looked like it would throw away real evidence.
   *
   * A measured scan reversed that. It spent pages of a 25-page budget on `/`,
   * `/privacy`, `/terms`, `/forgot-password` and `/reset-password` — pages the
   * live product scan reads already, statically, for no browser seconds and no
   * Credits. The demotion did not prevent it, partly because it only ever
   * applied to repository routes and those paths arrived as links in the
   * signed-in shell's own footer.
   *
   * So a page the public crawl rendered anonymously is now skipped outright.
   * The landing page keeps its exemption, because it is where the browser
   * already is, and it is the one page whose signed-in form we are certain to
   * see either way.
   */
  it("skips a repository route the public crawler already rendered", () => {
    const overlapping = candidates({
      repositoryRoutes: [{ path: "/pricing", kind: "page", dynamic: false }],
      publicPages: [{ path: "/pricing", redirectedTo: null }],
    });
    const fresh = candidates({
      repositoryRoutes: [{ path: "/pricing", kind: "page", dynamic: false }],
    });

    expect(overlapping.map((candidate) => candidate.path)).not.toContain("/pricing");
    expect(fresh.map((candidate) => candidate.path)).toContain("/pricing");
  });

  it("skips public-overlap routes whichever source they arrive by", () => {
    const seeded = candidates({
      landingPath: "/app",
      repositoryRoutes: [
        { path: "/", kind: "page", dynamic: false },
        { path: "/pricing", kind: "page", dynamic: false },
      ],
      publicPages: [
        { path: "/", redirectedTo: null },
        { path: "/pricing", redirectedTo: null },
      ],
    });

    expect(seeded.map((candidate) => candidate.path)).not.toContain("/");
    expect(seeded.map((candidate) => candidate.path)).not.toContain("/pricing");

    // The footer of the signed-in shell is where `/privacy` and `/terms`
    // actually came from, so the exclusion has to hold for harvested links too.
    const linked = extendCandidates([], ["/privacy", "/app/settings"], {
      origin: ORIGIN,
      depth: 1,
      budgets: DEFAULT_AUTHENTICATED_BUDGETS,
      publiclyRendered: new Set(["/privacy"]),
    });

    expect(linked.map((candidate) => candidate.path)).toEqual(["/app/settings"]);
  });

  it("keeps a protected path even when the public crawl fetched something at it", () => {
    // A page that bounced to a login surface is not a page the public scan
    // read: `redirectedTo` is what separates the two, and only a genuinely
    // rendered page is excluded.
    const result = candidates({
      landingPath: "/app",
      publicPages: [{ path: "/reports", redirectedTo: "/login" }],
    });

    expect(result.map((candidate) => candidate.path)).toContain("/reports");
  });

  it("never demotes the landing page the user is already on", () => {
    const result = candidates({
      landingPath: "/",
      publicPages: [{ path: "/", redirectedTo: null }],
    });

    const landing = result.find((candidate) => candidate.path === "/");
    expect(landing?.source).toBe("landing");
    expect(landing?.priority).toBe(10);
  });

  it("ranks a link found in the signed-in UI above an unremarkable seeded route", () => {
    const [link] = extendCandidates([], ["/reports"], {
      origin: ORIGIN,
      depth: 1,
      budgets: DEFAULT_AUTHENTICATED_BUDGETS,
    });
    const seeded = candidates({ repositoryRoutes: [{ path: "/reports", kind: "page", dynamic: false }] }).find(
      (candidate) => candidate.path === "/reports",
    );

    expect(link.priority).toBeGreaterThan(seeded!.priority);
  });
});

/*
 * The first run that read pages properly inspected 25 pages and saw 8 screens:
 * four copies each of a project workspace's seven tabs. It then reported
 * `integrations` and `onboarding` as absent — it had never reached
 * `/app/connect/github` or `/app/onboarding`, because seventeen of its pages
 * went on repetitions.
 *
 * A shape that is too greedy is the worse failure of the two: collapsing a
 * real route hides a surface, where an uncollapsed duplicate merely costs a
 * page. So these tests spend most of their weight on what must survive.
 */
describe("routeShape", () => {
  it("collapses instances of one screen onto one template", () => {
    expect(routeShape("/app/projects/88d1c463-74f4-43a4-b2ce-8b58cfdfbb4b/settings")).toBe(
      "/app/projects/:id/settings",
    );
    expect(routeShape("/app/projects/88d1c463-74f4-43a4-b2ce-8b58cfdfbb4b/settings")).toBe(
      routeShape("/app/projects/9b702a96-7863-4c29-8ece-c0055bfac24f/settings"),
    );
  });

  it("recognises the identifier shapes a product actually uses", () => {
    expect(routeShape("/orders/48217")).toBe("/orders/:id");
    expect(routeShape("/u/a3f9c1d4e5b60718")).toBe("/u/:id");
    // A Stripe-style key and a nanoid: long, and mixing digits with letters.
    expect(routeShape("/invoices/in_1P9xQ2eZvKYlo2C")).toBe("/invoices/:id");
    expect(routeShape("/d/V1StGXR8Z5jdHi6B")).toBe("/d/:id");
  });

  it("leaves real routes alone", () => {
    // Collapsing one of these would hide a surface rather than a duplicate,
    // which is the expensive direction to be wrong in.
    for (const path of [
      "/",
      "/app",
      "/app/billing",
      "/app/settings",
      "/app/onboarding",
      "/app/connect/github/repositories",
      "/app/products",
      "/dashboard/analytics",
      "/teams/engineering/members",
      "/blog/how-we-built-our-onboarding",
    ]) {
      expect(routeShape(path), path).toBe(path);
    }
  });

  it("does not mistake a long hyphenated slug for an id", () => {
    // Words, no digits — a human chose this, so it names a page.
    expect(routeShape("/help/getting-started-with-projects")).toBe(
      "/help/getting-started-with-projects",
    );
  });

  it("is stable and idempotent", () => {
    const shaped = routeShape("/app/projects/88d1c463-74f4-43a4-b2ce-8b58cfdfbb4b");
    expect(routeShape(shaped)).toBe(shaped);
  });
});
