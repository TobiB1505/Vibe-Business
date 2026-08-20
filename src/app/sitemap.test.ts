import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PART D/H — the sitemap origin must come from the environment, not from a
 * value baked into the file. `ORIGIN` is computed once at module load, so
 * each case resets modules and re-imports after setting `process.env` —
 * the only way to actually prove the source is the environment rather than
 * a coincidence of what `getAppUrl()` happens to default to.
 */

describe("sitemap", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses NEXT_PUBLIC_APP_URL when it is set, not any hardcoded domain", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://vibe.business";
    delete process.env.VERCEL_URL;

    const { default: sitemap } = await import("./sitemap");
    const entries = sitemap();

    expect(entries[0].url).toBe("https://vibe.business");
    expect(entries.every((e) => e.url.startsWith("https://vibe.business"))).toBe(true);
  });

  it("never contains the old hardcoded preview domain", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://vibe.business";
    const { default: sitemap } = await import("./sitemap");
    const entries = sitemap();

    for (const entry of entries) {
      expect(entry.url).not.toContain("vibe-business-fawn");
    }
  });

  it("falls back to localhost with no configuration at all", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;

    const { default: sitemap } = await import("./sitemap");
    const entries = sitemap();

    expect(entries[0].url).toBe("http://localhost:3000");
  });

  it("lists the privacy and terms pages under the resolved origin", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://vibe.business";
    const { default: sitemap } = await import("./sitemap");
    const entries = sitemap();

    expect(entries.map((e) => e.url)).toEqual(
      expect.arrayContaining(["https://vibe.business/privacy", "https://vibe.business/terms"]),
    );
  });
});
