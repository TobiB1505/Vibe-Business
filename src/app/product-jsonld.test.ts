import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SITE_DESCRIPTION, SITE_NAME } from "./site-metadata";

/**
 * Structured data for the landing page — read by search engines, not by a
 * person, so nothing here is a copy assertion (`landing-contract.test.ts`
 * already owns those). What this pins is the shape: the object a search
 * engine's structured-data parser expects, built from the same name,
 * description and origin the rest of the application already uses rather
 * than a second, hand-typed copy of them.
 */

describe("the landing page's structured data", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("describes the product with the same name, description and origin the rest of the app uses", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://vibe.business";

    const { default: productJsonLd } = await import("./product-jsonld");

    expect(productJsonLd()).toEqual({
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      url: "https://vibe.business",
    });
  });

  it("resolves its url from the deployment's own resolved origin, not a hardcoded domain", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;

    const { default: productJsonLd } = await import("./product-jsonld");

    expect(productJsonLd().url).toBe("http://localhost:3000");
  });

  /**
   * The regression this exists to catch: a field renamed, dropped, or typed
   * out again by hand somewhere the shape silently stops matching what a
   * `WebApplication` result needs — `@context`/`@type` present and correct,
   * a non-empty name and description, and a URL that actually parses.
   */
  it("emits the shape a structured-data parser expects", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://vibe.business";

    const { default: productJsonLd } = await import("./product-jsonld");
    const data = productJsonLd();

    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("WebApplication");
    expect(typeof data.name).toBe("string");
    expect(data.name.length).toBeGreaterThan(0);
    expect(typeof data.description).toBe("string");
    expect(data.description.length).toBeGreaterThan(0);
    expect(() => new URL(data.url)).not.toThrow();
  });

  it("is embedded in the landing page as valid JSON-LD, and nowhere else", () => {
    const root = process.cwd();
    const landing = readFileSync(join(root, "src/app/page.tsx"), "utf8");

    expect(landing).toContain('type="application/ld+json"');
    expect(landing).toContain("productJsonLd()");

    for (const otherPublicPage of [
      "src/app/login/page.tsx",
      "src/app/signup/page.tsx",
      "src/app/privacy/page.tsx",
      "src/app/terms/page.tsx",
      "src/app/forgot-password/page.tsx",
      "src/app/reset-password/page.tsx",
    ]) {
      const source = readFileSync(join(root, otherPublicPage), "utf8");
      expect(source, `${otherPublicPage} must not also emit product JSON-LD`).not.toContain("application/ld+json");
    }
  });
});
