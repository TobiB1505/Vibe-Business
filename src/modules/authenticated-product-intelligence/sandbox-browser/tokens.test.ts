import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BROWSER_RUNTIME_VERSION } from "./guard-program";
import { deriveBrowserSessionTokens, tokenMatches } from "./tokens";

/**
 * The two capabilities, and the properties that make them two.
 *
 * Short tests for a short file, and they exist because every failure here is
 * silent: a derivation that ignores its purpose, one that ignores its sandbox,
 * and a comparison that answers on the first differing byte all look exactly
 * like a working one from the outside.
 */

const SECRET = { VIBE_BROWSER_SESSION_SECRET: "a".repeat(48) };
const OTHER_SECRET = { VIBE_BROWSER_SESSION_SECRET: "b".repeat(48) };

const forSandbox = (name: string, source = SECRET) => deriveBrowserSessionTokens(name, source);

describe("derivation", () => {
  it("gives the control and view channels different tokens", () => {
    const tokens = forSandbox("vibe-browser-1");

    // The whole point of there being two. If these were ever equal, the live
    // view — which travels to a browser — would speak CDP.
    expect(tokens.control).not.toBe(tokens.view);
  });

  it("returns the same pair for the same sandbox", () => {
    // The property the two-request login flow depends on: the session is
    // created in one invocation and reconnected in another, with nothing
    // shared but the sandbox name.
    expect(forSandbox("vibe-browser-1")).toEqual(forSandbox("vibe-browser-1"));
  });

  it("binds a token to one sandbox", () => {
    const a = forSandbox("vibe-browser-1");
    const b = forSandbox("vibe-browser-2");

    // A token for one session must open nothing in another, including a
    // session belonging to a different customer.
    expect(a.control).not.toBe(b.control);
    expect(a.view).not.toBe(b.view);
  });

  it("binds a token to the guard version that will check it", () => {
    // Recomputed here rather than asserted as a literal, so the test says
    // *that* the version participates without pinning a hash that would have
    // to be edited every time the guard changes.
    const expected = createHmac("sha256", SECRET.VIBE_BROWSER_SESSION_SECRET)
      .update(`${BROWSER_RUNTIME_VERSION}:control:vibe-browser-1`)
      .digest("hex");

    expect(forSandbox("vibe-browser-1").control).toBe(expected);
  });

  it("changes completely under a different secret", () => {
    const a = forSandbox("vibe-browser-1");
    const b = forSandbox("vibe-browser-1", OTHER_SECRET);

    expect(a.control).not.toBe(b.control);
    expect(a.view).not.toBe(b.view);
  });

  it("derives 32 bytes as hex", () => {
    const { control, view } = forSandbox("vibe-browser-1");

    expect(control).toMatch(/^[0-9a-f]{64}$/);
    expect(view).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a secret too short to be unguessable", () => {
    // The one way this scheme fails quietly: every token stays well-formed and
    // the whole set becomes searchable.
    expect(() => forSandbox("vibe-browser-1", { VIBE_BROWSER_SESSION_SECRET: "short" })).toThrow(
      /VIBE_BROWSER_SESSION_SECRET/,
    );
  });

  it("names the variable in that error without echoing its value", () => {
    const secret = "c".repeat(8);
    try {
      forSandbox("vibe-browser-1", { VIBE_BROWSER_SESSION_SECRET: secret });
      expect.unreachable("a short secret must be refused");
    } catch (error) {
      expect(String(error)).toContain("VIBE_BROWSER_SESSION_SECRET");
      expect(String(error)).not.toContain(secret);
    }
  });
});

describe("comparison", () => {
  it("accepts the exact token", () => {
    const { control } = forSandbox("vibe-browser-1");

    expect(tokenMatches(control, control)).toBe(true);
  });

  it("refuses a different token of the same length", () => {
    const a = forSandbox("vibe-browser-1").control;
    const b = forSandbox("vibe-browser-1").view;

    expect(tokenMatches(a, b)).toBe(false);
  });

  it("refuses a prefix rather than throwing on it", () => {
    const { control } = forSandbox("vibe-browser-1");

    // `timingSafeEqual` throws on a length mismatch. A guard that let that
    // escape would answer a truncated token with a 500 instead of a refusal,
    // which is a different observable answer — and therefore an oracle.
    expect(tokenMatches(control.slice(0, 10), control)).toBe(false);
    expect(tokenMatches("", control)).toBe(false);
  });

  it("refuses a non-string without throwing", () => {
    const { control } = forSandbox("vibe-browser-1");

    // Arrives from a query string, so it can be an array or absent.
    expect(tokenMatches(undefined as unknown as string, control)).toBe(false);
    expect(tokenMatches(["a"] as unknown as string, control)).toBe(false);
  });
});
