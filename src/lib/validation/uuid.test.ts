import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid";

/**
 * VB-028 — the shape check in front of every id-taking route.
 *
 * The negative cases are the point. Each is a string a person can put in the
 * address bar, and each one reached PostgreSQL as a uuid literal before this
 * existed, where it produced 22P02 and a 500.
 */
describe("what PostgreSQL would accept", () => {
  it("accepts a real uuid in either case", () => {
    expect(isUuid("dcbwlctc-0000-4000-8000-000000000000")).toBe(false); // not hex
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("AABBCCDD-EEFF-4A1B-8C2D-3E4F5A6B7C8D")).toBe(true);
  });

  it("accepts any version, because the question is the literal not the generator", () => {
    // v1, v4 and v7 differ only in the version nibble; all are valid uuids and
    // PostgreSQL takes all of them.
    expect(isUuid("11111111-1111-1111-8111-111111111111")).toBe(true);
    expect(isUuid("11111111-1111-7111-8111-111111111111")).toBe(true);
  });
});

describe("what it refuses", () => {
  const REFUSED = [
    ["the audit's own example", "x"],
    ["empty", ""],
    ["a word", "undefined"],
    ["a number", "12345"],
    ["right length, wrong shape", "111111111111111111111111111111111111"],
    ["one character short", "11111111-1111-4111-8111-11111111111"],
    ["one character long", "11111111-1111-4111-8111-1111111111111"],
    ["non-hex in range", "gggggggg-1111-4111-8111-111111111111"],
    ["surrounding whitespace", " 11111111-1111-4111-8111-111111111111 "],
    ["a SQL fragment", "1' or '1'='1"],
    ["a path traversal", "../../etc/passwd"],
  ] as const;

  for (const [name, value] of REFUSED) {
    it(`refuses ${name}`, () => {
      expect(isUuid(value)).toBe(false);
    });
  }
});
