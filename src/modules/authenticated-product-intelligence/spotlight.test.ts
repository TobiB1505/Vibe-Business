import { describe, expect, it } from "vitest";
import { buildDeepScanSpotlight } from "./spotlight";
import { buildDeepScanViewModel, type BuildViewModelInput } from "./view";
import type { DeepScanAccessStatus } from "./entitlement";
import type { AuthenticatedSurfaceDetection } from "./surface-detection";
import type { AuthenticatedProductIntelligenceSnapshot } from "./schema";

/**
 * What My Product may say about Deep Scan.
 *
 * The card sits at the top of a page a founder reads before deciding to spend,
 * so the tests here are mostly about what it must *never* say: a price beside
 * an included scan, a zero beside a measure nobody took, or a heading with no
 * way forward and no reason there is none.
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

function detection(
  overrides: Partial<AuthenticatedSurfaceDetection> = {},
): AuthenticatedSurfaceDetection {
  return { likely: false, confidence: "low", evidence: [], ...overrides };
}

function snapshotResult(
  overrides: Partial<AuthenticatedProductIntelligenceSnapshot> = {},
): AuthenticatedProductIntelligenceSnapshot {
  return {
    schemaVersion: "authenticated-product-intelligence.v1",
    source: {
      origin: "https://app.example.com",
      analyzerVersion: "v1",
      browserProvider: "vercel-sandbox",
      analyzedAt: "2026-09-08T10:00:00.000Z",
    },
    session: { sessionId: "s", landingPath: "/app", ignoredTabCount: 0 },
    crawl: {
      pagesInspected: 4,
      candidatesConsidered: 6,
      maxDepthReached: 1,
      candidateSources: {
        landing: 1,
        repository_route: 2,
        public_protected_redirect: 0,
        authenticated_link: 3,
      },
    },
    pages: [
      {
        path: "/app",
        heading: "Home",
        surfaces: [],
        hasForm: false,
        hasTable: false,
        hasEmptyState: false,
      },
      {
        path: "/app/projects/6b3f2a19c4de",
        heading: "Project",
        surfaces: [],
        hasForm: true,
        hasTable: true,
        hasEmptyState: false,
      },
      {
        path: "/app/projects/91ce70b4dd28",
        heading: "Project",
        surfaces: [],
        hasForm: true,
        hasTable: false,
        hasEmptyState: false,
      },
      {
        path: "/app/billing",
        heading: "Billing",
        surfaces: ["billing"],
        hasForm: false,
        hasTable: false,
        hasEmptyState: false,
      },
    ],
    productSurfaces: [
      { id: "billing", name: "Billing", detected: true, confidence: "high", evidence: [] },
      { id: "settings", name: "Settings", detected: false, confidence: "low", evidence: [] },
    ],
    navigation: { labels: ["Home", "Projects", "Billing"], paths: ["/app", "/app/billing"] },
    applicationSignals: {
      appShellPresent: true,
      authenticatedAreaReached: true,
      reachableSurfaceCount: 4,
      dataTablePresent: true,
      emptyStatePresent: false,
      settingsPresent: false,
      billingPresent: true,
      onboardingPresent: false,
    },
    metrics: { pagesInspected: 4, navigationCount: 3, durationMs: 1, browserSessionDurationMs: 1 },
    completeness: { status: "complete", reasons: [] },
    warnings: [],
    ...overrides,
  } as AuthenticatedProductIntelligenceSnapshot;
}

function model(overrides: Partial<BuildViewModelInput> = {}) {
  return buildDeepScanViewModel({
    accessStatus: accessStatus(),
    latestSnapshot: null,
    latestSession: null,
    surfaceDetection: detection(),
    providerConfigured: true,
    ...overrides,
  });
}

const COMPLETED = {
  result: snapshotResult(),
  accessMode: "included_first_scan" as const,
  completedAt: "2026-09-08T10:00:00.000Z",
  createdAt: "2026-09-08T09:58:00.000Z",
  pagesInspected: 4,
};

describe("buildDeepScanSpotlight — nothing read yet", () => {
  it("offers the included scan without a price beside it", () => {
    const spotlight = buildDeepScanSpotlight(model());

    expect(spotlight.state).toBe("never_run");
    expect(spotlight.action?.included).toBe(true);
    /*
     * The whole reason this derives from the view model rather than reading
     * the retail price itself: a founder whose included scan is unused must
     * never be shown a number they will not be charged.
     */
    expect(spotlight.action?.price).toBeNull();
  });

  it("names the price when the included scan is spent", () => {
    const spotlight = buildDeepScanSpotlight(
      model({ accessStatus: accessStatus({ includedScanAvailable: false }) }),
    );

    expect(spotlight.action?.included).toBe(false);
    expect(spotlight.action?.price).toBe(25_000);
  });

  it("leads with the sign-in when the detector found evidence of one", () => {
    const spotlight = buildDeepScanSpotlight(
      model({
        surfaceDetection: detection({
          likely: true,
          confidence: "high",
          evidence: [{ kind: "public_login_form", path: "/login" }],
        }),
      }),
    );

    expect(spotlight.headline).toContain("behind your sign-in");
    expect(spotlight.detail).toContain("sign-in form");
  });

  it("counts nothing, because nothing has been counted", () => {
    const spotlight = buildDeepScanSpotlight(model());

    expect(spotlight.facts).toEqual([]);
    expect(spotlight.analyzedAt).toBeNull();
    expect(spotlight.surfaces).toEqual([]);
  });
});

describe("buildDeepScanSpotlight — a scan has run", () => {
  it("leads with what was read, in pages and screens", () => {
    const spotlight = buildDeepScanSpotlight(model({ latestSnapshot: COMPLETED }));

    expect(spotlight.state).toBe("read");
    // Four pages, but two of them are the same screen — the headline says both.
    expect(spotlight.headline).toBe("Vibe read 4 pages across 3 screens inside your product.");
    expect(spotlight.analyzedAt).toBe("2026-09-08T10:00:00.000Z");
  });

  it("names only the surfaces Vibe recognised", () => {
    const spotlight = buildDeepScanSpotlight(model({ latestSnapshot: COMPLETED }));

    expect(spotlight.surfaces).toEqual(["Billing"]);
  });

  it("does not offer a second scan as the card's own control", () => {
    const spotlight = buildDeepScanSpotlight(model({ latestSnapshot: COMPLETED }));

    // The doorway leads to the panel; the panel owns every priced control.
    expect(spotlight.action?.price).toBeNull();
    expect(spotlight.action?.label).toBe("See what Vibe read");
  });

  it("leaves out a measure it did not take", () => {
    const noNavigation = snapshotResult({ navigation: { labels: [], paths: [] } });
    const spotlight = buildDeepScanSpotlight(
      model({ latestSnapshot: { ...COMPLETED, result: noNavigation } }),
    );

    // Never "Nav items 0": a zero here reads as a finding about the product.
    expect(spotlight.facts.map((fact) => fact.label)).not.toContain("Nav items");
  });

  it("says so plainly when a scan recognised nothing", () => {
    const nothing = snapshotResult({
      productSurfaces: [
        { id: "billing", name: "Billing", detected: false, confidence: "low", evidence: [] },
      ],
    });
    const spotlight = buildDeepScanSpotlight(
      model({ latestSnapshot: { ...COMPLETED, result: nothing } }),
    );

    expect(spotlight.surfaces).toEqual([]);
    expect(spotlight.detail).toContain("recognised none of the surfaces");
  });
});

describe("buildDeepScanSpotlight — a card is never a dead end", () => {
  it("explains a missing production URL instead of offering nothing", () => {
    const spotlight = buildDeepScanSpotlight(
      model({ accessStatus: accessStatus({ blockedReason: "production_origin_missing" }) }),
    );

    expect(spotlight.action).toBeNull();
    expect(spotlight.note).toContain("production website URL");
  });

  it("explains a deployment with no browser as Vibe's gap, not the founder's", () => {
    const spotlight = buildDeepScanSpotlight(model({ providerConfigured: false }));

    expect(spotlight.action).toBeNull();
    expect(spotlight.note).toContain("gap on Vibe's side");
  });

  it("pairs every absent action with a reason", () => {
    const cases = [
      model({ accessStatus: accessStatus({ blockedReason: "production_origin_missing" }) }),
      model({ providerConfigured: false }),
      model({
        accessStatus: accessStatus({
          includedScanAvailable: false,
          additionalScanPrice: null,
          blockedReason: "credits_required",
        }),
      }),
      model({
        accessStatus: accessStatus({
          blockedReason: "cooldown_active",
          retryAvailableAt: "2026-09-08T11:00:00.000Z",
        }),
      }),
      null,
    ];

    for (const each of cases) {
      const spotlight = buildDeepScanSpotlight(each);
      if (spotlight.action === null) expect(spotlight.note).not.toBeNull();
    }
  });

  it("keeps the way forward when the balance is merely short", () => {
    const spotlight = buildDeepScanSpotlight(
      model({
        accessStatus: accessStatus({
          includedScanAvailable: false,
          blockedReason: "insufficient_credits",
        }),
      }),
    );

    // A short balance stands in front of the action; it does not remove it.
    expect(spotlight.action).not.toBeNull();
    expect(spotlight.note).toContain("enough Credits");
  });
});

describe("buildDeepScanSpotlight — a scan in flight", () => {
  it("says a browser is open and points at the page that owns it", () => {
    const spotlight = buildDeepScanSpotlight(
      model({
        accessStatus: accessStatus({
          activeSession: { id: "sess_1", status: "waiting_for_login" },
        }),
      }),
    );

    expect(spotlight.state).toBe("in_progress");
    expect(spotlight.action?.label).toBe("Open Deep Scan");
    expect(spotlight.action?.price).toBeNull();
  });
});

describe("buildDeepScanSpotlight — no project state at all", () => {
  it("still appears, and says what is missing", () => {
    const spotlight = buildDeepScanSpotlight(null);

    expect(spotlight.state).toBe("unavailable");
    expect(spotlight.action).toBeNull();
    expect(spotlight.note).toContain("connected repository");
  });
});
