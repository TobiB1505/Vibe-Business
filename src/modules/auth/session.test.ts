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

const getUserMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const { getSession, requireSession } = await import("./session");

describe("getSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no user is signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect(await getSession()).toBeNull();
  });

  it("returns the session when a user is signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "user@example.com" } } });
    expect(await getSession()).toEqual({ userId: "user-1", email: "user@example.com" });
  });

  it("defaults email to null when Supabase doesn't return one", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: undefined } } });
    expect(await getSession()).toEqual({ userId: "user-1", email: null });
  });
});

describe("requireSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the session when signed in — the authenticated /app behavior", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "user@example.com" } } });
    expect(await requireSession()).toEqual({ userId: "user-1", email: "user@example.com" });
  });

  it("redirects to /login when signed out — the unauthenticated /app behavior", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await expect(requireSession()).rejects.toSatisfy((error: unknown) => {
      return error instanceof RedirectSignal && error.url === "/login";
    });
  });
});
