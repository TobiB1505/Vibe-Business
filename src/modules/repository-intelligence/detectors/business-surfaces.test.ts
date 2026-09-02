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
    expect(surface?.evidence[0]).toMatchObject({
      path: "src/app/pricing/page.tsx",
      detail: "/pricing",
    });
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

  it.each([
    "app/robots.ts",
    "src/app/robots.js",
    "app/(marketing)/robots.ts",
    "public/robots.txt",
    "static/robots.txt",
    "robots.txt",
    "apps/web/public/robots.txt",
    "packages/site/app/robots.ts",
  ])("detects robots served from %s", (path) => {
    expect(isDetected([{ path }], "robots")).toBe(true);
  });

  it.each([
    "app/sitemap.ts",
    "src/app/sitemap.tsx",
    "app/(marketing)/sitemap.ts",
    "public/sitemap.xml",
    "static/sitemap.xml",
    "sitemap.xml",
    "apps/web/public/sitemap.xml",
  ])("detects a sitemap served from %s", (path) => {
    expect(isDetected([{ path }], "sitemap")).toBe(true);
  });

  // Regression (Sprint 8 dogfood): this repository's own robots.txt/sitemap.xml
  // *parsers* live in a library directory. They are code that reads other
  // sites' files, not files this product serves — so claiming the surfaces
  // contradicted the live crawl, which correctly reported both as missing.
  it.each([
    "src/modules/live-product-intelligence/robots.ts",
    "src/lib/robots.ts",
    "src/utils/robots.txt",
    "docs/robots.txt",
    "tests/fixtures/robots.txt",
    "app/api/robots/route.ts",
    "src/app/components/robots.tsx",
  ])("does not claim robots for a same-named file at %s", (path) => {
    expect(isDetected([{ path }], "robots")).toBe(false);
  });

  it.each([
    "src/modules/live-product-intelligence/sitemap.ts",
    "src/lib/sitemap.ts",
    "src/modules/live-product-intelligence/sitemap.test.ts",
    "docs/sitemap.xml",
    "tests/fixtures/sitemap.xml",
    "src/app/lib/sitemap.ts",
  ])("does not claim a sitemap for a same-named file at %s", (path) => {
    expect(isDetected([{ path }], "sitemap")).toBe(false);
  });

  it("reports both surfaces as absent for a repository that only parses them", () => {
    const surfaces = surfacesFor([
      { path: "package.json", content: packageJson({ dependencies: { next: "15" } }) },
      { path: "src/app/page.tsx" },
      { path: "src/modules/live-product-intelligence/robots.ts" },
      { path: "src/modules/live-product-intelligence/sitemap.ts" },
    ]);

    expect(surfaces.find((surface) => surface.id === "robots")?.detected).toBe(false);
    expect(surfaces.find((surface) => surface.id === "sitemap")?.detected).toBe(false);
  });

  it("detects SEO metadata infrastructure from conventional assets", () => {
    expect(isDetected([{ path: "src/app/opengraph-image.png" }], "seo_metadata")).toBe(true);
  });

  it.each([
    "app/opengraph-image.tsx",
    "src/app/twitter-image.png",
    "app/blog/opengraph-image.jpg",
    "app/(marketing)/apple-icon.png",
    "src/app/icon.svg",
    "app/icon1.png",
    "app/manifest.ts",
    "public/manifest.json",
    "public/site.webmanifest",
    "static/manifest.json",
    "site.webmanifest",
    "apps/web/app/opengraph-image.png",
  ])("detects SEO metadata from %s", (path) => {
    expect(isDetected([{ path }], "seo_metadata")).toBe(true);
  });

  // Same class of false positive as robots/sitemap: `icon.tsx` is one of
  // the most common component names there is, and `manifest.json` names a
  // browser extension at least as often as a web app manifest.
  it.each([
    "src/components/icon.tsx",
    "src/components/ui/icon.tsx",
    "src/lib/icons/apple-icon.tsx",
    // Inside the router but in a `_private` directory, which Next.js opts
    // out of routing entirely — so nothing there is ever served.
    "app/_components/icon.tsx",
    "src/app/_lib/opengraph-image.png",
    "tests/fixtures/opengraph-image.png",
    "docs/twitter-image.png",
    "manifest.json",
    "src/manifest.json",
    "extension/manifest.json",
  ])("does not claim SEO metadata for a same-named file at %s", (path) => {
    expect(isDetected([{ path }], "seo_metadata")).toBe(false);
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
