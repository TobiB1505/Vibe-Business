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
  retrieve: Mock;
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
    retrieve: vi.fn(async () => ({
      status: "RUNNING" as const,
      connectUrl: "wss://connect.browserbase.com/?sessionId=bb_session_123&signingKey=SECRET",
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

  it("keeps the session alive across the manual login, bounded by an explicit timeout", async () => {
    const sessions = fakeSessions();
    await new BrowserbaseSessionProvider(sessions).createSession({ timeoutSeconds: 420 });

    const params = sessions.create.mock.calls[0]![0]!;
    // The login happens between two server requests; without keepAlive the
    // reconnect finds a dead session and every scan fails.
    expect(params.keepAlive).toBe(true);
    // Which is exactly why the timeout must be explicit and short: keepAlive
    // removes the connection-drop backstop, so this is the only one left.
    expect(params.timeout).toBe(420);
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

/**
 * The login-then-analyse handoff (Sprint 5 §14).
 *
 * `createSession`'s `connectUrl` is a capability URL that is deliberately never
 * stored, so the second request has to re-fetch it. These tests pin the
 * behaviour that decides whether a scan can resume at all — and the mapping
 * that tells a caller "gone" apart from "temporarily unreachable".
 */
describe("BrowserbaseSessionProvider — reconnecting after login", () => {
  it("returns the connect URL for a running session", async () => {
    const sessions = fakeSessions();
    const provider = new BrowserbaseSessionProvider(sessions);

    const result = await provider.getConnection("bb_session_123");

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.connectUrl).toContain("wss://connect.browserbase.com/");
    expect(sessions.retrieve).toHaveBeenCalledWith("bb_session_123");
  });

  it("accepts a session that is still starting", async () => {
    const sessions = fakeSessions({
      retrieve: vi.fn(async () => ({ status: "PENDING" as const, connectUrl: "wss://connect/x" })),
    });

    const result = await new BrowserbaseSessionProvider(sessions).getConnection("bb_session_123");
    expect(result.ok).toBe(true);
  });

  it.each([["TIMED_OUT"], ["COMPLETED"]])("reports a %s session as expired", async (status) => {
    const sessions = fakeSessions({
      retrieve: vi.fn(async () => ({ status: status as "TIMED_OUT" })),
    });

    const result = await new BrowserbaseSessionProvider(sessions).getConnection("bb_session_123");
    expect(result).toEqual({ ok: false, error: "browser_session_expired" });
  });

  it("reports a session the provider no longer knows about as expired, not unavailable", async () => {
    // The distinction decides whether retrying could ever help.
    const sessions = fakeSessions({
      retrieve: vi.fn(async () => {
        throw Object.assign(new Error("not found"), { status: 404 });
      }),
    });

    const result = await new BrowserbaseSessionProvider(sessions).getConnection("bb_session_123");
    expect(result).toEqual({ ok: false, error: "browser_session_expired" });
  });

  it("reports an errored session as a connection failure", async () => {
    const sessions = fakeSessions({ retrieve: vi.fn(async () => ({ status: "ERROR" as const })) });
    const result = await new BrowserbaseSessionProvider(sessions).getConnection("bb_session_123");
    expect(result).toEqual({ ok: false, error: "browser_connection_failed" });
  });

  it("reports a running session with no endpoint as a connection failure", async () => {
    const sessions = fakeSessions({ retrieve: vi.fn(async () => ({ status: "RUNNING" as const })) });
    const result = await new BrowserbaseSessionProvider(sessions).getConnection("bb_session_123");
    expect(result).toEqual({ ok: false, error: "browser_connection_failed" });
  });

  it("never leaks a provider message or the connect URL out of a failure", async () => {
    const sessions = fakeSessions({
      retrieve: vi.fn(async () => {
        throw new Error("wss://connect.browserbase.com/?signingKey=LEAKED_SECRET refused");
      }),
    });

    const result = await new BrowserbaseSessionProvider(sessions).getConnection("bb_session_123");
    expect(JSON.stringify(result)).not.toContain("LEAKED_SECRET");
    expect(JSON.stringify(result)).not.toContain("wss://");
  });
});

/**
 * Regression: the Live View embed showed the browser as a small panel adrift in
 * empty space — reported as "viel zu klein, sieht extrem unprofessionell aus".
 *
 * Cause: no viewport was requested, so the provider chose its own and the Live
 * View letterboxed it inside an embed of a different shape. The viewport and
 * the embed's aspect ratio have to agree, so the size is pinned here rather
 * than left to a provider default.
 */
describe("BrowserbaseSessionProvider — live view presentation", () => {
  it("requests an explicit desktop viewport rather than accepting a default", async () => {
    const sessions = fakeSessions();
    await new BrowserbaseSessionProvider(sessions).createSession({ timeoutSeconds: 600 });

    const settings = sessions.create.mock.calls[0]![0]!.browserSettings!;
    expect(settings.viewport).toEqual({ width: 1280, height: 720 });
  });

  it("keeps the viewport at 16:9 so the embed can match it without letterboxing", () => {
    // The dialog renders the iframe with `aspect-video`. If this ratio changes,
    // that class has to change with it or the letterboxing returns.
    const { width, height } = { width: 1280, height: 720 };
    expect(width / height).toBeCloseTo(16 / 9, 5);
  });

  it("still sets every security invariant alongside the viewport", async () => {
    const sessions = fakeSessions();
    await new BrowserbaseSessionProvider(sessions).createSession({ timeoutSeconds: 600 });

    const settings = sessions.create.mock.calls[0]![0]!.browserSettings!;
    expect(settings.recordSession).toBe(false);
    expect(settings.logSession).toBe(false);
    expect(settings.solveCaptchas).toBe(false);
    expect(Object.hasOwn(settings, "context")).toBe(false);
  });
});
