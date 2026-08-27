import { describe, expect, it, vi } from "vitest";
import { AUTH_COOKIE_OPTIONS } from "./cookie-options";

/**
 * VB-006 — the auth cookie's transport rules, and that all three factories use
 * them.
 *
 * The finding was not that `secure` was set wrong. It was that nobody passed
 * `cookieOptions` at all, so the session cookie carried `@supabase/ssr`'s
 * library defaults on a host that is only ever served over HTTPS.
 *
 * Two things are asserted, and the second is the one that matters. A constant
 * saying `secure: true` proves nothing on its own — the original defect was a
 * correct value that no factory was given. So each factory is invoked and asked
 * what it actually handed the library, in the same shape `server.test.ts` uses
 * to prove the clock-skew retry is reachable rather than merely written.
 *
 * The audit's own verification — "Set-Cookie shows `Secure` after refresh" —
 * needs a live Supabase session and is not reproducible here: the E2E
 * environment points at a project that does not exist, so no cookie is ever
 * issued. What is provable without one is the wiring, which is where the defect
 * was.
 */

const createServerClientMock = vi.fn(() => ({ auth: {}, from: vi.fn() }));
const createBrowserClientMock = vi.fn(() => ({ auth: {}, from: vi.fn() }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClientMock(...(args as [])),
  createBrowserClient: (...args: unknown[]) => createBrowserClientMock(...(args as [])),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

vi.mock("@/lib/env/env", () => ({
  getPublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  }),
}));

function optionsFrom(mock: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const call = mock.mock.calls.at(-1);
  return (call?.[2] ?? {}) as Record<string, unknown>;
}

describe("the auth cookie's transport rules", () => {
  it("refuses to travel over plain HTTP", () => {
    expect(AUTH_COOKIE_OPTIONS.secure).toBe(true);
  });

  /**
   * `httpOnly` is deliberately unset rather than false: `@supabase/ssr`'s
   * browser client reads this cookie from `document.cookie`, so setting it
   * would break the client factory outright. Pinned so a future "hardening"
   * pass finds the reason here instead of discovering it in production.
   */
  it("does not claim httpOnly, which the browser client cannot work under", () => {
    expect(AUTH_COOKIE_OPTIONS.httpOnly).toBeUndefined();
  });
});

describe("every factory that writes the cookie", () => {
  it("the server client passes them", async () => {
    const { createClient } = await import("./server");
    await createClient();

    expect(optionsFrom(createServerClientMock).cookieOptions).toBe(AUTH_COOKIE_OPTIONS);
  });

  it("the browser client passes them", async () => {
    const { createClient } = await import("./client");
    createClient();

    expect(optionsFrom(createBrowserClientMock).cookieOptions).toBe(AUTH_COOKIE_OPTIONS);
  });

  /**
   * The proxy is the one that matters most in practice: it is what refreshes
   * the session on every matched request, so it writes this cookie far more
   * often than either of the other two.
   */
  it("the proxy passes them", async () => {
    const { NextRequest } = await import("next/server");
    const { updateSession } = await import("./proxy");

    await updateSession(new NextRequest("https://vibe.test/app"));

    const serverCalls = createServerClientMock.mock.calls;
    expect(serverCalls.length).toBeGreaterThan(0);
    expect(optionsFrom(createServerClientMock).cookieOptions).toBe(AUTH_COOKIE_OPTIONS);
  });
});
