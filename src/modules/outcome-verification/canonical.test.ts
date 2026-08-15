import { describe, expect, it } from "vitest";
import { canonicalizeUrl, canonicalPath, isUnderPrefix, matchesPath } from "./canonical";

/**
 * Canonical URL comparison (Sprint 12A §16, §45).
 *
 * Two failure modes, and both are damaging in opposite directions:
 *
 *  - **failing on formatting** tells a customer their homepage is missing from
 *    their sitemap because of a trailing slash;
 *  - **passing on the wrong origin** tells them a URL on somebody else's domain
 *    is their homepage.
 *
 * The second family is the one worth over-testing, because a `startsWith` or a
 * suffix match reads as correct and is not.
 */

const ORIGIN = "https://product.test";
const ORIGINS = [ORIGIN];

describe("trivial formatting never changes the answer (§16)", () => {
  it.each([
    [`${ORIGIN}`, "/"],
    [`${ORIGIN}/`, "/"],
    [`${ORIGIN}//`, "/"],
    [`${ORIGIN}/pricing`, "/pricing"],
    [`${ORIGIN}/pricing/`, "/pricing"],
    [`${ORIGIN}//pricing`, "/pricing"],
    [`${ORIGIN}/pricing#plans`, "/pricing"],
  ])("canonicalizes %s to %s", (raw, path) => {
    expect(canonicalizeUrl(raw)).toEqual({ origin: ORIGIN, path });
  });

  it("treats an uppercase host as the same host", () => {
    expect(canonicalizeUrl("https://Product.TEST/pricing")).toEqual({
      origin: ORIGIN,
      path: "/pricing",
    });
  });

  it("matches the root however the sitemap spelled it", () => {
    for (const raw of [ORIGIN, `${ORIGIN}/`, `${ORIGIN}//`]) {
      const url = canonicalizeUrl(raw);
      expect(url).not.toBeNull();
      expect(matchesPath(url!, "/", ORIGINS)).toBe(true);
    }
  });
});

describe("another origin is never the product's page (§16)", () => {
  it.each([
    "https://product.test.evil.example/",
    "https://evil.example/product.test/",
    "https://cdn.product.test/",
    "https://notproduct.test/",
    "http://product.test/",
  ])("refuses %s as the homepage", (raw) => {
    const url = canonicalizeUrl(raw);
    expect(url).not.toBeNull();
    // Including the plain-HTTP variant: a crawler treats it as a different URL,
    // and the origin Vibe verifies is always https.
    expect(matchesPath(url!, "/", ORIGINS)).toBe(false);
  });

  it("accepts an adopted origin only when it is passed in explicitly", () => {
    const url = canonicalizeUrl("https://www.product.test/");
    expect(matchesPath(url!, "/", ORIGINS)).toBe(false);
    expect(matchesPath(url!, "/", [ORIGIN, "https://www.product.test"])).toBe(true);
  });
});

describe("private-prefix matching is segment aware (§16)", () => {
  it("covers the whole subtree", () => {
    for (const raw of [`${ORIGIN}/app`, `${ORIGIN}/app/`, `${ORIGIN}/app/projects/123`]) {
      expect(isUnderPrefix(canonicalizeUrl(raw)!, "/app", ORIGINS)).toBe(true);
    }
  });

  it("does not swallow a page that merely starts with the same letters", () => {
    // The false-accusation case: `/application` is an ordinary marketing page,
    // and reporting it as a leaked private surface would produce a `partial`
    // that blames the customer for nothing.
    for (const raw of [`${ORIGIN}/application`, `${ORIGIN}/apps`, `${ORIGIN}/appearance`]) {
      expect(isUnderPrefix(canonicalizeUrl(raw)!, "/app", ORIGINS)).toBe(false);
    }
  });

  it("never matches a prefix on a different origin", () => {
    expect(isUnderPrefix(canonicalizeUrl("https://evil.example/login")!, "/login", ORIGINS)).toBe(
      false,
    );
  });
});

describe("malformed and dangerous values are rejected rather than resolved (§16)", () => {
  it.each([
    "",
    "   ",
    "/relative/path",
    "javascript:alert(1)",
    "data:text/html,<script>",
    "mailto:someone@example.test",
    "https://user:pass@product.test/",
    "not a url at all",
  ])("refuses %j", (raw) => {
    expect(canonicalizeUrl(raw)).toBeNull();
  });

  it("refuses an absurdly long value rather than parsing it", () => {
    expect(canonicalizeUrl(`${ORIGIN}/${"a".repeat(3000)}`)).toBeNull();
  });

  it("drops the query string rather than comparing it", () => {
    // Query strings routinely carry tokens, emails and tracking identifiers,
    // and none of it may reach a stored evidence row (CLAUDE.md rule 37).
    expect(canonicalizeUrl(`${ORIGIN}/pricing?token=secret&utm_source=x`)).toEqual({
      origin: ORIGIN,
      path: "/pricing",
    });
  });
});

describe("contract targets are normalized the same way", () => {
  it.each([
    ["/", "/"],
    ["login", "/login"],
    ["/login/", "/login"],
    ["//login", "/login"],
  ])("normalizes %s to %s", (raw, expected) => {
    expect(canonicalPath(raw)).toBe(expected);
  });
});
