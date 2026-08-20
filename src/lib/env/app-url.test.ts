import { describe, expect, it } from "vitest";
import { getAppEnvironment, getAppUrl } from "./app-url";

/**
 * PART C/H — the environment decides, not the code. These pin the three-tier
 * fallback chain and the tier-name resolution it composes with.
 */

describe("getAppUrl — development / preview / production resolution", () => {
  it("development: no NEXT_PUBLIC_APP_URL, no VERCEL_URL -> localhost:3000", () => {
    expect(getAppUrl({})).toBe("http://localhost:3000");
  });

  it("preview: VERCEL_URL present, no explicit override -> https://<vercel-url>", () => {
    expect(getAppUrl({ VERCEL_URL: "my-app-git-feature-team.vercel.app" })).toBe(
      "https://my-app-git-feature-team.vercel.app",
    );
  });

  it("production: NEXT_PUBLIC_APP_URL set -> the custom domain, verbatim", () => {
    expect(getAppUrl({ NEXT_PUBLIC_APP_URL: "https://vibe.business" })).toBe("https://vibe.business");
  });

  it("an explicit NEXT_PUBLIC_APP_URL wins over VERCEL_URL even when both are present", () => {
    expect(
      getAppUrl({
        NEXT_PUBLIC_APP_URL: "https://vibe.business",
        VERCEL_URL: "some-preview-deploy.vercel.app",
      }),
    ).toBe("https://vibe.business");
  });

  it("strips a trailing slash from an explicit override so callers can safely append a path", () => {
    expect(getAppUrl({ NEXT_PUBLIC_APP_URL: "https://vibe.business/" })).toBe("https://vibe.business");
  });

  it("treats whitespace-only values as absent, not as a real override", () => {
    expect(getAppUrl({ NEXT_PUBLIC_APP_URL: "   ", VERCEL_URL: "preview.vercel.app" })).toBe(
      "https://preview.vercel.app",
    );
  });

  it("is pure — the same input always produces the same output, no caching to reset", () => {
    const source = { NEXT_PUBLIC_APP_URL: "https://vibe.business" };
    expect(getAppUrl(source)).toBe(getAppUrl(source));
  });
});

describe("getAppEnvironment", () => {
  it("reads VERCEL_ENV directly when it is one of the three known values", () => {
    expect(getAppEnvironment({ VERCEL_ENV: "production" })).toBe("production");
    expect(getAppEnvironment({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(getAppEnvironment({ VERCEL_ENV: "development" })).toBe("development");
  });

  it("falls back to development when nothing is configured (bare localhost)", () => {
    expect(getAppEnvironment({})).toBe("development");
  });

  it("falls back to production when a real URL is configured but VERCEL_ENV is absent", () => {
    // e.g. a non-Vercel host, or a local run deliberately pointed at a real domain.
    expect(getAppEnvironment({ NEXT_PUBLIC_APP_URL: "https://vibe.business" })).toBe("production");
  });

  it("ignores an unrecognised VERCEL_ENV value rather than trusting it blindly", () => {
    expect(getAppEnvironment({ VERCEL_ENV: "staging", NEXT_PUBLIC_APP_URL: "https://vibe.business" })).toBe(
      "production",
    );
  });
});
