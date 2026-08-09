import { describe, expect, it } from "vitest";
import { detectBusinessSurfaces } from "./business-surfaces";
import { detectIntegrationSignals } from "./integrations";
import { detectRoutes } from "./routes";
import { contextFrom, packageJson, type FixtureFile } from "../test-support";
import type { BusinessSurfaceId, Detection } from "../schema";

const NEXT: Detection[] = [{ id: "nextjs", name: "Next.js", confidence: "high", evidence: [] }];

function surfacesFor(files: FixtureFile[]) {
  const context = contextFrom(files);
  const signals = detectIntegrationSignals(context);
  const routes = detectRoutes(context, NEXT);
  return detectBusinessSurfaces(context, signals, routes);
}

function isDetected(files: FixtureFile[], id: BusinessSurfaceId): boolean {
  return surfacesFor(files).find((surface) => surface.id === id)?.detected ?? false;
}

describe("detectBusinessSurfaces", () => {
  it("detects authentication from an auth integration signal", () => {
    const files: FixtureFile[] = [
      { path: "package.json", content: packageJson({ dependencies: { "@clerk/nextjs": "5" } }) },
    ];
    expect(isDetected(files, "authentication")).toBe(true);
  });

  it("detects payments from a payment SDK", () => {
    const files: FixtureFile[] = [
      { path: "package.json", content: packageJson({ dependencies: { stripe: "16" } }) },
    ];
    expect(isDetected(files, "payments")).toBe(true);
  });

  it("detects a pricing page from a route", () => {
    const files: FixtureFile[] = [{ path: "src/app/pricing/page.tsx" }];
    const surface = surfacesFor(files).find((entry) => entry.id === "pricing_page");

    expect(surface?.detected).toBe(true);
    expect(surface?.evidence[0]).toMatchObject({ path: "src/app/pricing/page.tsx", detail: "/pricing" });
  });

  it.each([
    ["src/app/checkout/page.tsx", "checkout_billing"],
    ["src/app/blog/page.tsx", "blog_content"],
    ["src/app/contact/page.tsx", "contact"],
    ["src/app/docs/page.tsx", "docs_help"],
    ["src/app/privacy/page.tsx", "legal"],
    ["src/app/onboarding/page.tsx", "onboarding"],
    ["src/app/dashboard/page.tsx", "dashboard_app"],
  ])("detects %s as %s", (path, id) => {
    expect(isDetected([{ path }], id as BusinessSurfaceId)).toBe(true);
  });

  it("detects robots and sitemap files", () => {
    const files: FixtureFile[] = [{ path: "public/robots.txt" }, { path: "src/app/sitemap.ts" }];
    expect(isDetected(files, "robots")).toBe(true);
    expect(isDetected(files, "sitemap")).toBe(true);
  });

  it("detects SEO metadata infrastructure from conventional assets", () => {
    expect(isDetected([{ path: "src/app/opengraph-image.png" }], "seo_metadata")).toBe(true);
  });

  it("reports not-detected rather than omitting absent surfaces", () => {
    const surfaces = surfacesFor([{ path: "src/app/page.tsx" }]);

    const payments = surfaces.find((surface) => surface.id === "payments");
    expect(payments).toBeDefined();
    expect(payments?.detected).toBe(false);
    expect(payments?.evidence).toEqual([]);
  });

  it("produces no false positives for a bare repository", () => {
    const surfaces = surfacesFor([{ path: "README.md" }]);
    expect(surfaces.every((surface) => !surface.detected)).toBe(true);
  });

  it("does not treat an API route as a page surface", () => {
    expect(isDetected([{ path: "src/app/api/pricing/route.ts" }], "pricing_page")).toBe(false);
  });

  it("always carries evidence for anything it claims", () => {
    const surfaces = surfacesFor([
      { path: "package.json", content: packageJson({ dependencies: { stripe: "16" } }) },
      { path: "src/app/pricing/page.tsx" },
    ]);

    for (const surface of surfaces.filter((entry) => entry.detected)) {
      expect(surface.evidence.length).toBeGreaterThan(0);
    }
  });
});
