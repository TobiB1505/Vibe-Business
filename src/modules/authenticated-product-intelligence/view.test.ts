import { describe, expect, it } from "vitest";
import { buildDeepScanViewModel, type BuildViewModelInput } from "./view";
import type { DeepScanAccessStatus } from "./entitlement";
import type { AuthenticatedSurfaceDetection } from "./surface-detection";
import type { AuthenticatedProductIntelligenceSnapshot } from "./schema";

/**
 * Every project-page state from Sprint 5 §3, as a unit test.
 *
 * The view model is where the UI's decisions live, so testing it here is what
 * makes the component a renderer rather than a second rule engine. Each case
 * below corresponds to a state a user can actually land in.
 */

function accessStatus(overrides: Partial<DeepScanAccessStatus> = {}): DeepScanAccessStatus {
  return {
    includedScanAvailable: true,
    additionalScansRequireCredits: true,
    activeSession: null,
    blockedReason: null,
    ...overrides,
  };
}

function detection(overrides: Partial<AuthenticatedSurfaceDetection> = {}): AuthenticatedSurfaceDetection {
  return { likely: false, confidence: "low", evidence: [], ...overrides };
}

function snapshotResult(
  overrides: Partial<AuthenticatedProductIntelligenceSnapshot> = {},
): AuthenticatedProductIntelligenceSnapshot {
  return {
    schemaVersion: "authenticated-product-intelligence.v1",
    source: { origin: "https://app.example.com", analyzerVersion: "v1", browserProvider: "browserbase", analyzedAt: "" },
    session: { sessionId: "s", landingPath: "/app", ignoredTabCount: 0 },
    crawl: {
      pagesInspected: 7,
      candidatesConsidered: 9,
      maxDepthReached: 1,
      candidateSources: { landing: 1, repository_route: 3, public_protected_redirect: 1, authenticated_link: 4 },
    },
    pages: [],
    productSurfaces: [
      { id: "dashboard", name: "Dashboard", detected: true, confidence: "high", evidence: [] },
      { id: "billing", name: "Billing", detected: false, confidence: "low", evidence: [] },
    ],
    navigation: { labels: [], paths: [] },
    applicationSignals: {
      appShellPresent: true,
      authenticatedAreaReached: true,
      reachableSurfaceCount: 7,
      dataTablePresent: false,
      emptyStatePresent: false,
      settingsPresent: false,
      billingPresent: false,
      onboardingPresent: false,
    },
    metrics: { pagesInspected: 7, navigationCount: 7, durationMs: 1, browserSessionDurationMs: 1 },
    completeness: { status: "complete", reasons: [] },
    warnings: [],
    ...overrides,
  } as AuthenticatedProductIntelligenceSnapshot;
}

function build(overrides: Partial<BuildViewModelInput> = {}) {
  return buildDeepScanViewModel({
    accessStatus: accessStatus(),
    latestSnapshot: null,
    latestSession: null,
    surfaceDetection: detection(),
    providerConfigured: true,
    ...overrides,
  });
}

describe("buildDeepScanViewModel — offer states", () => {
  it("recommends a Deep Scan when the detector has evidence and the scan is available", () => {
    const model = build({
      surfaceDetection: detection({
        likely: true,
        confidence: "high",
        evidence: [{ kind: "public_login_redirect", path: "/app" }],
      }),
    });

    expect(model.state).toBe("recommended");
    expect(model.showRecommendation).toBe(true);
    expect(model.canStart).toBe(true);
    expect(model.recommendationReason).toBe("Vibe found product pages that redirect to a sign-in screen.");
  });

  it("does not push a recommendation when there is no authenticated evidence", () => {
    const model = build();

    expect(model.state).toBe("not_recommended");
    expect(model.showRecommendation).toBe(false);
    expect(model.recommendationReason).toBeNull();
    // The action stays quietly available — it is simply not promoted.
    expect(model.canStart).toBe(true);
  });

  it("picks the strongest evidence when several kinds are present", () => {
    const model = build({
      surfaceDetection: detection({
        likely: true,
        confidence: "high",
        evidence: [
          { kind: "public_login_form", path: "/" },
          { kind: "repository_app_route", path: "/dashboard" },
        ],
      }),
    });

    expect(model.recommendationReason).toBe("Vibe detected product routes that require sign-in.");
  });

  it("reports unavailable when no production origin is configured", () => {
    const model = build({ accessStatus: accessStatus({ blockedReason: "production_origin_missing" }) });

    expect(model.state).toBe("unavailable");
    expect(model.canStart).toBe(false);
  });

  it("cannot start when the server has no browser provider configured", () => {
    const model = build({ providerConfigured: false });

    expect(model.canStart).toBe(false);
    expect(model.showRecommendation).toBe(false);
  });
});

describe("buildDeepScanViewModel — active session states", () => {
  it("shows the login flow while a session waits for sign-in", () => {
    const model = build({
      accessStatus: accessStatus({ activeSession: { id: "sess_1", status: "waiting_for_login" } }),
    });

    expect(model.state).toBe("waiting_for_login");
    expect(model.activeSession).toEqual({ id: "sess_1", status: "waiting_for_login" });
  });

  it("treats a freshly created session as waiting for sign-in", () => {
    const model = build({ accessStatus: accessStatus({ activeSession: { id: "s", status: "created" } }) });
    expect(model.state).toBe("waiting_for_login");
  });

  it("shows the analyzing state while the scan runs", () => {
    const model = build({ accessStatus: accessStatus({ activeSession: { id: "s", status: "analyzing" } }) });
    expect(model.state).toBe("analyzing");
  });
});

describe("buildDeepScanViewModel — completed", () => {
  const completed = {
    latestSnapshot: {
      result: snapshotResult(),
      accessMode: "included_first_scan" as const,
      completedAt: "2026-08-11T10:00:00.000Z",
      createdAt: "2026-08-11T09:00:00.000Z",
      pagesInspected: 7,
    },
    accessStatus: accessStatus({ includedScanAvailable: false, blockedReason: "credits_required" }),
  };

  it("reports a ready result with derived facts only", () => {
    const model = build(completed);

    expect(model.state).toBe("completed");
    expect(model.lastResult).toEqual({
      analyzedAt: "2026-08-11T10:00:00.000Z",
      pagesInspected: 7,
      completeness: "complete",
      surfaces: [{ id: "dashboard", name: "Dashboard" }],
      accessMode: "included_first_scan",
    });
  });

  it("lists detected surfaces only, never the undetected ones", () => {
    const model = build(completed);
    expect(model.lastResult?.surfaces.map((surface) => surface.id)).toEqual(["dashboard"]);
  });

  it("a successful result outranks the credits state", () => {
    // Both are true after a first scan; the section is about the result.
    const model = build(completed);
    expect(model.state).toBe("completed");
    expect(model.includedScanAvailable).toBe(false);
  });

  it("exposes no raw snapshot payload", () => {
    const serialized = JSON.stringify(build(completed));
    expect(serialized).not.toContain("schemaVersion");
    expect(serialized).not.toContain("applicationSignals");
    expect(serialized).not.toContain("candidateSources");
  });
});

describe("buildDeepScanViewModel — credits", () => {
  it("reports credits_required once the included scan is used with no result to show", () => {
    const model = build({
      accessStatus: accessStatus({ includedScanAvailable: false, blockedReason: "credits_required" }),
    });

    expect(model.state).toBe("credits_required");
    expect(model.canStart).toBe(false);
    expect(model.additionalScansRequireCredits).toBe(true);
  });

  it("never claims a credit balance or price", () => {
    const serialized = JSON.stringify(
      build({ accessStatus: accessStatus({ includedScanAvailable: false, blockedReason: "credits_required" }) }),
    );
    expect(serialized).not.toMatch(/price|balance|usd|\$/i);
  });
});

describe("buildDeepScanViewModel — blocked and failed", () => {
  it.each([["scan_already_running"], ["cooldown_active"], ["start_attempts_exhausted"]] as const)(
    "surfaces %s as a blocked state without inventing eligibility",
    (reason) => {
      const model = build({ accessStatus: accessStatus({ blockedReason: reason }) });

      expect(model.state).toBe("blocked");
      expect(model.blockedReason).toBe(reason);
      expect(model.canStart).toBe(false);
    },
  );

  it.each([["cancelled"], ["expired"], ["failed"]] as const)(
    "reports a %s attempt and keeps the included scan available",
    (status) => {
      const model = build({ latestSession: { status, failureCode: null } });

      expect(model.state).toBe("last_attempt_failed");
      expect(model.lastFailure?.status).toBe(status);
      // The whole point: a failed attempt does not cost the free scan.
      expect(model.includedScanAvailable).toBe(true);
      expect(model.canStart).toBe(true);
    },
  );

  it("carries the typed failure code so the UI can explain it", () => {
    const model = build({
      latestSession: { status: "failed", failureCode: "authenticated_origin_not_reached" },
    });
    expect(model.lastFailure?.failureCode).toBe("authenticated_origin_not_reached");
  });

  it("does not show a past failure once a successful result exists", () => {
    const model = build({
      latestSession: { status: "failed", failureCode: "analysis_failed" },
      latestSnapshot: {
        result: snapshotResult(),
        accessMode: "included_first_scan",
        completedAt: "2026-08-11T10:00:00.000Z",
        createdAt: "2026-08-11T09:00:00.000Z",
        pagesInspected: 7,
      },
      accessStatus: accessStatus({ includedScanAvailable: false, blockedReason: "credits_required" }),
    });

    expect(model.state).toBe("completed");
  });
});

describe("buildDeepScanViewModel — safety of the DTO", () => {
  it("contains no provider identifiers or capability URLs in any state", () => {
    const models = [
      build(),
      build({ accessStatus: accessStatus({ activeSession: { id: "sess_1", status: "waiting_for_login" } }) }),
      build({
        latestSnapshot: {
          result: snapshotResult(),
          accessMode: "included_first_scan",
          completedAt: "x",
          createdAt: "y",
          pagesInspected: 7,
        },
        accessStatus: accessStatus({ includedScanAvailable: false, blockedReason: "credits_required" }),
      }),
    ];

    for (const model of models) {
      const serialized = JSON.stringify(model);
      expect(serialized).not.toMatch(/provider_session_id|providerSessionId/);
      expect(serialized).not.toMatch(/connectUrl|signingKey|wss:\/\//);
      expect(serialized).not.toMatch(/liveViewUrl|debuggerUrl/);
      expect(serialized).not.toMatch(/bb_[a-z0-9]/i);
      expect(serialized).not.toMatch(/cookie|storageState/i);
    }
  });

  it("exposes only Vibe's own session id and status for an active session", () => {
    const model = build({
      accessStatus: accessStatus({ activeSession: { id: "sess_1", status: "waiting_for_login" } }),
    });
    expect(Object.keys(model.activeSession!)).toEqual(["id", "status"]);
  });
});
