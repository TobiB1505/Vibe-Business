import { describe, expect, it, vi, beforeEach } from "vitest";

class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

// next/navigation's real redirect() throws to unwind the call stack — the
// mock does the same, so code after a redirect() call in the actions under
// test never executes here either, matching production behavior.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectSignal(url);
  }),
}));

const authMock = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: authMock })),
}));

const { signInWithPassword, signUp, signOut } = await import("./actions");

function formDataWith(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

async function expectRedirectTo(promise: Promise<unknown>, url: string): Promise<void> {
  await expect(promise).rejects.toSatisfy((error: unknown) => {
    return error instanceof RedirectSignal && error.url === url;
  });
}

describe("signInWithPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /app on success", async () => {
    authMock.signInWithPassword.mockResolvedValue({ error: null });

    await expectRedirectTo(
      signInWithPassword(null, formDataWith({ email: "user@example.com", password: "hunter22" })),
      "/app",
    );

    expect(authMock.signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "hunter22",
    });
  });

  it("returns a generic error on invalid credentials — never the raw Supabase message", async () => {
    authMock.signInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials", code: "invalid_credentials", status: 400 },
    });

    const result = await signInWithPassword(
      null,
      formDataWith({ email: "user@example.com", password: "wrong" }),
    );

    expect(result).toEqual({ ok: false, error: "Invalid email or password." });
  });

  it("rejects a missing password without calling Supabase", async () => {
    const result = await signInWithPassword(null, formDataWith({ email: "user@example.com", password: "" }));

    expect(result).toEqual({ ok: false, error: "Enter your email and password." });
    expect(authMock.signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects a missing email without calling Supabase", async () => {
    const result = await signInWithPassword(null, formDataWith({ password: "hunter22" }));

    expect(result).toEqual({ ok: false, error: "Enter your email and password." });
    expect(authMock.signInWithPassword).not.toHaveBeenCalled();
  });

  it("never logs the password, on success or failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    authMock.signInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials", code: "invalid_credentials", status: 400 },
    });

    await signInWithPassword(
      null,
      formDataWith({ email: "user@example.com", password: "super-secret-password" }),
    );

    const loggedText = JSON.stringify(consoleError.mock.calls);
    expect(loggedText).not.toContain("super-secret-password");
    consoleError.mockRestore();
  });
});

describe("signUp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /app when Supabase returns a session immediately (confirm email disabled)", async () => {
    authMock.signUp.mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });

    await expectRedirectTo(
      signUp(null, formDataWith({ email: "new@example.com", password: "hunter22" })),
      "/app",
    );
  });

  it("reports needsConfirmation when no session and no error, instead of crashing", async () => {
    authMock.signUp.mockResolvedValue({ data: { session: null }, error: null });

    const result = await signUp(null, formDataWith({ email: "new@example.com", password: "hunter22" }));

    expect(result).toEqual({ ok: true, needsConfirmation: true });
  });

  it("returns a generic error on signup failure", async () => {
    authMock.signUp.mockResolvedValue({
      data: { session: null },
      error: { message: "User already registered", code: "user_already_exists", status: 400 },
    });

    const result = await signUp(null, formDataWith({ email: "new@example.com", password: "hunter22" }));

    expect(result).toEqual({ ok: false, error: "Could not create an account with those details." });
  });

  it("rejects a short/missing password without calling Supabase", async () => {
    const result = await signUp(null, formDataWith({ email: "new@example.com", password: "" }));

    expect(result).toEqual({ ok: false, error: "Enter your email and password." });
    expect(authMock.signUp).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls supabase.auth.signOut and redirects to /login", async () => {
    authMock.signOut.mockResolvedValue({ error: null });

    await expectRedirectTo(signOut(), "/login");
    expect(authMock.signOut).toHaveBeenCalled();
  });
});
