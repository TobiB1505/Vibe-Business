import { describe, expect, it, vi, beforeEach } from "vitest";

class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectSignal(url);
  }),
}));

const getClaimsMock = vi.fn();
const createClientMock = vi.fn(async () => ({ auth: { getClaims: getClaimsMock } }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...(args as [])),
}));

const { getSession, requireSession } = await import("./session");
const { MissingEnvironmentError } = await import("@/lib/env/env");

/** The shape `getClaims()` resolves to for a verified JWT. */
function verifiedClaims(claims: Record<string, unknown>) {
  return { data: { claims }, error: null };
}

describe("getSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no user is signed in", async () => {
    getClaimsMock.mockResolvedValue({ data: null, error: null });
    expect(await getSession()).toBeNull();
  });

  it("returns the session when a user is signed in", async () => {
    getClaimsMock.mockResolvedValue(
      verifiedClaims({ sub: "user-1", email: "user@example.com" }),
    );
    expect(await getSession()).toEqual({ userId: "user-1", email: "user@example.com" });
  });

  it("defaults email to null when the token carries no email claim", async () => {
    getClaimsMock.mockResolvedValue(verifiedClaims({ sub: "user-1" }));
    expect(await getSession()).toEqual({ userId: "user-1", email: null });
  });

  it("fails closed when verification returns an error", async () => {
    getClaimsMock.mockResolvedValue({ data: null, error: { message: "bad signature" } });
    expect(await getSession()).toBeNull();
  });

  it("fails closed when verification throws, rather than propagating", async () => {
    getClaimsMock.mockRejectedValue(new Error("jwks fetch failed"));
    await expect(getSession()).resolves.toBeNull();
  });

  /**
   * A verified token always carries a string `sub`. Anything else means the
   * claims did not come from where we think they did, so it must not become
   * a user id that downstream queries filter ownership on.
   */
  it("refuses claims without a usable subject", async () => {
    for (const sub of [undefined, null, 42, {}, ""]) {
      getClaimsMock.mockResolvedValue(verifiedClaims({ sub }));
      expect(await getSession()).toBeNull();
    }
  });
});

describe("requireSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the session when signed in — the authenticated /app behavior", async () => {
    getClaimsMock.mockResolvedValue(
      verifiedClaims({ sub: "user-1", email: "user@example.com" }),
    );
    expect(await requireSession()).toEqual({ userId: "user-1", email: "user@example.com" });
  });

  it("redirects to /login when signed out — the unauthenticated /app behavior", async () => {
    getClaimsMock.mockResolvedValue({ data: null, error: null });

    await expect(requireSession()).rejects.toSatisfy((error: unknown) => {
      return error instanceof RedirectSignal && error.url === "/login";
    });
  });

  it("carries the requested page through so the visitor lands where they aimed", async () => {
    getClaimsMock.mockResolvedValue({ data: null, error: null });

    await expect(requireSession("/app/action-plan/123")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof RedirectSignal &&
        error.url === "/login?next=%2Fapp%2Faction-plan%2F123",
    );
  });

  it("never echoes a hostile requested path into the login URL", async () => {
    getClaimsMock.mockResolvedValue({ data: null, error: null });

    await expect(requireSession("https://evil.com")).rejects.toSatisfy(
      (error: unknown) => error instanceof RedirectSignal && error.url === "/login",
    );
  });

  it("redirects rather than throwing when verification fails", async () => {
    getClaimsMock.mockRejectedValue(new Error("network"));

    await expect(requireSession()).rejects.toSatisfy(
      (error: unknown) => error instanceof RedirectSignal && error.url === "/login",
    );
  });
});

describe("what getSession absorbs, and what it must not (PERF-024)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockImplementation(async () => ({ auth: { getClaims: getClaimsMock } }));
  });

  it("treats a missing configuration as signed out, loudly", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    createClientMock.mockRejectedValue(new MissingEnvironmentError("no NEXT_PUBLIC_SUPABASE_URL"));

    expect(await getSession()).toBeNull();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("rethrows everything else, so a framework signal reaches the framework", async () => {
    /*
     * The reason this matters more than the log noise it removed.
     *
     * `createClient` awaits `cookies()` before it reads the environment, and
     * during static generation that raises Next's `DynamicServerError` — the
     * signal that the route is dynamic. The old catch absorbed it and answered
     * `null`, so a caller asking "is anyone signed in" got "no" for a question
     * the framework was trying to refuse, twenty-five times per build.
     *
     * A plain Error stands in for it here on purpose: recognising the real one
     * needs `isDynamicServerError` from under `next/dist/`, and the fix is
     * deliberately the inversion — absorb the one known case, rethrow the rest
     * — rather than a deep import into a framework's internals.
     */
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    createClientMock.mockRejectedValue(new Error("DYNAMIC_SERVER_USAGE"));

    await expect(getSession()).rejects.toThrow("DYNAMIC_SERVER_USAGE");
    expect(error, "a rethrown error must not also be logged as a misconfiguration").not.toHaveBeenCalled();
    error.mockRestore();
  });
});
