import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = {
  exchangeCodeForSession: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: authMock })),
}));

const { GET } = await import("./route");

const ORIGIN = "https://vibe.test";

function callbackRequest(query: string): NextRequest {
  return new NextRequest(new URL(`/auth/callback${query}`, ORIGIN));
}

/** The `Location` a route handler redirected to, as a URL. */
function redirectTarget(response: Response): URL {
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  return new URL(location as string, ORIGIN);
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("the successful path", () => {
  it("exchanges the code and lands the visitor in the app", async () => {
    authMock.exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(callbackRequest("?code=auth-code-123"));

    expect(authMock.exchangeCodeForSession).toHaveBeenCalledWith("auth-code-123");
    expect(redirectTarget(response).pathname).toBe("/app");
  });

  it("returns the visitor to the page they originally asked for", async () => {
    authMock.exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(
      callbackRequest("?code=auth-code-123&next=%2Fapp%2Faction-plan%2F123"),
    );

    expect(redirectTarget(response).pathname).toBe("/app/action-plan/123");
  });
});

describe("open redirect resistance", () => {
  it.each([
    ["https://evil.com", "/app"],
    ["//evil.com", "/app"],
    ["%2f%2fevil.com", "/app"],
    ["javascript:alert(1)", "/app"],
    ["/login", "/app"],
  ])("refuses next=%s and falls back to %s", async (hostileNext, expected) => {
    authMock.exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(
      callbackRequest(`?code=c&next=${encodeURIComponent(hostileNext)}`),
    );

    const target = redirectTarget(response);
    expect(target.origin).toBe(ORIGIN);
    expect(target.pathname).toBe(expected);
  });

  it("never redirects off-origin, even on the failure path", async () => {
    const response = await GET(
      callbackRequest("?error=server_error&next=https%3A%2F%2Fevil.com"),
    );

    expect(redirectTarget(response).origin).toBe(ORIGIN);
  });
});

describe("provider-reported failures", () => {
  it("reads a cancelled consent screen as cancellation, not an error", async () => {
    const response = await GET(callbackRequest("?error=access_denied"));

    const target = redirectTarget(response);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("error")).toBe("oauth_cancelled");
    expect(authMock.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("reads a provider outage as a retryable OAuth failure", async () => {
    const response = await GET(callbackRequest("?error=server_error"));

    expect(redirectTarget(response).searchParams.get("error")).toBe("oauth_failed");
  });

  it("classifies an unrecognised provider error rather than passing it through", async () => {
    const response = await GET(callbackRequest("?error=something_new_from_google"));

    const target = redirectTarget(response);
    expect(target.searchParams.get("error")).toBe("oauth_failed");
    // The provider's own string never reaches the URL the user sees.
    expect(target.search).not.toContain("something_new_from_google");
  });

  it("keeps the requested destination so a retry still lands correctly", async () => {
    const response = await GET(
      callbackRequest("?error=access_denied&next=%2Fapp%2Fprojects%2F9"),
    );

    expect(redirectTarget(response).searchParams.get("next")).toBe("/app/projects/9");
  });
});

describe("malformed callbacks", () => {
  it("rejects a callback carrying neither a code nor an error", async () => {
    const response = await GET(callbackRequest(""));

    const target = redirectTarget(response);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("error")).toBe("oauth_failed");
    expect(authMock.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("reports a failed exchange without saying why", async () => {
    authMock.exchangeCodeForSession.mockResolvedValue({
      error: { message: "invalid request: both auth code and code verifier should be non-empty", code: "bad_code_verifier", status: 400 },
    });

    const response = await GET(callbackRequest("?code=stale-code"));

    const target = redirectTarget(response);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("error")).toBe("oauth_failed");
  });
});

describe("what must never be logged or leaked", () => {
  it("never puts the authorization code in a log", async () => {
    authMock.exchangeCodeForSession.mockResolvedValue({
      error: { message: "bad verifier", code: "bad_code_verifier", status: 400 },
    });

    await GET(callbackRequest("?code=SECRET-AUTH-CODE"));

    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("SECRET-AUTH-CODE");
  });

  it("never puts the authorization code in the redirect it issues", async () => {
    authMock.exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(callbackRequest("?code=SECRET-AUTH-CODE"));

    expect(response.headers.get("location")).not.toContain("SECRET-AUTH-CODE");
  });

  it("never echoes a provider error description into the redirect", async () => {
    const response = await GET(
      callbackRequest("?error=access_denied&error_description=User%20bob%40example.com%20declined"),
    );

    expect(response.headers.get("location")).not.toContain("bob%40example.com");
    expect(response.headers.get("location")).not.toContain("bob@example.com");
  });
});

/**
 * Regression, verified against a running production build before the fix:
 * `?error=constructor` reached an object-literal lookup, matched
 * `Object.prototype`, and stringified `function Object() { [native code] }`
 * into the redirect the browser followed.
 */
describe("prototype-chain keys in the error parameter", () => {
  it.each(["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"])(
    "classifies ?error=%s instead of echoing an internal",
    async (key) => {
      const response = await GET(callbackRequest(`?error=${key}`));
      const target = redirectTarget(response);

      expect(target.searchParams.get("error")).toBe("oauth_failed");
      expect(target.search).not.toContain("native+code");
      expect(target.search).not.toContain("object+Object");
    },
  );
});
