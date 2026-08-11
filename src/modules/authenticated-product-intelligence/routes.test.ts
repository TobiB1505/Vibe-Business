import { describe, expect, it } from "vitest";

import { DEFAULT_AUTHENTICATED_BUDGETS } from "./budgets";
import {
  buildRouteCandidates,
  extendCandidates,
  isNeverVisit,
  isSafeAnalysisTarget,
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
