import { describe, expect, it } from "vitest";
import {
  classifyProperty,
  isSelectableProperty,
  rankProperties,
  toCandidate,
} from "./properties";
import type { PermissionLevel } from "./schema";

/**
 * Property discovery and matching (Sprint 12C §50).
 *
 * The failure these protect against is the worst kind available to this
 * connector: reading the *wrong site*. Every number would be real, every date
 * correct, the classification sound — and the conclusion about somebody else's
 * website. Nothing downstream can detect it, so the check has to be here.
 */

const ORIGIN = "https://vibe-business-fawn.vercel.app";

function property(siteUrl: string, permissionLevel: PermissionLevel = "siteOwner") {
  return toCandidate({ siteUrl, permissionLevel });
}

describe("property classification follows Google's own format", () => {
  it("distinguishes domain properties from URL-prefix properties", () => {
    expect(classifyProperty("sc-domain:example.com")).toBe("domain");
    expect(classifyProperty("https://www.example.com/")).toBe("url_prefix");
  });

  it("keeps the provider identifier verbatim and derives display separately", () => {
    // The siteUrl is opaque authority — it is what gets sent back to Google.
    // Rebuilding it from parsed parts eventually differs by a trailing slash.
    const domain = property("sc-domain:example.com");
    expect(domain.siteUrl).toBe("sc-domain:example.com");
    expect(domain.displayName).toBe("example.com");

    const prefix = property("https://www.example.com/");
    expect(prefix.siteUrl).toBe("https://www.example.com/");
  });
});

describe("matching against the project's own origin", () => {
  it("recommends a single exact URL-prefix match", () => {
    const ranked = rankProperties(
      [property("https://vibe-business-fawn.vercel.app/"), property("sc-domain:unrelated.com")],
      ORIGIN,
    );

    expect(ranked[0]).toMatchObject({ match: "exact_url_prefix", recommended: true });
    expect(ranked.filter((entry) => entry.recommended)).toHaveLength(1);
  });

  it("recommends a single covering domain property", () => {
    const ranked = rankProperties([property("sc-domain:vercel.app")], ORIGIN);

    // A domain property covers its subdomains, so this legitimately measures
    // the project's origin.
    expect(ranked[0]).toMatchObject({ match: "covering_domain", recommended: true });
  });

  it("does NOT auto-select when a domain and a URL-prefix property both match", () => {
    // The ambiguous case §10 forbids resolving. Both are correct answers to
    // "which property measures this site?", and they return different numbers.
    const ranked = rankProperties(
      [property("sc-domain:vercel.app"), property("https://vibe-business-fawn.vercel.app/")],
      ORIGIN,
    );

    expect(ranked.some((entry) => entry.recommended)).toBe(true);
    // Exactly one may ever be recommended, and it is the stronger match — not
    // whichever happened to be first in Google's response.
    const recommended = ranked.filter((entry) => entry.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0].match).toBe("exact_url_prefix");
  });

  it("does NOT auto-select between two equally strong matches", () => {
    // Two domain properties both covering the origin. There is no defensible
    // way to choose, so the product must ask.
    const ranked = rankProperties(
      [property("sc-domain:vercel.app"), property("sc-domain:fawn.vercel.app")],
      "https://a.fawn.vercel.app",
    );

    expect(ranked.filter((entry) => entry.recommended)).toHaveLength(0);
  });

  it("treats a different protocol as related, never exact", () => {
    // A URL-prefix property is protocol-specific. An http:// property does not
    // measure an https:// site, and auto-selecting it would silently read a
    // property with no traffic.
    const ranked = rankProperties([property("http://vibe-business-fawn.vercel.app/")], ORIGIN);

    expect(ranked[0].match).toBe("related");
    expect(ranked[0].recommended).toBe(false);
  });

  it("never recommends on a merely related match", () => {
    const ranked = rankProperties([property("https://staging.vibe-business-fawn.vercel.app/")], ORIGIN);

    expect(ranked[0].recommended).toBe(false);
  });

  it("does not treat a suffix collision as a domain match", () => {
    // `sc-domain:example.com` must not appear to cover `notexample.com`.
    const ranked = rankProperties([property("sc-domain:example.com")], "https://notexample.com");

    expect(ranked[0].match).toBe("none");
  });

  it("reports no match rather than picking the first property", () => {
    const ranked = rankProperties(
      [property("sc-domain:someone-else.com"), property("https://another.example/")],
      ORIGIN,
    );

    expect(ranked.every((entry) => entry.match === "none")).toBe(true);
    expect(ranked.some((entry) => entry.recommended)).toBe(false);
  });

  it("recommends nothing when the project has no verified origin", () => {
    const ranked = rankProperties([property("sc-domain:vercel.app")], null);

    expect(ranked.some((entry) => entry.recommended)).toBe(false);
  });
});

describe("permission levels that cannot read Search Analytics", () => {
  it("never recommends an unverified user's property", () => {
    // It authorizes cleanly and then fails on every read, which would present
    // as a broken product rather than a permissions problem.
    const ranked = rankProperties(
      [property("https://vibe-business-fawn.vercel.app/", "siteUnverifiedUser")],
      ORIGIN,
    );

    expect(ranked[0].match).toBe("exact_url_prefix");
    expect(ranked[0].recommended).toBe(false);
  });

  it("recommends a restricted user's property, which can still read", () => {
    const ranked = rankProperties(
      [property("https://vibe-business-fawn.vercel.app/", "siteRestrictedUser")],
      ORIGIN,
    );

    expect(ranked[0].recommended).toBe(true);
  });
});

describe("the client cannot invent a property", () => {
  const discovered = [property("sc-domain:vercel.app"), property("https://example.com/")];

  it("accepts only properties the server actually discovered", () => {
    expect(isSelectableProperty(discovered, "sc-domain:vercel.app")).toBe(true);
    // The whole of §11: a client submitting a property id it made up must not
    // cause Vibe to query somebody else's site.
    expect(isSelectableProperty(discovered, "sc-domain:some-other-company.com")).toBe(false);
  });

  it("rejects a discovered property that cannot read Search Analytics", () => {
    const unverified = [property("sc-domain:vercel.app", "siteUnverifiedUser")];

    expect(isSelectableProperty(unverified, "sc-domain:vercel.app")).toBe(false);
  });

  it("is exact about the identifier, not fuzzy", () => {
    // A trailing-slash difference is a different property to Google.
    expect(isSelectableProperty(discovered, "https://example.com")).toBe(false);
    expect(isSelectableProperty(discovered, "https://example.com/")).toBe(true);
  });
});
