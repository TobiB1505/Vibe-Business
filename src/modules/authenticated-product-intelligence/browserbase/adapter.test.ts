import { describe, expect, it, vi, type Mock } from "vitest";

import { BrowserbaseSessionProvider, type BrowserbaseSessionsClient } from "./adapter";

/**
 * The session-recording and persistent-context assertions here are the hard
 * security invariants of Sprint 5 (§7, §33). They must fail loudly if anyone
 * ever relaxes them, including by relying on a provider default — the SDK
 * defaults `recordSession` and `logSession` to `true`.
 */

/** The fake exposes vitest mocks so calls can be inspected field by field. */
type FakeSessions = BrowserbaseSessionsClient & {
  create: Mock;
  debug: Mock;
  update: Mock;
};

function fakeSessions(overrides: Partial<Record<keyof FakeSessions, Mock>> = {}): FakeSessions {
  const base = {
    create: vi.fn(async () => ({
      id: "bb_session_123",
      connectUrl: "wss://connect.browserbase.com/?sessionId=bb_session_123&signingKey=SECRET",
      expiresAt: "2026-08-11T18:30:00.000Z",
    })),
    debug: vi.fn(async () => ({
      debuggerUrl: "https://live.browserbase.com/devtools/x",
      debuggerFullscreenUrl: "https://live.browserbase.com/devtools/fullscreen/x",
    })),
    update: vi.fn(async () => ({})),
  };

  return { ...base, ...overrides } as unknown as FakeSessions;
}

describe("BrowserbaseSessionProvider — security invariants", () => {
  it("creates sessions with recording explicitly disabled, never by default", async () => {
    const sessions = fakeSessions();
    const provider = new BrowserbaseSessionProvider(sessions);

    await provider.createSession({ timeoutSeconds: 600 });

    const params = sessions.create.mock.calls[0]![0]!;
    // Explicitly false — not undefined, not absent. The provider default is true.
    expect(params.browserSettings?.recordSession).toBe(false);
    expect(Object.hasOwn(params.browserSettings!, "recordSession")).toBe(true);
  });

  it("disables provider-side session logging", async () => {
    const sessions = fakeSessions();
    await new BrowserbaseSessionProvider(sessions).createSession({ timeoutSeconds: 600 });

    expect(sessions.create.mock.calls[0]![0]!.browserSettings?.logSession).toBe(false);
  });

  it("never supplies a persistent Browserbase context", async () => {
    const sessions = fakeSessions();
    await new BrowserbaseSessionProvider(sessions).createSession({ timeoutSeconds: 600 });

    const settings = sessions.create.mock.calls[0]![0]!.browserSettings!;
    expect(settings.context).toBeUndefined();
    expect(Object.hasOwn(settings, "context")).toBe(false);
    // Nothing anywhere in the request may name a context or persistence.
    expect(JSON.stringify(sessions.create.mock.calls[0])).not.toMatch(/context|persist/i);
  });

  it("does not enable automated captcha solving", async () => {
    const sessions = fakeSessions();
    await new BrowserbaseSessionProvider(sessions).createSession({ timeoutSeconds: 600 });

    expect(sessions.create.mock.calls[0]![0]!.browserSettings?.solveCaptchas).toBe(false);
  });

  it("sends an explicit provider-side timeout and does not keep sessions alive", async () => {
    const sessions = fakeSessions();
    await new BrowserbaseSessionProvider(sessions).createSession({ timeoutSeconds: 420 });

    const params = sessions.create.mock.calls[0]![0]!;
    expect(params.timeout).toBe(420);
    expect(params.keepAlive).toBe(false);
  });
});

describe("BrowserbaseSessionProvider — session handling", () => {
  it("returns the provider session id, connect url and expiry", async () => {
    const result = await new BrowserbaseSessionProvider(fakeSessions()).createSession({
      timeoutSeconds: 600,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.providerSessionId).toBe("bb_session_123");
    expect(result.value.connectUrl).toContain("wss://");
    expect(result.value.expiresAt).toBe("2026-08-11T18:30:00.000Z");
  });

  it("passes the configured project id only when one is set", async () => {
    const withProject = fakeSessions();
    await new BrowserbaseSessionProvider(withProject, { projectId: "proj_1" }).createSession({
      timeoutSeconds: 600,
    });
    expect(withProject.create.mock.calls[0]![0]!.projectId).toBe("proj_1");

    const withoutProject = fakeSessions();
    await new BrowserbaseSessionProvider(withoutProject).createSession({ timeoutSeconds: 600 });
    expect(Object.hasOwn(withoutProject.create.mock.calls[0]![0]!, "projectId")).toBe(false);
  });

  it("returns the fullscreen live view url for embedding", async () => {
    const result = await new BrowserbaseSessionProvider(fakeSessions()).getLiveView("bb_session_123");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.url).toBe("https://live.browserbase.com/devtools/fullscreen/x");
  });

  it("terminates with REQUEST_RELEASE", async () => {
    const sessions = fakeSessions();
    const result = await new BrowserbaseSessionProvider(sessions).terminateSession("bb_session_123");

    expect(result.ok).toBe(true);
    expect(sessions.update).toHaveBeenCalledWith("bb_session_123", { status: "REQUEST_RELEASE" });
  });

  it("treats an already-gone session as successfully terminated", async () => {
    const sessions = fakeSessions({
      update: vi.fn(async () => {
        throw Object.assign(new Error("not found"), { status: 404 });
      }),
    });

    const result = await new BrowserbaseSessionProvider(sessions).terminateSession("gone");
    // The goal is "no browser left running", not provider acknowledgement.
    expect(result.ok).toBe(true);
  });
});

describe("BrowserbaseSessionProvider — provider errors", () => {
  it("maps a create failure to a typed code without leaking the provider error", async () => {
    const sessions = fakeSessions({
      create: vi.fn(async () => {
        throw Object.assign(new Error('500 {"error":"internal","detail":"bb_secret_leak"}'), {
          status: 500,
        });
      }),
    });

    const result = await new BrowserbaseSessionProvider(sessions).createSession({
      timeoutSeconds: 600,
    });

    expect(result).toEqual({ ok: false, error: "browser_provider_unavailable" });
    expect(JSON.stringify(result)).not.toContain("bb_secret_leak");
    expect(JSON.stringify(result)).not.toContain("internal");
  });

  it("maps a missing session on live view to a typed code", async () => {
    const sessions = fakeSessions({
      debug: vi.fn(async () => {
        throw Object.assign(new Error("no such session"), { status: 404 });
      }),
    });

    const result = await new BrowserbaseSessionProvider(sessions).getLiveView("gone");
    expect(result).toEqual({ ok: false, error: "browser_session_not_found" });
  });

  it("reports a create failure as a create failure, not a missing session", async () => {
    const sessions = fakeSessions({
      create: vi.fn(async () => {
        throw Object.assign(new Error("nope"), { status: 404 });
      }),
    });

    const result = await new BrowserbaseSessionProvider(sessions).createSession({
      timeoutSeconds: 600,
    });
    expect(result).toEqual({ ok: false, error: "browser_session_create_failed" });
  });
});
