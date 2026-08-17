import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = {
  verifyOtp: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: authMock })),
}));

const { GET } = await import("./route");

const ORIGIN = "https://vibe.test";

function confirmRequest(query: string): NextRequest {
  return new NextRequest(new URL(`/auth/confirm${query}`, ORIGIN));
}

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

describe("signup confirmation", () => {
  it("verifies the emailed token and lands the new user in the app", async () => {
    authMock.verifyOtp.mockResolvedValue({ error: null });

    const response = await GET(confirmRequest("?token_hash=abc123&type=signup"));

    expect(authMock.verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "abc123" });
    expect(redirectTarget(response).pathname).toBe("/app");
  });

  it("honours the destination the signup carried", async () => {
    authMock.verifyOtp.mockResolvedValue({ error: null });

    const response = await GET(
      confirmRequest("?token_hash=abc123&type=signup&next=%2Fapp%2Fprojects%2F4"),
    );

    expect(redirectTarget(response).pathname).toBe("/app/projects/4");
  });

  it("refuses a hostile destination on an otherwise valid link", async () => {
    authMock.verifyOtp.mockResolvedValue({ error: null });

    const response = await GET(
      confirmRequest("?token_hash=abc123&type=signup&next=https%3A%2F%2Fevil.com"),
    );

    const target = redirectTarget(response);
    expect(target.origin).toBe(ORIGIN);
    expect(target.pathname).toBe("/app");
  });
});

describe("password recovery", () => {
  it("sends a verified recovery link to the set-a-new-password screen", async () => {
    authMock.verifyOtp.mockResolvedValue({ error: null });

    const response = await GET(confirmRequest("?token_hash=rec123&type=recovery"));

    expect(redirectTarget(response).pathname).toBe("/reset-password");
  });

  it("ignores next on a recovery link — the password step is not optional", async () => {
    authMock.verifyOtp.mockResolvedValue({ error: null });

    const response = await GET(
      confirmRequest("?token_hash=rec123&type=recovery&next=%2Fapp%2Fprojects%2F4"),
    );

    expect(redirectTarget(response).pathname).toBe("/reset-password");
  });

  it("sends an expired recovery link somewhere that can issue a new one", async () => {
    authMock.verifyOtp.mockResolvedValue({
      error: { message: "Token has expired or is invalid", code: "otp_expired", status: 403 },
    });

    const response = await GET(confirmRequest("?token_hash=stale&type=recovery"));

    const target = redirectTarget(response);
    expect(target.pathname).toBe("/forgot-password");
    expect(target.searchParams.get("error")).toBe("expired_link");
  });
});

describe("invalid links", () => {
  it("rejects a link with no token", async () => {
    const response = await GET(confirmRequest("?type=signup"));

    expect(redirectTarget(response).pathname).toBe("/login");
    expect(authMock.verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects a link with no type", async () => {
    const response = await GET(confirmRequest("?token_hash=abc123"));

    expect(redirectTarget(response).pathname).toBe("/login");
    expect(authMock.verifyOtp).not.toHaveBeenCalled();
  });

  it("refuses an OTP type outside the accepted set rather than passing it through", async () => {
    const response = await GET(confirmRequest("?token_hash=abc123&type=sms_or_something"));

    expect(redirectTarget(response).pathname).toBe("/login");
    expect(authMock.verifyOtp).not.toHaveBeenCalled();
  });

  it("handles Supabase bouncing here with an error instead of a token", async () => {
    const response = await GET(
      confirmRequest("?error=access_denied&error_code=otp_expired&type=recovery"),
    );

    expect(redirectTarget(response).pathname).toBe("/forgot-password");
    expect(authMock.verifyOtp).not.toHaveBeenCalled();
  });

  it("reports a tampered token as an expired link, not as a technical failure", async () => {
    authMock.verifyOtp.mockResolvedValue({
      error: { message: "invalid hash", code: "validation_failed", status: 403 },
    });

    const response = await GET(confirmRequest("?token_hash=tampered&type=signup"));

    const target = redirectTarget(response);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("error")).toBe("expired_link");
  });
});

describe("what must never leak", () => {
  it("never carries the one-time token into the redirect", async () => {
    authMock.verifyOtp.mockResolvedValue({ error: null });

    const response = await GET(confirmRequest("?token_hash=SECRET-TOKEN-HASH&type=signup"));

    expect(response.headers.get("location")).not.toContain("SECRET-TOKEN-HASH");
  });

  it("never carries the one-time token into the failure redirect either", async () => {
    authMock.verifyOtp.mockResolvedValue({
      error: { message: "expired", code: "otp_expired", status: 403 },
    });

    const response = await GET(confirmRequest("?token_hash=SECRET-TOKEN-HASH&type=recovery"));

    expect(response.headers.get("location")).not.toContain("SECRET-TOKEN-HASH");
  });

  it("never logs the one-time token", async () => {
    authMock.verifyOtp.mockResolvedValue({
      error: { message: "expired", code: "otp_expired", status: 403 },
    });

    await GET(confirmRequest("?token_hash=SECRET-TOKEN-HASH&type=signup"));

    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("SECRET-TOKEN-HASH");
  });
});
