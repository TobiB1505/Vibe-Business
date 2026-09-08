import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where `openSessionAtOrigin` actually navigates.
 *
 * This is the first thing a founder sees for their 25 Credits, and until now
 * it had no test at all — the file was excluded from unit testing because it
 * imports the browser stack. It does that inside the function, though, which
 * is exactly what makes the import mockable.
 *
 * The behaviour under test is narrow and consequential: a path supplied by
 * the caller comes from the customer's own website, and the last gate before
 * a real browser navigation lives here.
 */

const gotoMock = vi.fn(
  async (_url: string, _options?: unknown): Promise<{ status: () => number } | null> => ({
    status: () => 200,
  }),
);
const closeMock = vi.fn(async () => undefined);

vi.mock("playwright-core", () => ({
  chromium: {
    connectOverCDP: async () => ({
      contexts: () => [
        { pages: () => [{ goto: gotoMock }], newPage: async () => ({ goto: gotoMock }) },
      ],
      close: closeMock,
    }),
  },
}));

const { openSessionAtOrigin } = await import("./connector");

const ORIGIN = "https://app.example.com";
const CONNECT = "ws://127.0.0.1:9222/x";

beforeEach(() => {
  gotoMock.mockReset();
  gotoMock.mockResolvedValue({ status: () => 200 });
});

describe("openSessionAtOrigin", () => {
  it("opens the root when no path is given", async () => {
    const result = await openSessionAtOrigin(CONNECT, ORIGIN);

    expect(result).toEqual({ navigated: true });
    expect(gotoMock).toHaveBeenCalledExactlyOnceWith(ORIGIN, expect.anything());
  });

  it("opens the sign-in path when one is given", async () => {
    await openSessionAtOrigin(CONNECT, ORIGIN, { path: "/login" });

    expect(gotoMock).toHaveBeenCalledExactlyOnceWith(`${ORIGIN}/login`, expect.anything());
  });

  it("ignores a path that resolves to another origin", async () => {
    // Belt and braces: the caller already refuses this, and an origin check
    // that only exists at the caller is one refactor from being gone.
    await openSessionAtOrigin(CONNECT, ORIGIN, { path: "https://evil.example.net/login" });

    expect(gotoMock).toHaveBeenCalledExactlyOnceWith(ORIGIN, expect.anything());
  });

  it("falls back to the root when the sign-in path is gone", async () => {
    /*
     * The real failure this guards. The path comes from a public scan that may
     * be days old; a `goto` to a 404 navigates perfectly well, and the founder
     * would be left looking at their own error page with no address bar to fix
     * it (ADR 0076).
     */
    gotoMock.mockResolvedValueOnce({ status: () => 404 });

    const result = await openSessionAtOrigin(CONNECT, ORIGIN, { path: "/login" });

    expect(result).toEqual({ navigated: true });
    expect(gotoMock).toHaveBeenNthCalledWith(1, `${ORIGIN}/login`, expect.anything());
    expect(gotoMock).toHaveBeenNthCalledWith(2, ORIGIN, expect.anything());
  });

  it("keeps a landing whose response it could not read", async () => {
    // Normal for a document served from cache. Throwing away a good landing
    // over an unreadable response would be the same mistake in reverse.
    gotoMock.mockResolvedValueOnce(null);

    await openSessionAtOrigin(CONNECT, ORIGIN, { path: "/login" });

    expect(gotoMock).toHaveBeenCalledOnce();
  });

  it("reports a landing that threw, rather than pretending it worked", async () => {
    gotoMock.mockRejectedValueOnce(new Error("net::ERR_CONNECTION_REFUSED"));

    const result = await openSessionAtOrigin(CONNECT, ORIGIN, { path: "/login" });

    // Narrowed rather than asserted: `SessionLanding` only carries a reason on
    // the failing side, which is the whole point of its shape.
    expect(result.navigated).toBe(false);
    if (result.navigated) throw new Error("expected the landing to fail");
    expect(result.reason).toContain("ERR_CONNECTION_REFUSED");
  });
});
