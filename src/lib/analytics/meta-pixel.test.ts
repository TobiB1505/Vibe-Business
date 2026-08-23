import { describe, expect, it } from "vitest";
import {
  META_PIXEL_ID,
  isMetaPixelEnabled,
  isPixelTrackablePath,
  metaPixelLoaderScript,
  metaPixelNoscriptImageSrc,
} from "./meta-pixel";

describe("which deployments run the pixel", () => {
  it("runs on Production", () => {
    expect(isMetaPixelEnabled({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("does not run on Preview", () => {
    // Every branch deployment would otherwise report page views into the ad
    // account that decides where money goes.
    expect(
      isMetaPixelEnabled({ VERCEL_ENV: "preview", VERCEL_URL: "vibe-git-branch.vercel.app" }),
    ).toBe(false);
  });

  it("does not run in local development", () => {
    expect(isMetaPixelEnabled({})).toBe(false);
    expect(isMetaPixelEnabled({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toBe(false);
  });
});

describe("which paths may be reported", () => {
  it("reports the public surface", () => {
    for (const path of ["/", "/signup", "/login", "/privacy", "/terms", "/forgot-password"]) {
      expect(isPixelTrackablePath(path), path).toBe(true);
    }
  });

  it("never reports the authenticated surface, whose paths carry project ids", () => {
    for (const path of ["/app", "/app/", "/app/projects/8f1c0b2e-0000-4000-8000-000000000000"]) {
      expect(isPixelTrackablePath(path), path).toBe(false);
    }
  });

  it("matches a path segment, not a prefix of the string", () => {
    // A public page whose name merely starts with the same four characters
    // must not disappear from reporting.
    expect(isPixelTrackablePath("/application")).toBe(true);
  });
});

describe("the tag that reaches the page", () => {
  it("initialises Vibe's pixel and reports the loading page view", () => {
    const script = metaPixelLoaderScript();

    expect(script).toContain(`fbq('init', '${META_PIXEL_ID}')`);
    expect(script).toContain("fbq('track', 'PageView')");
    expect(script).toContain("https://connect.facebook.net/en_US/fbevents.js");
  });

  it("points the scriptless fallback at the same pixel", () => {
    expect(metaPixelNoscriptImageSrc()).toBe(
      `https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`,
    );
  });

  it("refuses an id that is not digits, in either output", () => {
    // The id is interpolated into inline script text, so this is the
    // difference between a misconfiguration and executing a stranger's code.
    const injection = "1'); alert(1); fbq('init', '2";

    expect(() => metaPixelLoaderScript(injection)).toThrow(/pixel id must be 10-20 digits/);
    expect(() => metaPixelNoscriptImageSrc(injection)).toThrow(/pixel id must be 10-20 digits/);
    expect(() => metaPixelLoaderScript("")).toThrow();
  });

  it("ships an id that satisfies its own check", () => {
    expect(() => metaPixelLoaderScript(META_PIXEL_ID)).not.toThrow();
  });
});
