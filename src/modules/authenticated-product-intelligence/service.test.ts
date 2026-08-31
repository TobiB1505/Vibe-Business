import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedProductIntelligenceSnapshot } from "./schema";

/**
 * Deep Scan lifecycle tests (Sprint 5 §33).
 *
 * The browser and the analyzer are mocked at the module boundary, so nothing
 * here opens a socket, reaches Browserbase, or drives a real page. What is
 * *not* mocked is the database double — it enforces the same partial unique
 * indexes as the migration, so the entitlement and concurrency guarantees are
 * actually exercised rather than assumed.
 */

const analyzeMock = vi.fn();
const connectMock = vi.fn();
const disconnectMock = vi.fn(async () => undefined);

/**
 * The Credit seam, mocked at the module boundary like the browser and the
 * analyzer.
 *
 * `billing.ts` obtains a service-role client, because every billing table has a
 * select policy and deliberately no write policy — so it cannot run against the
 * database double here, and injecting a client instead would defeat the reason
 * it is service-role in the first place.
 *
 * What this file can and does test is the part that belongs to *this* module:
 * that the hold is taken before a browser is bought, and that every outcome
 * which does not persist a snapshot releases it. The Credit arithmetic behind
 * those calls is `credits/`'s to prove, and it does.
 */
const holdMock = vi.fn(async (_params: unknown) => ({ ok: true, billable: false }) as unknown);
const settleMock = vi.fn(async (_params: unknown) => undefined);
const releaseMock = vi.fn(async (_params: unknown) => undefined);

vi.mock("./billing", () => ({
  holdDeepScanCredits: (params: unknown) => holdMock(params),
  settleDeepScanCredits: (params: unknown) => settleMock(params),
  releaseDeepScanCredits: (params: unknown) => releaseMock(params),
}));

vi.mock("./analyzer", () => ({
  analyzeAuthenticatedProduct: (input: unknown) => analyzeMock(input),
}));

vi.mock("./playwright/connector", () => ({
  connectReadOnly: (connectUrl: string, origin: string) => connectMock(connectUrl, origin),
}));

const {
  analyzeDeepScan,
  cancelDeepScan,
  getDeepScanAccessStatus,
  getDeepScanLiveView,
  startDeepScan,
} = await import("./service");

const {
  FakeBrowserProvider,
  FakeDatabase,
  fakeSupabase,
  seedProject,
} = await import("./test-support");

const OWNER = "user_owner";
const INTRUDER = "user_intruder";

function fakeSnapshot(pagesInspected = 4): AuthenticatedProductIntelligenceSnapshot {
  return {
    schemaVersion: "authenticated-product-intelligence.v1",
    source: {
      origin: "https://app.example.com",
      analyzerVersion: "authenticated-product-analyzer-v1",
      browserProvider: "browserbase",
      analyzedAt: new Date().toISOString(),
    },
    session: { sessionId: "s", landingPath: "/app", ignoredTabCount: 0 },
    crawl: {
      pagesInspected,
      candidatesConsidered: 6,
      maxDepthReached: 1,
      candidateSources: {
        landing: 1,
        repository_route: 2,
        public_protected_redirect: 1,
        authenticated_link: 2,
      },
    },
    pages: [],
    productSurfaces: [],
    navigation: { labels: [], paths: [] },
    applicationSignals: {
      appShellPresent: true,
      authenticatedAreaReached: true,
      reachableSurfaceCount: pagesInspected,
      dataTablePresent: false,
      emptyStatePresent: true,
      settingsPresent: false,
      billingPresent: false,
      onboardingPresent: true,
    },
    metrics: { pagesInspected, navigationCount: pagesInspected, durationMs: 1200, browserSessionDurationMs: 5000 },
    completeness: { status: "complete", reasons: [] },
    warnings: [],
  } as AuthenticatedProductIntelligenceSnapshot;
}

function setup(options: { productionUrl?: string | null } = {}) {
  const db = new FakeDatabase();
  const supabase = fakeSupabase(db);
  const projectId = seedProject(db, { userId: OWNER, productionUrl: options.productionUrl });
  return { db, supabase, projectId };
}

beforeEach(() => {
  analyzeMock.mockReset();
  connectMock.mockReset();
  holdMock.mockReset();
  settleMock.mockReset();
  releaseMock.mockReset();
  holdMock.mockResolvedValue({ ok: true, billable: false });
  settleMock.mockResolvedValue(undefined);
  releaseMock.mockResolvedValue(undefined);
  analyzeMock.mockResolvedValue({ ok: true, snapshot: fakeSnapshot() });
  connectMock.mockResolvedValue({ port: { pages: async () => [], blocked: {} }, disconnect: disconnectMock });
});

/** Runs a full successful scan and returns the ids involved. */
async function runFullScan(
  supabase: ReturnType<typeof fakeSupabase>,
  provider: InstanceType<typeof FakeBrowserProvider>,
  projectId: string,
) {
  const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
  if (!started.ok) throw new Error(`start failed: ${started.error}`);
  const analyzed = await analyzeDeepScan(supabase, provider, {
    sessionId: started.sessionId,
    userId: OWNER,
  });
  return { started, analyzed };
}

describe("startDeepScan — authorization precedes provider spend", () => {
  it("never creates a browser when no production origin is configured", async () => {
    const { supabase, projectId } = setup({ productionUrl: null });
    const provider = new FakeBrowserProvider();

    const result = await startDeepScan(supabase, provider, { projectId, userId: OWNER });

    expect(result).toEqual({ ok: false, error: "production_origin_missing" });
    // The point of the ordering: a denial costs us nothing.
    expect(provider.created).toBe(0);
  });

  it("never creates a browser once the included scan is consumed", async () => {
    const { db, supabase, projectId } = setup();
    db.seed("authenticated_product_intelligence_snapshots", {
      project_id: projectId,
      status: "completed",
      access_mode: "included_first_scan",
      analyzer_version: "authenticated-product-analyzer-v1",
    });

    const provider = new FakeBrowserProvider();
    const result = await startDeepScan(supabase, provider, { projectId, userId: OWNER });

    expect(result).toEqual({ ok: false, error: "credits_required" });
    expect(provider.created).toBe(0);
  });

  it("refuses a project the caller does not own, without touching the provider", async () => {
    const { supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();

    const result = await startDeepScan(supabase, provider, { projectId, userId: INTRUDER });

    expect(result).toEqual({ ok: false, error: "project_not_found" });
    expect(provider.created).toBe(0);
  });

  it("starts a session and returns a live view for a fresh project", async () => {
    const { supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();

    const result = await startDeepScan(supabase, provider, { projectId, userId: OWNER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.liveViewUrl).toBe("https://live.example/view");
    expect(provider.created).toBe(1);
  });

  it("releases the browser it just paid for when the session row cannot be written", async () => {
    const { db, supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();
    db.failNextWriteWith = { table: "authenticated_browser_sessions", message: "disk on fire" };

    const result = await startDeepScan(supabase, provider, { projectId, userId: OWNER });

    expect(result).toEqual({ ok: false, error: "persist_failed" });
    // A browser we cannot use must not be left running to its timeout.
    expect(provider.terminated).toEqual(["bb_1"]);
  });

  it("a second concurrent start cannot open a second browser", async () => {
    const { supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();

    const first = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    const second = await startDeepScan(supabase, provider, { projectId, userId: OWNER });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "scan_already_running" });
    // The entitlement check short-circuits before the provider is called again.
    expect(provider.created).toBe(1);
  });
});

describe("analyzeDeepScan — ownership and session state", () => {
  it("refuses to analyse another user's session", async () => {
    const { supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();
    const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    if (!started.ok) throw new Error("start failed");

    const result = await analyzeDeepScan(supabase, provider, {
      sessionId: started.sessionId,
      userId: INTRUDER,
    });

    expect(result).toEqual({ ok: false, error: "project_not_found" });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("reports an unknown session rather than guessing", async () => {
    const { supabase } = setup();
    const provider = new FakeBrowserProvider();

    const result = await analyzeDeepScan(supabase, provider, { sessionId: "nope", userId: OWNER });
    expect(result).toEqual({ ok: false, error: "session_not_found" });
  });

  it("expires a session past its bound, terminates it, and never connects", async () => {
    const { db, supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();
    const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    if (!started.ok) throw new Error("start failed");

    // Push the row past its wall-clock bound, as an abandoned login would.
    const row = db.rows("authenticated_browser_sessions")[0]!;
    row.expires_at = new Date(Date.now() - 1000).toISOString();

    const result = await analyzeDeepScan(supabase, provider, {
      sessionId: started.sessionId,
      userId: OWNER,
    });

    expect(result).toEqual({ ok: false, error: "browser_session_expired" });
    expect(connectMock).not.toHaveBeenCalled();
    expect(provider.terminated).toContain("bb_1");
    expect(row.status).toBe("expired");
  });

  it("fails without connecting when the provider says the session is gone", async () => {
    const { supabase, projectId } = setup();
    const provider = new FakeBrowserProvider({
      getConnection: { ok: false, error: "browser_session_expired" },
    });

    const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    if (!started.ok) throw new Error("start failed");

    const result = await analyzeDeepScan(supabase, provider, {
      sessionId: started.sessionId,
      userId: OWNER,
    });

    expect(result).toEqual({ ok: false, error: "browser_session_expired" });
    expect(connectMock).not.toHaveBeenCalled();
    expect(provider.terminated).toContain("bb_1");
  });
});

describe("analyzeDeepScan — entitlement consumption", () => {
  it("consumes the included scan only when a snapshot is persisted", async () => {
    const { db, supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();

    const { analyzed } = await runFullScan(supabase, provider, projectId);

    expect(analyzed.ok).toBe(true);
    const snapshots = db.rows("authenticated_product_intelligence_snapshots");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.status).toBe("completed");
    expect(snapshots[0]!.access_mode).toBe("included_first_scan");

    // And the entitlement is now visibly gone.
    const status = await getDeepScanAccessStatus(supabase, { projectId, userId: OWNER });
    expect(status?.includedScanAvailable).toBe(false);
    expect(status?.blockedReason).toBe("credits_required");
  });

  it.each([
    ["the analysis fails", () => analyzeMock.mockResolvedValue({ ok: false, error: "authentication_not_confirmed" })],
    ["the browser connection fails", () => connectMock.mockRejectedValue(new Error("socket"))],
    ["the analyzer throws", () => analyzeMock.mockRejectedValue(new Error("boom"))],
  ])("leaves the included scan available when %s", async (_label, arrange) => {
    const { supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();
    arrange();

    const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    if (!started.ok) throw new Error("start failed");
    const result = await analyzeDeepScan(supabase, provider, {
      sessionId: started.sessionId,
      userId: OWNER,
    });

    expect(result.ok).toBe(false);

    // The whole point: a failure must not cost the user their one free scan.
    const status = await getDeepScanAccessStatus(supabase, { projectId, userId: OWNER });
    expect(status?.includedScanAvailable).toBe(true);
    expect(provider.terminated).toContain("bb_1");
  });

  it("leaves the included scan available when our own persistence fails", async () => {
    const { db, supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();

    const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    if (!started.ok) throw new Error("start failed");

    // The scan itself worked; only the write to complete it fails.
    db.failNextWriteWith = {
      table: "authenticated_product_intelligence_snapshots",
      message: "write failed",
    };

    const result = await analyzeDeepScan(supabase, provider, {
      sessionId: started.sessionId,
      userId: OWNER,
    });

    expect(result.ok).toBe(false);
    const status = await getDeepScanAccessStatus(supabase, { projectId, userId: OWNER });
    expect(status?.includedScanAvailable).toBe(true);
  });

  it("the database refuses a second included scan even if authorization were bypassed", async () => {
    const { db, supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();

    await runFullScan(supabase, provider, projectId);

    // Simulate the application check being raced or skipped: force a second
    // completed included snapshot straight past the service.
    const candidate = {
      project_id: projectId,
      status: "completed",
      access_mode: "included_first_scan",
      analyzer_version: "authenticated-product-analyzer-v1",
    };
    const violation = db.checkConstraints("authenticated_product_intelligence_snapshots", candidate);

    expect(violation?.code).toBe("23505");
  });
});

describe("analyzeDeepScan — termination and usage on every path", () => {
  it("terminates the browser and records completed usage on success", async () => {
    const { db, supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();

    await runFullScan(supabase, provider, projectId);

    expect(provider.terminated).toContain("bb_1");
    const usage = db.rows("deep_scan_provider_usage");
    expect(usage).toHaveLength(1);
    expect(usage[0]!.status).toBe("completed");
    expect(usage[0]!.access_mode).toBe("included_first_scan");
    expect(usage[0]!.pages_inspected).toBe(4);
    // Cost is never invented from an assumed rate.
    expect(usage[0]!.provider_cost_usd).toBeNull();
  });

  it("records failed usage and terminates when the analysis fails", async () => {
    const { db, supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();
    analyzeMock.mockResolvedValue({ ok: false, error: "authenticated_origin_not_reached" });

    const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    if (!started.ok) throw new Error("start failed");
    await analyzeDeepScan(supabase, provider, { sessionId: started.sessionId, userId: OWNER });

    expect(provider.terminated).toContain("bb_1");
    const usage = db.rows("deep_scan_provider_usage");
    expect(usage[0]!.status).toBe("failed");
    // Duration is persisted so real cost can be computed later.
    expect(typeof usage[0]!.duration_ms).toBe("number");
  });

  it("cancelling releases the browser and records cancelled usage", async () => {
    const { db, supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();

    const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    if (!started.ok) throw new Error("start failed");

    const result = await cancelDeepScan(supabase, provider, {
      sessionId: started.sessionId,
      userId: OWNER,
    });

    expect(result).toEqual({ ok: true });
    expect(provider.terminated).toContain("bb_1");
    expect(db.rows("deep_scan_provider_usage")[0]!.status).toBe("cancelled");
    // And it did not cost the user their included scan.
    const status = await getDeepScanAccessStatus(supabase, { projectId, userId: OWNER });
    expect(status?.includedScanAvailable).toBe(true);
  });

  it("refuses to cancel another user's session", async () => {
    const { supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();
    const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    if (!started.ok) throw new Error("start failed");

    const result = await cancelDeepScan(supabase, provider, {
      sessionId: started.sessionId,
      userId: INTRUDER,
    });

    expect(result).toEqual({ ok: false, error: "project_not_found" });
    expect(provider.terminated).toEqual([]);
  });
});

describe("getDeepScanLiveView — authorization", () => {
  it("returns a freshly fetched live view to the owner", async () => {
    const { supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();
    const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    if (!started.ok) throw new Error("start failed");

    const result = await getDeepScanLiveView(supabase, provider, {
      sessionId: started.sessionId,
      userId: OWNER,
    });

    expect(result).toEqual({ ok: true, liveViewUrl: "https://live.example/view" });
  });

  it("refuses another user's live view — the capability URL is never fetched", async () => {
    const { supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();
    const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    if (!started.ok) throw new Error("start failed");

    const before = provider.calls.filter((call) => call.method === "getLiveView").length;
    const result = await getDeepScanLiveView(supabase, provider, {
      sessionId: started.sessionId,
      userId: INTRUDER,
    });
    const after = provider.calls.filter((call) => call.method === "getLiveView").length;

    expect(result).toEqual({ ok: false, error: "project_not_found" });
    expect(after).toBe(before);
  });

  it("refuses a live view for an expired session", async () => {
    const { db, supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();
    const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    if (!started.ok) throw new Error("start failed");

    db.rows("authenticated_browser_sessions")[0]!.expires_at = new Date(Date.now() - 1).toISOString();

    const result = await getDeepScanLiveView(supabase, provider, {
      sessionId: started.sessionId,
      userId: OWNER,
    });

    expect(result).toEqual({ ok: false, error: "session_not_live" });
  });
});

describe("getDeepScanAccessStatus — safe projection", () => {
  it("exposes no provider internals", async () => {
    const { supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();
    await startDeepScan(supabase, provider, { projectId, userId: OWNER });

    const status = await getDeepScanAccessStatus(supabase, { projectId, userId: OWNER });
    const serialized = JSON.stringify(status);

    expect(status?.activeSession?.status).toBe("waiting_for_login");
    // Vibe's own session id only — never the provider's, and no capability URL.
    expect(serialized).not.toContain("bb_1");
    expect(serialized).not.toContain("wss://");
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("live.example");
  });

  it("returns null for a project the caller does not own", async () => {
    const { supabase, projectId } = setup();
    expect(await getDeepScanAccessStatus(supabase, { projectId, userId: INTRUDER })).toBeNull();
  });

  it("always reports that additional scans require credits", async () => {
    const { supabase, projectId } = setup();
    const status = await getDeepScanAccessStatus(supabase, { projectId, userId: OWNER });
    expect(status?.additionalScansRequireCredits).toBe(true);
  });
});

describe("audit events", () => {
  it("records start and completion without provider internals", async () => {
    const { db, supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();

    await runFullScan(supabase, provider, projectId);

    const events = db.rows("audit_events");
    const types = events.map((event) => event.event_type);
    expect(types).toContain("deep_scan.started");
    expect(types).toContain("deep_scan.completed");

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("bb_1");
    expect(serialized).not.toContain("wss://");
    expect(serialized).not.toContain("live.example");
  });

  it("records a failure event carrying only a typed reason", async () => {
    const { db, supabase, projectId } = setup();
    const provider = new FakeBrowserProvider();
    analyzeMock.mockResolvedValue({ ok: false, error: "authentication_not_confirmed" });

    const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    if (!started.ok) throw new Error("start failed");
    await analyzeDeepScan(supabase, provider, { sessionId: started.sessionId, userId: OWNER });

    const failure = db.rows("audit_events").find((event) => event.event_type === "deep_scan.failed");
    expect(failure).toBeTruthy();
    expect((failure!.metadata as Record<string, unknown>).reason).toBe("authentication_not_confirmed");
  });
});

describe("an additional Deep Scan is held, then settled or released (launch-v1)", () => {
  it("takes exactly one hold per start, and tells it what the scan is paid by", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);
    const provider = new FakeBrowserProvider();
    const projectId = seedProject(db, { userId: OWNER });

    await startDeepScan(supabase, provider, { projectId, userId: OWNER });

    expect(holdMock).toHaveBeenCalledTimes(1);
    // The access mode is passed, never re-derived. `authorizeOperationCredits`
    // resolves the retail price of `deep_scan` and knows nothing about
    // entitlements, so a hold that decided for itself would charge 25 Credits
    // for the scan this project is entitled to.
    expect(holdMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessMode: "included_first_scan" }),
    );
  });

  it("buys no browser at all when the hold is refused", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);
    const provider = new FakeBrowserProvider();
    const projectId = seedProject(db, { userId: OWNER });

    holdMock.mockResolvedValueOnce({
      ok: false,
      refusal: "insufficient_credits",
      requiredCredits: 25_000,
      availableCredits: 0,
    });

    const result = await startDeepScan(supabase, provider, { projectId, userId: OWNER });

    // The ordering claim in the form that actually matters. `created === 0` is
    // provable; "the hold was called first" would still pass if the hold moved
    // after the session and the refusal simply arrived late.
    expect(result.ok).toBe(false);
    expect(provider.created).toBe(0);
    expect(db.rows("authenticated_browser_sessions")).toHaveLength(0);
  });

  it("settles only after a snapshot is persisted", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);
    const provider = new FakeBrowserProvider();
    const projectId = seedProject(db, { userId: OWNER });

    await runFullScan(supabase, provider, projectId);

    expect(settleMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("releases the hold when the analysis fails, and charges nothing", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);
    const provider = new FakeBrowserProvider();
    const projectId = seedProject(db, { userId: OWNER });

    const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    if (!started.ok) throw new Error("start failed");

    analyzeMock.mockResolvedValueOnce({ ok: false, error: "authenticated_analysis_failed" });
    await analyzeDeepScan(supabase, provider, { sessionId: started.sessionId, userId: OWNER });

    // A failed scan must cost a paying customer exactly what it costs a free
    // one: nothing. The mirror of `consumesIncludedEntitlement`.
    expect(settleMock).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("releases the hold when the user cancels", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);
    const provider = new FakeBrowserProvider();
    const projectId = seedProject(db, { userId: OWNER });

    const started = await startDeepScan(supabase, provider, { projectId, userId: OWNER });
    if (!started.ok) throw new Error("start failed");

    await cancelDeepScan(supabase, provider, { sessionId: started.sessionId, userId: OWNER });

    expect(settleMock).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "cancelled_before_usage" }),
    );
  });

  it("holds and settles against the same session id", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);
    const provider = new FakeBrowserProvider();
    const projectId = seedProject(db, { userId: OWNER });

    const { started } = await runFullScan(supabase, provider, projectId);

    // The identity that makes the hold findable again. If these ever diverge,
    // a settled scan leaves a hold standing forever and the customer's
    // available balance quietly shrinks.
    expect(holdMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: started.sessionId }),
    );
    expect(settleMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: started.sessionId }),
    );
  });
});
