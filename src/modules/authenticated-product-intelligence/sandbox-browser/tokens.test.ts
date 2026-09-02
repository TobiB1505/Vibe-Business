import { describe, expect, it } from "vitest";
import { mintBrowserSessionTokens, tokenMatches } from "./tokens";

/**
 * The two capabilities, and the one property that matters about each.
 *
 * These are short tests for a short file, and they exist because the failure
 * they guard against is silent: a token generator that repeats, or a comparison
 * that answers on the first differing byte, both look exactly like a working
 * one from the outside.
 */

describe("minting", () => {
  it("gives the control and view channels different tokens", () => {
    const tokens = mintBrowserSessionTokens();

    // The whole point of there being two. If these were ever equal, the live
    // view — which travels to a browser — would speak CDP.
    expect(tokens.control).not.toBe(tokens.view);
  });

  it("never repeats a token across sessions", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const { control, view } = mintBrowserSessionTokens();
      seen.add(control);
      seen.add(view);
    }

    expect(seen.size).toBe(400);
  });

  it("mints 32 bytes as hex", () => {
    const { control, view } = mintBrowserSessionTokens();

    expect(control).toMatch(/^[0-9a-f]{64}$/);
    expect(view).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("comparison", () => {
  it("accepts the exact token", () => {
    const { control } = mintBrowserSessionTokens();

    expect(tokenMatches(control, control)).toBe(true);
  });

  it("refuses a different token of the same length", () => {
    const a = mintBrowserSessionTokens().control;
    const b = mintBrowserSessionTokens().control;

    expect(tokenMatches(a, b)).toBe(false);
  });

  it("refuses a prefix rather than throwing on it", () => {
    const { control } = mintBrowserSessionTokens();

    // `timingSafeEqual` throws on a length mismatch. A guard that let that
    // escape would answer a truncated token with a 500 instead of a refusal,
    // which is a different observable answer — and therefore an oracle.
    expect(tokenMatches(control.slice(0, 10), control)).toBe(false);
    expect(tokenMatches("", control)).toBe(false);
  });

  it("refuses a non-string without throwing", () => {
    const { control } = mintBrowserSessionTokens();

    // Arrives from a query string, so it can be an array or absent.
    expect(tokenMatches(undefined as unknown as string, control)).toBe(false);
    expect(tokenMatches(["a"] as unknown as string, control)).toBe(false);
  });
});
