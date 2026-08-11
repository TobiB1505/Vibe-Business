import { describe, expect, it } from "vitest";

import { detectAuthenticatedSurfaces } from "./surface-detection";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";

function repository(
  routes: { path: string; kind?: "page" | "api" | "layout" }[],
  extra: Record<string, unknown> = {},
): RepositoryIntelligenceSnapshot {
  return {
    routes: {
      mode: "app_router",
      truncated: false,
      routes: routes.map((route) => ({
        path: route.path,
        kind: route.kind ?? "page",
        dynamic: false,
        sourcePath: `src/app${route.path}/page.tsx`,
      })),
    },
    ...extra,
  } as unknown as RepositoryIntelligenceSnapshot;
}

function publicProduct(options: {
  pages?: { path: string; redirectedTo: string | null }[];
  surfaces?: { id: string; detected: boolean; path?: string }[];
  forms?: { kind: string; path: string }[];
} = {}): LiveProductIntelligenceSnapshot {
  return {
    pages: (options.pages ?? []).map((page) => ({ ...page, status: 200 })),
    productSurfaces: (options.surfaces ?? []).map((surface) => ({
      id: surface.id,
      name: surface.id,
      detected: surface.detected,
      confidence: "medium",
      evidence: [{ kind: "url_path", path: surface.path ?? "/login" }],
    })),
    conversionSignals: { forms: options.forms ?? [] },
  } as unknown as LiveProductIntelligenceSnapshot;
}

describe("detectAuthenticatedSurfaces", () => {
  it("treats a login redirect as proof, with high confidence", () => {
    // The exact Vibe Business case: /app exists and bounced anonymously.
    const detection = detectAuthenticatedSurfaces({
      repository: null,
      publicProduct: publicProduct({
        pages: [
          { path: "/", redirectedTo: null },
          { path: "/app", redirectedTo: "/login" },
        ],
      }),
    });

    expect(detection.likely).toBe(true);
    expect(detection.confidence).toBe("high");
    expect(detection.evidence[0]).toEqual({ kind: "public_login_redirect", path: "/app" });
  });

  it("recognises application page routes from the repository", () => {
    const detection = detectAuthenticatedSurfaces({
      repository: repository([{ path: "/app" }, { path: "/app/settings" }]),
      publicProduct: null,
    });

    expect(detection.likely).toBe(true);
    expect(detection.evidence.map((item) => item.kind)).toContain("repository_app_route");
  });

  it("raises confidence when an app route and a public auth surface agree", () => {
    const detection = detectAuthenticatedSurfaces({
      repository: repository([{ path: "/dashboard" }]),
      publicProduct: publicProduct({ surfaces: [{ id: "login", detected: true }] }),
    });

    expect(detection.likely).toBe(true);
    expect(detection.confidence).toBe("medium");
  });

  it("does NOT infer authentication from an auth library alone", () => {
    // A Supabase dependency proves a package was installed, not that a
    // protected product surface exists.
    const detection = detectAuthenticatedSurfaces({
      repository: repository([{ path: "/" }, { path: "/pricing" }], {
        integrations: [{ name: "Supabase", detected: true, confidence: "high", evidence: [] }],
      }),
      publicProduct: publicProduct({ pages: [{ path: "/", redirectedTo: null }] }),
    });

    expect(detection.likely).toBe(false);
    expect(detection.evidence).toEqual([]);
  });

  it("does not recommend a scan for a marketing-only product", () => {
    const detection = detectAuthenticatedSurfaces({
      repository: repository([{ path: "/" }, { path: "/about" }, { path: "/api/contact", kind: "api" }]),
      publicProduct: publicProduct({
        pages: [
          { path: "/", redirectedTo: null },
          { path: "/about", redirectedTo: null },
        ],
      }),
    });

    expect(detection.likely).toBe(false);
  });

  it("does not treat a signup page on its own as enough to nag about", () => {
    const detection = detectAuthenticatedSurfaces({
      repository: null,
      publicProduct: publicProduct({ surfaces: [{ id: "signup", detected: true }] }),
    });

    expect(detection.likely).toBe(false);
    expect(detection.confidence).toBe("low");
  });

  it("ignores an undetected surface", () => {
    const detection = detectAuthenticatedSurfaces({
      repository: null,
      publicProduct: publicProduct({ surfaces: [{ id: "login", detected: false }] }),
    });

    expect(detection.evidence).toEqual([]);
  });

  it("counts a login-shaped form as corroboration", () => {
    const detection = detectAuthenticatedSurfaces({
      repository: repository([{ path: "/app" }]),
      publicProduct: publicProduct({ forms: [{ kind: "login_like", path: "/login" }] }),
    });

    expect(detection.confidence).toBe("medium");
    expect(detection.evidence.map((item) => item.kind)).toContain("public_login_form");
  });

  it("returns nothing when there is no intelligence at all", () => {
    expect(detectAuthenticatedSurfaces({ repository: null, publicProduct: null })).toEqual({
      likely: false,
      confidence: "low",
      evidence: [],
    });
  });

  it("bounds the evidence list", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ path: `/app/p-${index}` }));
    const detection = detectAuthenticatedSurfaces({
      repository: repository(many),
      publicProduct: null,
    });

    expect(detection.evidence.length).toBeLessThanOrEqual(12);
  });
});
