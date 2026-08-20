import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PART D/H — same discipline as sitemap.test.ts: the sitemap URL robots.txt
 * points at must track the resolved environment, not a hardcoded domain.
 */

describe("robots", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("points at the resolved origin's sitemap.xml", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://vibe.business";
    delete process.env.VERCEL_URL;

    const { default: robots } = await import("./robots");
    expect(robots().sitemap).toBe("https://vibe.business/sitemap.xml");
  });

  it("never contains the old hardcoded preview domain", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://vibe.business";
    const { default: robots } = await import("./robots");
    expect(robots().sitemap).not.toContain("vibe-business-fawn");
  });

  it("falls back to localhost with no configuration at all", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;

    const { default: robots } = await import("./robots");
    expect(robots().sitemap).toBe("http://localhost:3000/sitemap.xml");
  });

  it("still disallows /app/ and /api/ — no SEO behavior changed, only the URL source", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://vibe.business";
    const { default: robots } = await import("./robots");
    const result = robots();

    expect(result.rules).toEqual({ userAgent: "*", allow: "/", disallow: ["/app/", "/api/"] });
  });
});
