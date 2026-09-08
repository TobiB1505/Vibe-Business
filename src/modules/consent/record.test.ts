import { describe, expect, it } from "vitest";
import { ACCEPT_ALL, OPTIONAL_CATEGORIES, REJECT_ALL } from "./categories";
import {
  CONSENT_VERSION,
  allowedCategories,
  consentCookieString,
  decodeConsent,
  encodeConsent,
  needsDecision,
} from "./record";

/**
 * The one rule this whole feature rests on (UI-23).
 *
 * Everything optional is off until a decision says otherwise. A consent system
 * that resolves an unreadable value, a missing value or a stale value to
 * *anything* other than "off" is a consent system that consents on somebody's
 * behalf, which is the failure the law and the banner both exist to prevent.
 */
describe("what is allowed before anyone has decided", () => {
  it("allows nothing optional", () => {
    for (const value of [null, undefined, "", "   "]) {
      expect(allowedCategories(value), `${JSON.stringify(value)} allowed something`).toEqual(
        REJECT_ALL,
      );
      expect(needsDecision(value)).toBe(true);
    }
  });

  it("allows nothing for a value it did not write", () => {
    const forged = [
      "yes",
      "v1",
      "v1.111",
      "v1.1111.1757246400",
      "v1.11.1757246400",
      "v1.abc.1757246400",
      "v1.111.0",
      "v1.111.-5",
      "{\"analytics\":true}",
      "v1.111.1757246400; marketing=1",
    ];
    for (const value of forged) {
      expect(decodeConsent(value), `${value} decoded`).toBeNull();
      expect(allowedCategories(value), `${value} allowed something`).toEqual(REJECT_ALL);
    }
  });

  /**
   * A record answering a different list is not an answer to this one. Adding a
   * recipient and reading an old "yes" as covering it is consenting on
   * somebody's behalf with extra steps.
   */
  it("allows nothing for a decision made against a different list", () => {
    const stale = encodeConsent({
      version: CONSENT_VERSION + 1,
      choices: ACCEPT_ALL,
      decidedAt: 1757246400,
    });

    expect(decodeConsent(stale)).toBeNull();
    expect(allowedCategories(stale)).toEqual(REJECT_ALL);
    expect(needsDecision(stale)).toBe(true);
  });
});

describe("a decision survives the round trip", () => {
  it("keeps every category exactly as it was set", () => {
    // Every combination, not a sample: the flags are positional, and a
    // transposition is invisible in any single case where two agree.
    const total = 2 ** OPTIONAL_CATEGORIES.length;
    for (let mask = 0; mask < total; mask += 1) {
      const choices = { ...REJECT_ALL };
      OPTIONAL_CATEGORIES.forEach((category, index) => {
        choices[category] = Boolean(mask & (1 << index));
      });

      const encoded = encodeConsent({
        version: CONSENT_VERSION,
        choices,
        decidedAt: 1757246400,
      });
      expect(decodeConsent(encoded)?.choices, encoded).toEqual(choices);
    }
  });

  it("carries no identifier of any kind", () => {
    const encoded = encodeConsent({
      version: CONSENT_VERSION,
      choices: ACCEPT_ALL,
      decidedAt: 1757246400,
    });
    // Version, flags, timestamp. Nothing that could name a person or a visit.
    expect(encoded).toMatch(/^v\d+\.[01]+\.\d+$/);
  });

  it("rounds the timestamp to whole seconds", () => {
    const encoded = encodeConsent({
      version: CONSENT_VERSION,
      choices: REJECT_ALL,
      decidedAt: 1757246400.987,
    });
    expect(encoded.endsWith(".1757246400")).toBe(true);
  });
});

describe("the cookie it writes", () => {
  const record = { version: CONSENT_VERSION, choices: ACCEPT_ALL, decidedAt: 1757246400 };

  it("is scoped, long-lived and same-site", () => {
    const cookie = consentCookieString(record, true);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).toContain("Secure");
  });

  /**
   * `Secure` on `http://localhost` stops the cookie being stored at all, which
   * would make consent untestable in development — and an untested consent
   * system is how one ships broken.
   */
  it("drops Secure where the browser would drop the cookie", () => {
    expect(consentCookieString(record, false)).not.toContain("Secure");
  });

  it("is not httpOnly, because the page that asks must also be able to read it", () => {
    expect(consentCookieString(record, true)).not.toContain("HttpOnly");
  });
});
