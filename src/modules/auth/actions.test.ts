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

const requestHeaders = new Map<string, string>([["host", "vibe.test"], ["x-forwarded-proto", "https"]]);

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => requestHeaders.get(name.toLowerCase()) ?? null,
  })),
}));

const authMock = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  signInWithOAuth: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  getClaims: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: authMock })),
}));

const {
  signInWithPassword,
  signUp,
  signOut,
  signInWithGoogle,
  requestPasswordReset,
  updatePassword,
} = await import("./actions");

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

/** The error shapes Supabase actually produces, kept in one place. */
const SUPABASE_ERRORS = {
  invalidCredentials: {
    message: "Invalid login credentials",
    code: "invalid_credentials",
    status: 400,
  },
  emailNotConfirmed: {
    message: "Email not confirmed",
    code: "email_not_confirmed",
    status: 400,
  },
  network: { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 },
  rateLimited: { message: "Too many requests", code: "over_email_send_rate_limit", status: 429 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("signInWithPassword", () => {
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

  it("returns to the page the visitor originally asked for", async () => {
    authMock.signInWithPassword.mockResolvedValue({ error: null });

    await expectRedirectTo(
      signInWithPassword(
        null,
        formDataWith({
          email: "user@example.com",
          password: "hunter22",
          next: "/app/action-plan/123",
        }),
      ),
      "/app/action-plan/123",
    );
  });

  it.each([
    ["https://evil.com"],
    ["//evil.com"],
    ["\\evil.com"],
    ["javascript:alert(1)"],
    ["%2f%2fevil.com"],
    ["/login"],
  ])("refuses to redirect to %s after a successful sign-in", async (hostileNext) => {
    authMock.signInWithPassword.mockResolvedValue({ error: null });

    await expectRedirectTo(
      signInWithPassword(
        null,
        formDataWith({ email: "user@example.com", password: "hunter22", next: hostileNext }),
      ),
      "/app",
    );
  });

  it("returns a generic error on invalid credentials — never the raw Supabase message", async () => {
    authMock.signInWithPassword.mockResolvedValue({ error: SUPABASE_ERRORS.invalidCredentials });

    const result = await signInWithPassword(
      null,
      formDataWith({ email: "user@example.com", password: "wrong" }),
    );

    expect(result).toEqual({ ok: false, error: "Invalid email or password." });
  });

  it("tells an unconfirmed user what is actually blocking them", async () => {
    authMock.signInWithPassword.mockResolvedValue({ error: SUPABASE_ERRORS.emailNotConfirmed });

    const result = await signInWithPassword(
      null,
      formDataWith({ email: "user@example.com", password: "hunter22" }),
    );

    expect(result).toEqual({
      ok: false,
      error: "Please confirm your email before signing in.",
    });
  });

  it("distinguishes an unreachable server from a rejected password", async () => {
    authMock.signInWithPassword.mockResolvedValue({ error: SUPABASE_ERRORS.network });

    const result = await signInWithPassword(
      null,
      formDataWith({ email: "user@example.com", password: "hunter22" }),
    );

    expect(result).toEqual({
      ok: false,
      error: "We couldn't reach the server. Please try again.",
    });
  });

  it("rejects a missing password without calling Supabase", async () => {
    const result = await signInWithPassword(
      null,
      formDataWith({ email: "user@example.com", password: "" }),
    );

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
    authMock.signInWithPassword.mockResolvedValue({ error: SUPABASE_ERRORS.invalidCredentials });

    await signInWithPassword(
      null,
      formDataWith({ email: "user@example.com", password: "super-secret-password" }),
    );

    const loggedText = JSON.stringify(consoleError.mock.calls);
    expect(loggedText).not.toContain("super-secret-password");
    expect(loggedText).not.toContain("user@example.com");
    consoleError.mockRestore();
  });
});

describe("signUp", () => {
  /**
   * The password rule is Vibe's, not only the provider's (VB-037).
   *
   * Sign-up used to hand the password straight to Supabase, whose minimum is a
   * dashboard setting — so the product's own password rule was something no
   * reader of this repository could determine, and the audit found it sitting
   * at six.
   */
  it("refuses a password shorter than eight characters, without asking Supabase", async () => {
    const result = await signUp(null, formDataWith({ email: "new@example.com", password: "hunter2" }));

    expect(result).toEqual({ ok: false, error: "Choose a password with at least 8 characters." });
    expect(authMock.signUp).not.toHaveBeenCalled();
  });

  // The accepting side needs no test of its own: every existing case below
  // signs up with `hunter22`, which is exactly eight.

  it("redirects to /app when Supabase returns a session immediately (confirm email disabled)", async () => {
    authMock.signUp.mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });

    await expectRedirectTo(
      signUp(null, formDataWith({ email: "new@example.com", password: "hunter22" })),
      "/app",
    );
  });

  it("points the confirmation link at our own confirm route, carrying the destination", async () => {
    authMock.signUp.mockResolvedValue({ data: { session: null }, error: null });

    await signUp(
      null,
      formDataWith({ email: "new@example.com", password: "hunter22", next: "/app/projects/7" }),
    );

    expect(authMock.signUp).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "hunter22",
      options: {
        emailRedirectTo: "https://vibe.test/auth/confirm?next=%2Fapp%2Fprojects%2F7",
      },
    });
  });

  it("reports needsConfirmation when no session and no error, instead of crashing", async () => {
    authMock.signUp.mockResolvedValue({ data: { session: null }, error: null });

    const result = await signUp(
      null,
      formDataWith({ email: "new@example.com", password: "hunter22" }),
    );

    expect(result).toEqual({ ok: true, needsConfirmation: true });
  });

  it("returns a generic error on signup failure", async () => {
    authMock.signUp.mockResolvedValue({
      data: { session: null },
      error: { message: "User already registered", code: "user_already_exists", status: 400 },
    });

    const result = await signUp(
      null,
      formDataWith({ email: "new@example.com", password: "hunter22" }),
    );

    expect(result).toEqual({ ok: false, error: "Could not create an account with those details." });
  });

  it("does not reveal that an account already exists for that address", async () => {
    authMock.signUp.mockResolvedValue({
      data: { session: null },
      error: { message: "User already registered", code: "user_already_exists", status: 400 },
    });

    const existing = await signUp(
      null,
      formDataWith({ email: "taken@example.com", password: "hunter22" }),
    );

    authMock.signUp.mockResolvedValue({
      data: { session: null },
      error: { message: "Signup failed", code: "validation_failed", status: 400 },
    });

    const other = await signUp(
      null,
      formDataWith({ email: "fresh@example.com", password: "hunter22" }),
    );

    // Identical copy in both cases: the screen cannot be used to test whether
    // an address has an account.
    expect(existing).toEqual(other);
  });

  it("rejects a short/missing password without calling Supabase", async () => {
    const result = await signUp(null, formDataWith({ email: "new@example.com", password: "" }));

    expect(result).toEqual({ ok: false, error: "Enter your email and password." });
    expect(authMock.signUp).not.toHaveBeenCalled();
  });
});

describe("signInWithGoogle", () => {
  it("asks Supabase for a Google URL pointing back at our callback", async () => {
    authMock.signInWithOAuth.mockResolvedValue({
      data: { url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x" },
      error: null,
    });

    await expectRedirectTo(
      signInWithGoogle(null, formDataWith({})),
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
    );

    expect(authMock.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://vibe.test/auth/callback?next=%2Fapp",
        skipBrowserRedirect: true,
      },
    });
  });

  it("preserves a safe requested destination through the OAuth round trip", async () => {
    authMock.signInWithOAuth.mockResolvedValue({
      data: { url: "https://accounts.google.com/x" },
      error: null,
    });

    await expectRedirectTo(
      signInWithGoogle(null, formDataWith({ next: "/app/action-plan/123" })),
      "https://accounts.google.com/x",
    );

    expect(authMock.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          redirectTo: "https://vibe.test/auth/callback?next=%2Fapp%2Faction-plan%2F123",
        }),
      }),
    );
  });

  it("never forwards a hostile destination to the provider", async () => {
    authMock.signInWithOAuth.mockResolvedValue({
      data: { url: "https://accounts.google.com/x" },
      error: null,
    });

    await expectRedirectTo(
      signInWithGoogle(null, formDataWith({ next: "https://evil.com" })),
      "https://accounts.google.com/x",
    );

    expect(authMock.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          redirectTo: "https://vibe.test/auth/callback?next=%2Fapp",
        }),
      }),
    );
  });

  it("returns friendly copy when the provider cannot be reached", async () => {
    authMock.signInWithOAuth.mockResolvedValue({ data: null, error: SUPABASE_ERRORS.network });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await signInWithGoogle(null, formDataWith({}));
    consoleError.mockRestore();

    expect(result).toEqual({
      ok: false,
      error: "We couldn't sign you in with Google. Please try again.",
    });
  });

  it("treats a missing URL as a failure rather than redirecting nowhere", async () => {
    authMock.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: null });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await signInWithGoogle(null, formDataWith({}));
    consoleError.mockRestore();

    expect(result).toEqual({
      ok: false,
      error: "We couldn't sign you in with Google. Please try again.",
    });
  });
});

describe("requestPasswordReset", () => {
  it("asks Supabase to send a link pointing at our confirm route", async () => {
    authMock.resetPasswordForEmail.mockResolvedValue({ error: null });

    const result = await requestPasswordReset(null, formDataWith({ email: "user@example.com" }));

    expect(result).toEqual({ ok: true });
    expect(authMock.resetPasswordForEmail).toHaveBeenCalledWith("user@example.com", {
      redirectTo: "https://vibe.test/auth/confirm?next=%2Fapp&flow=recovery",
    });
  });

  /**
   * The anti-enumeration property, stated as a test so a future refactor that
   * "improves the error message" fails here rather than in the wild.
   */
  it("answers identically whether or not the address has an account", async () => {
    authMock.resetPasswordForEmail.mockResolvedValue({ error: null });
    const known = await requestPasswordReset(null, formDataWith({ email: "known@example.com" }));

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    authMock.resetPasswordForEmail.mockResolvedValue({
      error: { message: "User not found", code: "user_not_found", status: 400 },
    });
    const unknown = await requestPasswordReset(
      null,
      formDataWith({ email: "unknown@example.com" }),
    );
    consoleError.mockRestore();

    expect(known).toEqual({ ok: true });
    expect(unknown).toEqual({ ok: true });
    expect(unknown).toEqual(known);
  });

  it("does surface rate limiting, which says nothing about the address", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    authMock.resetPasswordForEmail.mockResolvedValue({ error: SUPABASE_ERRORS.rateLimited });

    const result = await requestPasswordReset(null, formDataWith({ email: "user@example.com" }));
    consoleError.mockRestore();

    expect(result).toEqual({ ok: false, error: "Too many attempts. Wait a moment and try again." });
  });

  it("does surface an unreachable server", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    authMock.resetPasswordForEmail.mockResolvedValue({ error: SUPABASE_ERRORS.network });

    const result = await requestPasswordReset(null, formDataWith({ email: "user@example.com" }));
    consoleError.mockRestore();

    expect(result).toEqual({
      ok: false,
      error: "We couldn't reach the server. Please try again.",
    });
  });

  it("rejects a malformed address without calling Supabase", async () => {
    const result = await requestPasswordReset(null, formDataWith({ email: "nope" }));

    expect(result).toEqual({ ok: false, error: "Enter the email address you signed up with." });
    expect(authMock.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("never logs the submitted address", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    authMock.resetPasswordForEmail.mockResolvedValue({
      error: { message: "User not found: victim@example.com", code: "user_not_found", status: 400 },
    });

    await requestPasswordReset(null, formDataWith({ email: "victim@example.com" }));

    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("victim@example.com");
    consoleError.mockRestore();
  });
});

describe("updatePassword", () => {
  const recoverySession = { data: { claims: { sub: "user-1" } }, error: null };

  it("sets the password and lands the user in the app", async () => {
    authMock.getClaims.mockResolvedValue(recoverySession);
    authMock.updateUser.mockResolvedValue({ error: null });

    await expectRedirectTo(
      updatePassword(null, formDataWith({ password: "new-password", password_confirmation: "new-password" })),
      "/app",
    );

    expect(authMock.updateUser).toHaveBeenCalledWith({ password: "new-password" });
  });

  it("refuses when the recovery link produced no session", async () => {
    authMock.getClaims.mockResolvedValue({ data: null, error: null });

    const result = await updatePassword(
      null,
      formDataWith({ password: "new-password", password_confirmation: "new-password" }),
    );

    expect(result).toEqual({
      ok: false,
      error: "That reset link has expired or was already used. Request a new one.",
    });
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a too-short password without calling Supabase", async () => {
    const result = await updatePassword(null, formDataWith({ password: "abc" }));

    expect(result).toEqual({ ok: false, error: "Choose a password with at least 8 characters." });
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a mismatched confirmation without calling Supabase", async () => {
    const result = await updatePassword(
      null,
      formDataWith({ password: "new-password", password_confirmation: "different" }),
    );

    expect(result).toEqual({ ok: false, error: "Both passwords need to match." });
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it("surfaces a rejected password without leaking the raw provider message", async () => {
    authMock.getClaims.mockResolvedValue(recoverySession);
    authMock.updateUser.mockResolvedValue({
      error: { message: "Password should be at least 6 characters", code: "weak_password", status: 422 },
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await updatePassword(
      null,
      formDataWith({ password: "new-password", password_confirmation: "new-password" }),
    );
    consoleError.mockRestore();

    expect(result).toEqual({
      ok: false,
      error: "Choose a longer password.",
    });
  });

  it("never logs the new password", async () => {
    authMock.getClaims.mockResolvedValue(recoverySession);
    authMock.updateUser.mockResolvedValue({
      error: { message: "nope", code: "weak_password", status: 422 },
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await updatePassword(
      null,
      formDataWith({ password: "hunter2-secret", password_confirmation: "hunter2-secret" }),
    );

    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("hunter2-secret");
    consoleError.mockRestore();
  });
});

describe("signOut", () => {
  it("revokes the session globally and redirects to /login", async () => {
    authMock.signOut.mockResolvedValue({ error: null });

    await expectRedirectTo(signOut(), "/login");
    expect(authMock.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("still redirects when Supabase reports a problem — the cookie clears either way", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    authMock.signOut.mockResolvedValue({ error: SUPABASE_ERRORS.network });

    await expectRedirectTo(signOut(), "/login");
    consoleError.mockRestore();
  });
});
