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
    additionalScanPrice: 25_000,
    activeSession: null,
    blockedReason: null,
    retryAvailableAt: null,
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
  it("reports credits_required when no policy prices an additional scan", () => {
    const model = build({
      accessStatus: accessStatus({
        includedScanAvailable: false,
        additionalScanPrice: null,
        blockedReason: "credits_required",
      }),
    });

    expect(model.state).toBe("credits_required");
    expect(model.canStart).toBe(false);
    expect(model.additionalScanPrice).toBeNull();
  });

  it("offers a priced additional scan once the included one is used", () => {
    const model = build({
      accessStatus: accessStatus({ includedScanAvailable: false, blockedReason: null }),
    });

    expect(model.state).toBe("additional_available");
    expect(model.additionalScanPrice).toBe(25_000);
    expect(model.canStart).toBe(true);
  });

  it("reports insufficient_credits rather than pretending the scan is unavailable", () => {
    const model = build({
      accessStatus: accessStatus({
        includedScanAvailable: false,
        blockedReason: "insufficient_credits",
      }),
    });

    expect(model.state).toBe("insufficient_credits");
    expect(model.canStart).toBe(false);
    // The price is still carried, because "you need 25 and you have 12" is the
    // sentence a customer can act on. `credits_required` never had one.
    expect(model.additionalScanPrice).toBe(25_000);
  });

  /**
   * The guarantee that survived `launch-v1`, narrowed to what it was always
   * really protecting.
   *
   * A Credit price is now exactly what this model is *for* — a customer
   * deciding whether to spend needs to see it. What must still never appear is
   * anything from Vibe's own side of the ledger: a wallet balance, a provider
   * cost, a dollar amount, or a browser-seconds figure. Those are Vibe's
   * economics, and §12.1 keeps them out of the customer's view.
   */
  it("carries a Credit price and nothing from Vibe's own ledger", () => {
    const serialized = JSON.stringify(
      build({ accessStatus: accessStatus({ includedScanAvailable: false, blockedReason: null }) }),
    );

    expect(serialized).toContain("additionalScanPrice");
    expect(serialized).not.toMatch(/balance|usd|\$|nanoUsd|providerCost|browserMs/i);
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

/**
 * Regression: the panel rendered a heading and one sentence with no action and
 * no reason when the browser provider was not configured. On the deployed app
 * that is indistinguishable from a broken page — the user reported "Deep Scan
 * isn't clickable, it's just text".
 *
 * The cause was a silent gate: `hasBrowserbaseApiKey()` required a `bb_`
 * prefix, so a key in any other shape removed the button with no message
 * anywhere. Both halves are covered here — the state must be reported, and the
 * reason must travel with it.
 */
describe("buildDeepScanViewModel — unavailability is always explained", () => {
  it("reports an unconfigured provider as unavailable, with a reason", () => {
    const model = build({ providerConfigured: false });

    expect(model.state).toBe("unavailable");
    expect(model.unavailableReason).toBe("provider_not_configured");
    expect(model.canStart).toBe(false);
  });

  it("distinguishes a missing production URL from a missing provider", () => {
    const noUrl = build({ accessStatus: accessStatus({ blockedReason: "production_origin_missing" }) });
    expect(noUrl.unavailableReason).toBe("production_url_missing");

    const noProvider = build({ providerConfigured: false });
    expect(noProvider.unavailableReason).toBe("provider_not_configured");
  });

  it("carries no unavailable reason when a scan can actually be started", () => {
    const model = build();
    expect(model.unavailableReason).toBeNull();
    expect(model.canStart).toBe(true);
  });

  it("never hides an in-flight session behind an unconfigured provider", () => {
    // The session is real and still billing; reporting "unavailable" would
    // strand the user with a browser they cannot cancel.
    const model = build({
      providerConfigured: false,
      accessStatus: accessStatus({ activeSession: { id: "s", status: "waiting_for_login" } }),
    });

    expect(model.state).toBe("waiting_for_login");
  });

  it("never hides a completed result behind an unconfigured provider", () => {
    const model = build({
      providerConfigured: false,
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

  it("every state either allows starting or carries something to explain itself", () => {
    // The invariant the regression violated: no dead ends.
    const cases = [
      build(),
      build({ providerConfigured: false }),
      build({ accessStatus: accessStatus({ blockedReason: "production_origin_missing" }) }),
      build({ accessStatus: accessStatus({ blockedReason: "cooldown_active" }) }),
      build({ accessStatus: accessStatus({ includedScanAvailable: false, blockedReason: "credits_required" }) }),
      build({ latestSession: { status: "expired", failureCode: null } }),
    ];

    for (const model of cases) {
      const explainable =
        model.canStart || model.unavailableReason !== null || model.blockedReason !== null || model.lastFailure !== null;
      expect(explainable).toBe(true);
    }
  });
});
