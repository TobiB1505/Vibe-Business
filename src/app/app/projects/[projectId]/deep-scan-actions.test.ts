import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Action boundary tests (Sprint 5 §18, §19).
 *
 * These assert the two properties the actions exist to provide: identity comes
 * from the server session, and nothing provider-shaped crosses back to the
 * client. Business rules are not re-tested here — they belong to the service,
 * and duplicating them would let the two drift apart.
 */

const requireSessionMock = vi.fn();
const startDeepScanMock = vi.fn();
const analyzeDeepScanMock = vi.fn();
const cancelDeepScanMock = vi.fn();
const getLiveViewMock = vi.fn();
const getProviderMock = vi.fn();

vi.mock("@/modules/auth/session", () => ({
  requireSession: () => requireSessionMock(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ __fake: "supabase" }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/modules/authenticated-product-intelligence/browserbase/client", () => ({
  getBrowserSessionProvider: () => getProviderMock(),
}));

vi.mock("@/modules/authenticated-product-intelligence/service", () => ({
  startDeepScan: (...args: unknown[]) => startDeepScanMock(...args),
  analyzeDeepScan: (...args: unknown[]) => analyzeDeepScanMock(...args),
  cancelDeepScan: (...args: unknown[]) => cancelDeepScanMock(...args),
  getDeepScanLiveView: (...args: unknown[]) => getLiveViewMock(...args),
}));

const {
  analyzeDeepScanAction,
  cancelDeepScanAction,
  getDeepScanLiveViewAction,
  startDeepScanAction,
} = await import("./deep-scan-actions");

const SERVER_USER = "user_from_session";

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockResolvedValue({ userId: SERVER_USER });
  getProviderMock.mockReturnValue({ name: "browserbase" });
  startDeepScanMock.mockResolvedValue({
    ok: true,
    sessionId: "sess_1",
    liveViewUrl: "https://live.example/x",
    expiresAt: "2026-08-11T21:00:00.000Z",
  });
  analyzeDeepScanMock.mockResolvedValue({ ok: true, snapshotId: "snap_1", pagesInspected: 6 });
  cancelDeepScanMock.mockResolvedValue({ ok: true });
  getLiveViewMock.mockResolvedValue({ ok: true, liveViewUrl: "https://live.example/x" });
});

describe("authentication", () => {
  it.each([
    ["start", () => startDeepScanAction("p1")],
    ["analyze", () => analyzeDeepScanAction("p1", "sess_1")],
    ["cancel", () => cancelDeepScanAction("p1", "sess_1")],
    ["live view", () => getDeepScanLiveViewAction("sess_1")],
  ])("rejects an unauthenticated caller on the %s action", async (_label, invoke) => {
    requireSessionMock.mockRejectedValue(new Error("no session"));

    await expect(invoke()).rejects.toThrow();

    // Nothing reached the domain, so nothing could have started a browser.
    expect(startDeepScanMock).not.toHaveBeenCalled();
    expect(analyzeDeepScanMock).not.toHaveBeenCalled();
    expect(cancelDeepScanMock).not.toHaveBeenCalled();
    expect(getLiveViewMock).not.toHaveBeenCalled();
  });

  it("takes the user id from the server session, never from the caller", async () => {
    await startDeepScanAction("p1");

    expect(startDeepScanMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      projectId: "p1",
      userId: SERVER_USER,
    });
  });

  it("has no parameter through which a caller could supply a user id", () => {
    // Structural, not behavioural: impersonation is impossible because the
    // argument does not exist.
    expect(startDeepScanAction.length).toBe(1);
    expect(analyzeDeepScanAction.length).toBe(2);
    expect(cancelDeepScanAction.length).toBe(2);
    expect(getDeepScanLiveViewAction.length).toBe(1);
  });
});

describe("delegation to the existing service", () => {
  it("start delegates and returns only safe fields", async () => {
    const result = await startDeepScanAction("p1");

    expect(startDeepScanMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, sessionId: "sess_1", expiresAt: "2026-08-11T21:00:00.000Z" });
    // The service returns a live view URL on start; the action does not pass
    // it on — the modal asks for it through its own authorized action (§6).
    expect(JSON.stringify(result)).not.toContain("live.example");
  });

  it("analyze continues the same session and never starts another", async () => {
    await analyzeDeepScanAction("p1", "sess_1");

    expect(analyzeDeepScanMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      sessionId: "sess_1",
      userId: SERVER_USER,
    });
    expect(startDeepScanMock).not.toHaveBeenCalled();
  });

  it("cancel delegates to the service so the server owns termination", async () => {
    const result = await cancelDeepScanAction("p1", "sess_1");

    expect(cancelDeepScanMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      sessionId: "sess_1",
      userId: SERVER_USER,
    });
    expect(result).toEqual({ ok: true });
  });

  it("live view delegates and returns only the URL", async () => {
    const result = await getDeepScanLiveViewAction("sess_1");
    expect(result).toEqual({ ok: true, liveViewUrl: "https://live.example/x" });
  });
});

describe("safe failure mapping", () => {
  it("returns credits_required with no provider information attached", async () => {
    startDeepScanMock.mockResolvedValue({ ok: false, error: "credits_required" });

    const result = await startDeepScanAction("p1");

    expect(result).toEqual({ ok: false, error: "credits_required" });
    expect(Object.keys(result)).toEqual(["ok", "error"]);
  });

  it.each([
    ["scan_already_running"],
    ["cooldown_active"],
    ["browser_session_create_failed"],
    ["browser_provider_unavailable"],
  ])("passes %s through as a typed code only", async (code) => {
    startDeepScanMock.mockResolvedValue({ ok: false, error: code });
    const result = await startDeepScanAction("p1");
    expect(result).toEqual({ ok: false, error: code });
  });

  it("maps a thrown provider construction failure to a typed configuration state", async () => {
    getProviderMock.mockImplementation(() => {
      throw new Error("Invalid or missing Browserbase configuration: BROWSERBASE_API_KEY is required.");
    });

    const result = await startDeepScanAction("p1");

    expect(result).toEqual({ ok: false, error: "browser_provider_not_configured" });
    // The env error names the variable; it must not travel to the browser.
    expect(JSON.stringify(result)).not.toContain("BROWSERBASE_API_KEY");
  });

  it("never lets a raw provider exception reach the caller", async () => {
    analyzeDeepScanMock.mockRejectedValue(
      new Error("Browserbase 500 {\"connectUrl\":\"wss://connect/x?signingKey=LEAKED\"}"),
    );

    const result = await analyzeDeepScanAction("p1", "sess_1");

    expect(result).toEqual({ ok: false, error: "analysis_failed" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("LEAKED");
    expect(serialized).not.toContain("wss://");
    expect(serialized).not.toContain("signingKey");
  });

  it("returns a typed failure when the live view is refused", async () => {
    getLiveViewMock.mockResolvedValue({ ok: false, error: "session_not_live" });

    const result = await getDeepScanLiveViewAction("sess_1");
    expect(result).toEqual({ ok: false, error: "session_not_live" });
  });
});

describe("no provider internals cross the boundary", () => {
  it("does not return a provider session id even if the service leaked one", async () => {
    // Defence in depth: the action projects explicit fields rather than
    // spreading whatever it was handed.
    startDeepScanMock.mockResolvedValue({
      ok: true,
      sessionId: "sess_1",
      expiresAt: "2026-08-11T21:00:00.000Z",
      liveViewUrl: "https://live.example/x",
      providerSessionId: "bb_should_never_appear",
      connectUrl: "wss://connect/x?signingKey=SECRET",
    });

    const result = await startDeepScanAction("p1");
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("bb_should_never_appear");
    expect(serialized).not.toContain("signingKey");
    expect(serialized).not.toContain("wss://");
    expect(serialized).not.toContain("live.example");
  });

  it("analyze returns only the page count", async () => {
    analyzeDeepScanMock.mockResolvedValue({
      ok: true,
      snapshotId: "snap_1",
      pagesInspected: 6,
      providerSessionId: "bb_leak",
    });

    const result = await analyzeDeepScanAction("p1", "sess_1");

    expect(result).toEqual({ ok: true, pagesInspected: 6 });
    expect(JSON.stringify(result)).not.toContain("bb_leak");
  });
});
