import { describe, expect, it } from "vitest";

import {
  DENIED_PERMISSIONS,
  FORBIDDEN_INTERACTIONS,
  SAFE_METHODS,
  couldHaveRenderedPage,
  decideRequest,
  shouldBlockDownload,
} from "./read-only-policy";

const ORIGIN = "https://app.example.com";

function request(overrides: Partial<Parameters<typeof decideRequest>[0]> = {}) {
  return decideRequest({
    method: "GET",
    url: `${ORIGIN}/app`,
    isNavigation: false,
    origin: ORIGIN,
    ...overrides,
  });
}

describe("decideRequest — mutation safety", () => {
  it("allows safe methods", () => {
    for (const method of SAFE_METHODS) {
      expect(request({ method })).toEqual({ allow: true });
    }
  });

  it("blocks every mutating method", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(request({ method })).toEqual({ allow: false, reason: "mutating_method" });
    }
  });

  it("blocks mutating methods regardless of case or origin", () => {
    expect(request({ method: "post" })).toEqual({ allow: false, reason: "mutating_method" });
    expect(request({ method: "delete", url: "https://api.example.com/v1/records/1" })).toEqual({
      allow: false,
      reason: "mutating_method",
    });
  });

  it("blocks an unusual method rather than allow-listing by exclusion", () => {
    for (const method of ["TRACE", "CONNECT", "PROPFIND", "PURGE"]) {
      expect(request({ method })).toEqual({ allow: false, reason: "mutating_method" });
    }
  });
});

describe("decideRequest — navigation confinement", () => {
  it("blocks a top-level navigation off-origin even with a safe method", () => {
    expect(
      request({ isNavigation: true, url: "https://accounts.google.com/signin", method: "GET" }),
    ).toEqual({ allow: false, reason: "external_navigation" });
  });

  it("allows a same-origin navigation", () => {
    expect(request({ isNavigation: true, url: `${ORIGIN}/app/settings` })).toEqual({ allow: true });
  });

  it("treats a subdomain as off-origin", () => {
    expect(request({ isNavigation: true, url: "https://api.app.example.com/x" })).toEqual({
      allow: false,
      reason: "external_navigation",
    });
  });

  it("leaves third-party subresources alone — they cannot mutate the product", () => {
    // Blocking these would break rendering without adding safety.
    expect(request({ url: "https://fonts.gstatic.com/font.woff2", isNavigation: false })).toEqual({
      allow: true,
    });
  });

  it("blocks a malformed navigation url rather than assuming it is safe", () => {
    expect(request({ isNavigation: true, url: "not a url" })).toEqual({
      allow: false,
      reason: "external_navigation",
    });
  });
});

describe("capability denial", () => {
  it("always blocks downloads", () => {
    expect(shouldBlockDownload()).toBe(true);
  });

  it("denies every sensitive browser permission", () => {
    for (const permission of ["geolocation", "notifications", "camera", "microphone"]) {
      expect(DENIED_PERMISSIONS).toContain(permission);
    }
  });

  it("documents the interactions the analyzer never performs", () => {
    for (const interaction of ["click", "fill", "type", "setInputFiles"]) {
      expect(FORBIDDEN_INTERACTIONS).toContain(interaction);
    }
  });
});

/*
 * A scan of 21 pages reported 53 blocked non-GET requests and downgraded
 * itself to `partial` on all of them: *parts of this application may render
 * via non-GET requests*. Most of the 53 were analytics beacons, fired once per
 * page view. A blocked beacon cannot change what a page displays, and saying
 * it might is not caution — it is a false statement that costs a founder
 * confidence in a scan that worked.
 *
 * The blocking is unchanged. Every non-GET is still refused. What this decides
 * is only what Vibe concludes from having refused it.
 */
describe("couldHaveRenderedPage", () => {
  it("clears the kinds that are definitionally not page data", () => {
    for (const type of ["ping", "image", "media", "font", "manifest", "texttrack"]) {
      expect(couldHaveRenderedPage(type), type).toBe(false);
    }
  });

  it("keeps every kind that could carry a page's data", () => {
    // A GraphQL mutation is a `fetch`; a form post is a `document`. These are
    // exactly the requests whose absence can leave a page half-rendered.
    for (const type of ["fetch", "xhr", "document", "eventsource", "script", "stylesheet"]) {
      expect(couldHaveRenderedPage(type), type).toBe(true);
    }
  });

  it("treats an unrecognised kind as capable, never as harmless", () => {
    // The list is an allow-list of things proven inert. Anything else — a new
    // resource type, a provider that reports something unexpected — must fall
    // on the cautious side, because the cost of the two errors is not equal.
    for (const type of ["other", "websocket", "", "prefetch", "signedexchange"]) {
      expect(couldHaveRenderedPage(type), type).toBe(true);
    }
  });

  it("does not depend on casing", () => {
    expect(couldHaveRenderedPage("PING")).toBe(false);
    expect(couldHaveRenderedPage("Image")).toBe(false);
  });
});
