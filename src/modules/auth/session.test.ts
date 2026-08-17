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

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock } })),
}));

const { getSession, requireSession } = await import("./session");

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
