import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The proxy is where a session is kept alive and where signed-out visitors
 * are turned away, so these tests cover three separate risks:
 *
 * 1. Routing — protected pages refuse, auth pages don't nag, `next` survives.
 * 2. Session survival — a refreshed cookie must reach the browser on *every*
 *    exit path, including redirects. Dropping it rotates a refresh token into
 *    the void and ends the session for good.
 * 3. Cache poisoning — a response carrying `Set-Cookie` must never be
 *    cacheable. Vibe runs behind Vercel's edge; a cached auth response is one
 *    user handed another user's session.
 */

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

const getClaimsMock = vi.fn();

/** Cookies the fake Supabase client will write when asked to refresh. */
let cookiesSupabaseWillSet: CookieToSet[] = [];
/** Cache headers the fake client passes alongside them, as @supabase/ssr does. */
let headersSupabaseWillSet: Record<string, string> = {};

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: {
    cookies: {
      getAll: () => unknown;
      setAll: (cookies: CookieToSet[], headers: Record<string, string>) => void;
    };
  }) => ({
    auth: {
      getClaims: async () => {
        // Real @supabase/ssr writes cookies from inside getClaims() when the
        // token needed refreshing, so the fake does too — that ordering is
        // exactly what the "return supabaseResponse as-is" rule protects.
        if (cookiesSupabaseWillSet.length > 0) {
          options.cookies.setAll(cookiesSupabaseWillSet, headersSupabaseWillSet);
        }
        return getClaimsMock();
      },
    },
  })),
}));

vi.mock("@/lib/env/env", () => ({
  getPublicEnv: vi.fn(() => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  })),
}));

const { updateSession } = await import("./proxy");
const { getPublicEnv } = await import("@/lib/env/env");

const ORIGIN = "https://vibe.test";

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, ORIGIN));
}

function signedIn() {
  getClaimsMock.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
}

function signedOut() {
  getClaimsMock.mockResolvedValue({ data: null, error: null });
}

function locationOf(response: Response): URL | null {
  const location = response.headers.get("location");
  return location ? new URL(location, ORIGIN) : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  cookiesSupabaseWillSet = [];
  headersSupabaseWillSet = {};
  vi.mocked(getPublicEnv).mockReturnValue({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  });
});

describe("protecting /app", () => {
  it("turns a signed-out visitor away from /app", async () => {
    signedOut();

    const response = await updateSession(request("/app"));

    expect(locationOf(response)?.pathname).toBe("/login");
  });

  it("remembers the page they were trying to reach", async () => {
    signedOut();

    const response = await updateSession(request("/app/action-plan/123"));
    const location = locationOf(response);

    expect(location?.pathname).toBe("/login");
    expect(location?.searchParams.get("next")).toBe("/app/action-plan/123");
  });

  it("carries the query string of the requested page too", async () => {
    signedOut();

    const response = await updateSession(request("/app/projects/1?tab=score"));

    expect(locationOf(response)?.searchParams.get("next")).toBe("/app/projects/1?tab=score");
  });

  it("omits next when the destination is just the default", async () => {
    signedOut();

    const response = await updateSession(request("/app"));

    expect(locationOf(response)?.searchParams.get("next")).toBeNull();
  });

  it("lets a signed-in visitor through", async () => {
    signedIn();

    const response = await updateSession(request("/app/projects/1"));

    expect(locationOf(response)).toBeNull();
  });

  it("does not protect paths that merely start with the same letters", async () => {
    signedOut();

    for (const path of ["/application", "/appfoo", "/"]) {
      const response = await updateSession(request(path));
      expect(locationOf(response), `${path} should be public`).toBeNull();
    }
  });

  it("leaves the public marketing page and auth routes reachable when signed out", async () => {
    signedOut();

    for (const path of ["/", "/login", "/signup", "/forgot-password", "/auth/callback?code=x"]) {
      const response = await updateSession(request(path));
      expect(locationOf(response), `${path} should be reachable`).toBeNull();
    }
  });
});

describe("keeping signed-in visitors off the auth screens", () => {
  it("redirects an authenticated visitor away from /login", async () => {
    signedIn();

    const response = await updateSession(request("/login"));

    expect(locationOf(response)?.pathname).toBe("/app");
  });

  it("honours a safe next when bouncing them off /login", async () => {
    signedIn();

    const response = await updateSession(request("/login?next=%2Fapp%2Fprojects%2F3"));

    expect(locationOf(response)?.pathname).toBe("/app/projects/3");
  });

  it("refuses a hostile next when bouncing them off /login", async () => {
    signedIn();

    const response = await updateSession(request("/login?next=https%3A%2F%2Fevil.com"));
    const location = locationOf(response);

    expect(location?.origin).toBe(ORIGIN);
    expect(location?.pathname).toBe("/app");
  });

  it("redirects an authenticated visitor away from /signup", async () => {
    signedIn();

    const response = await updateSession(request("/signup"));

    expect(locationOf(response)?.pathname).toBe("/app");
  });

  /**
   * The recovery flow signs the user in *in order to* let them choose a new
   * password. Treating /reset-password as an auth screen would bounce them to
   * /app at the final step and make password reset impossible.
   */
  it("leaves /reset-password reachable while signed in", async () => {
    signedIn();

    const response = await updateSession(request("/reset-password"));

    expect(locationOf(response)).toBeNull();
  });

  it("leaves /forgot-password reachable while signed in", async () => {
    signedIn();

    const response = await updateSession(request("/forgot-password"));

    expect(locationOf(response)).toBeNull();
  });
});

describe("no redirect loops", () => {
  it("does not send a signed-out visitor from /login to /login", async () => {
    signedOut();

    const response = await updateSession(request("/login"));

    expect(locationOf(response)).toBeNull();
  });

  it("does not send a signed-in visitor from /app back to /app", async () => {
    signedIn();

    const response = await updateSession(request("/app"));

    expect(locationOf(response)).toBeNull();
  });

  /**
   * Both decisions come from one getClaims() call, so they cannot disagree
   * within a request. This pins that: whatever the auth state, following the
   * proxy's answer for /app and then for its own target must terminate.
   */
  it("settles within one hop for both auth states", async () => {
    for (const state of [signedIn, signedOut]) {
      state();
      const first = await updateSession(request("/app"));
      const firstTarget = locationOf(first);
      if (!firstTarget) continue;

      const second = await updateSession(
        request(`${firstTarget.pathname}${firstTarget.search}`),
      );
      expect(locationOf(second)).toBeNull();
    }
  });
});

describe("session survival", () => {
  it("passes refreshed cookies to the browser on a normal request", async () => {
    signedIn();
    cookiesSupabaseWillSet = [
      { name: "sb-project-auth-token", value: "refreshed", options: { path: "/" } },
    ];

    const response = await updateSession(request("/app"));

    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("refreshed");
  });

  /**
   * The expensive one. A refresh rotates the refresh token; if the redirect
   * that follows drops the `Set-Cookie`, the browser keeps a token that has
   * already been spent and the session is unrecoverable.
   */
  it("carries refreshed cookies through a guard redirect", async () => {
    signedOut();
    cookiesSupabaseWillSet = [
      { name: "sb-project-auth-token", value: "refreshed", options: { path: "/" } },
    ];

    const response = await updateSession(request("/app/projects/1"));

    expect(locationOf(response)?.pathname).toBe("/login");
    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("refreshed");
  });

  it("carries refreshed cookies through the signed-in bounce off /login", async () => {
    signedIn();
    cookiesSupabaseWillSet = [
      { name: "sb-project-auth-token", value: "refreshed", options: { path: "/" } },
    ];

    const response = await updateSession(request("/login"));

    expect(locationOf(response)?.pathname).toBe("/app");
    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("refreshed");
  });
});

describe("cache poisoning resistance", () => {
  const CACHE_HEADERS = {
    "cache-control": "private, no-cache, no-store, must-revalidate, max-age=0",
    expires: "0",
    pragma: "no-cache",
  };

  it("applies the cache headers @supabase/ssr sends with a token refresh", async () => {
    signedIn();
    cookiesSupabaseWillSet = [{ name: "sb-project-auth-token", value: "refreshed" }];
    headersSupabaseWillSet = CACHE_HEADERS;

    const response = await updateSession(request("/app"));

    expect(response.headers.get("cache-control")).toBe(CACHE_HEADERS["cache-control"]);
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("keeps those headers on a redirect that also carries Set-Cookie", async () => {
    signedOut();
    cookiesSupabaseWillSet = [{ name: "sb-project-auth-token", value: "refreshed" }];
    headersSupabaseWillSet = CACHE_HEADERS;

    const response = await updateSession(request("/app"));

    expect(locationOf(response)?.pathname).toBe("/login");
    expect(response.headers.get("cache-control")).toBe(CACHE_HEADERS["cache-control"]);
  });

  it("never emits a cacheable response that carries a session cookie", async () => {
    signedIn();
    cookiesSupabaseWillSet = [{ name: "sb-project-auth-token", value: "refreshed" }];
    headersSupabaseWillSet = CACHE_HEADERS;

    for (const path of ["/app", "/login", "/"]) {
      const response = await updateSession(request(path));
      const setsCookie = response.cookies.getAll().length > 0;
      if (!setsCookie) continue;

      const cacheControl = response.headers.get("cache-control") ?? "";
      expect(cacheControl, `${path} sets a cookie and must not be cacheable`).toContain(
        "no-store",
      );
    }
  });
});

describe("degrading safely", () => {
  it("passes the request through untouched when Supabase is not configured", async () => {
    vi.mocked(getPublicEnv).mockImplementation(() => {
      throw new Error("Invalid or missing environment configuration");
    });

    const response = await updateSession(request("/app"));

    // No redirect: a missing environment must not turn every page into a
    // login bounce. requireSession() still refuses in the layout.
    expect(locationOf(response)).toBeNull();
  });

  it("treats an unverifiable token as signed out rather than throwing", async () => {
    getClaimsMock.mockRejectedValue(new Error("jwks fetch failed"));

    const response = await updateSession(request("/app"));

    expect(locationOf(response)?.pathname).toBe("/login");
  });

  it("does not lock a signed-in user out of public pages when verification fails", async () => {
    getClaimsMock.mockRejectedValue(new Error("jwks fetch failed"));

    const response = await updateSession(request("/"));

    expect(locationOf(response)).toBeNull();
  });

  it("treats claims without a subject as signed out", async () => {
    getClaimsMock.mockResolvedValue({ data: { claims: {} }, error: null });

    const response = await updateSession(request("/app"));

    expect(locationOf(response)?.pathname).toBe("/login");
  });
});
