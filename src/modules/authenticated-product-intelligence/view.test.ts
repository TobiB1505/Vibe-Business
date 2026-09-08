import { describe, expect, it } from "vitest";
import { buildDeepScanViewModel, type BuildViewModelInput,
  describeCompletion,
} from "./view";
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
      completion: { kind: "complete", policyLimited: false, budgetLimited: false },
      surfaces: [{ id: "dashboard", name: "Dashboard", confidence: "high", evidence: [] }],
      screens: [],
      shape: {
        landingPath: "/app",
        navigation: [],
        pagesWithForms: 0,
        pagesWithTables: 0,
        pagesWithEmptyState: 0,
      },
      notes: [],
      accessMode: "included_first_scan",
    });
  });

  /*
   * The snapshot has carried warnings since it existed, and the view model
   * dropped them — so a partial scan could say only "finished: only partly"
   * about four specific things it had already written down.
   *
   * Then they arrived as one flat list, and a real scan produced six of them
   * of which **one** was a failure. Two were facts Vibe had established by
   * looking, one was the page budget working exactly as designed, two were
   * safety refusals. Under a heading reading "6 things Vibe could not check",
   * a founder learns that Vibe failed six times.
   */
  it("carries what the scan recorded, with the kind of statement each one is", () => {
    const withWarnings = {
      ...completed,
      latestSnapshot: {
        ...completed.latestSnapshot!,
        result: {
          ...completed.latestSnapshot!.result,
          warnings: [
            { code: "navigation_timeout", message: "One page took too long to load." },
            {
              code: "redirected_to_seen_page",
              path: "/app/onboarding",
              message: "This path redirected to a page Vibe had already inspected.",
            },
            { code: "repeated_screen_skipped", message: "7 screens exist in more copies." },
          ],
        },
      },
    } as typeof completed;

    expect(build(withWarnings).lastResult?.notes).toEqual([
      { kind: "failed", path: null, message: "One page took too long to load." },
      {
        kind: "observed",
        path: "/app/onboarding",
        message: "This path redirected to a page Vibe had already inspected.",
      },
      { kind: "by_design", path: null, message: "7 screens exist in more copies." },
    ]);
  });

  it("counts one failure in a list of three, not three", () => {
    // The whole point of the kind. A budget reached and a redirect observed
    // are not failures, and presenting them as ones teaches a founder to
    // distrust a scan that worked.
    const notes = [
      { code: "page_unreachable", path: "/app/reports", message: "A page could not be read." },
      { code: "budget_reached", message: "The page budget was reached." },
      { code: "non_get_request_blocked", message: "51 non-GET requests were blocked." },
    ];
    const model = build({
      ...completed,
      latestSnapshot: {
        ...completed.latestSnapshot!,
        result: { ...completed.latestSnapshot!.result, warnings: notes },
      },
    } as typeof completed);

    const kinds = model.lastResult!.notes.map((note) => note.kind);
    expect(kinds.filter((kind) => kind === "failed")).toHaveLength(1);
    expect(kinds).toEqual(["failed", "by_design", "observed"]);
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

/**
 * The bug this file did not have a case for.
 *
 * Every `completed` fixture above sets `blockedReason: "credits_required"` — a
 * policy that prices no additional scan — so the question "what may be started
 * *after* a successful scan" was never asked of a project that could buy one.
 * Under `launch-v1` an additional scan costs 25 Credits, and a founder with a
 * finished scan and 5,330 Credits was shown a summary card with no control on
 * it, permanently.
 */
describe("buildDeepScanViewModel — what may be started after a result", () => {
  const finished = {
    result: snapshotResult(),
    accessMode: "included_first_scan" as const,
    completedAt: "2026-08-11T22:30:00.000Z",
    createdAt: "2026-08-11T22:28:00.000Z",
    pagesInspected: 6,
  };

  it("offers a priced scan while showing a finished one", () => {
    const model = build({
      latestSnapshot: finished,
      accessStatus: accessStatus({ includedScanAvailable: false, blockedReason: null }),
    });

    // Both are true and neither is discarded: the result is what the section
    // shows, and another scan is what it may offer.
    expect(model.state).toBe("completed");
    expect(model.nextScan).toEqual({ kind: "priced", price: 25_000 });
  });

  it("says a scan is not for sale rather than going silent", () => {
    const model = build({
      latestSnapshot: finished,
      accessStatus: accessStatus({
        includedScanAvailable: false,
        additionalScanPrice: null,
        blockedReason: "credits_required",
      }),
    });

    expect(model.state).toBe("completed");
    expect(model.nextScan).toEqual({ kind: "not_for_sale" });
  });

  it("names the price when the balance is short, because that state has a checkout", () => {
    const model = build({
      latestSnapshot: finished,
      accessStatus: accessStatus({
        includedScanAvailable: false,
        blockedReason: "insufficient_credits",
      }),
    });

    expect(model.nextScan).toEqual({ kind: "insufficient_credits", price: 25_000 });
  });

  it("reports a cooldown as a cooldown, with when it lifts", () => {
    const model = build({
      latestSnapshot: finished,
      accessStatus: accessStatus({
        includedScanAvailable: false,
        blockedReason: "cooldown_active",
        retryAvailableAt: "2026-08-11T22:32:00.000Z",
      }),
    });

    expect(model.nextScan).toEqual({
      kind: "blocked",
      reason: "cooldown_active",
      retryAvailableAt: "2026-08-11T22:32:00.000Z",
    });
  });

  it("does not invent a top-up towards a price that does not exist", () => {
    // `insufficient_credits` is the state with a checkout behind it, and a
    // checkout needs a figure. Without one it degrades to the honest answer.
    const model = build({
      accessStatus: accessStatus({
        includedScanAvailable: false,
        additionalScanPrice: null,
        blockedReason: "insufficient_credits",
      }),
    });

    expect(model.nextScan).toEqual({ kind: "not_for_sale" });
  });

  it("reports the missing provider as Vibe's gap, even with a result on screen", () => {
    const model = build({
      latestSnapshot: finished,
      accessStatus: accessStatus({ includedScanAvailable: false }),
      providerConfigured: false,
    });

    expect(model.state).toBe("completed");
    expect(model.nextScan).toEqual({ kind: "unavailable", reason: "provider_not_configured" });
  });
});

describe("the offer and the state cannot describe different terms", () => {
  /*
   * `state` and `nextScan` answer two questions off one set of facts. They are
   * allowed to differ — a completed result outranks a purchasable state, which
   * is the whole point — but they must never *contradict*: a panel that says
   * "not for sale" while holding a price, or offers a start the domain refuses.
   */
  const denials = [
    null,
    "credits_required",
    "insufficient_credits",
    "cooldown_active",
    "scan_already_running",
    "start_attempts_exhausted",
    "production_origin_missing",
  ] as const;

  it.each(denials)("agrees with the domain's answer for %s", (blockedReason) => {
    for (const includedScanAvailable of [true, false]) {
      for (const additionalScanPrice of [25_000, null]) {
        const model = build({
          accessStatus: accessStatus({ blockedReason, includedScanAvailable, additionalScanPrice }),
        });

        const offersStart = model.nextScan.kind === "included" || model.nextScan.kind === "priced";

        /*
         * One direction, not equality, and the direction is the safe one: a
         * start is never offered where the domain would refuse it.
         *
         * The converse is deliberately not asserted. `canStart` is
         * `blockedReason === null && providerConfigured` — it trusts the
         * access status and asks nothing about entitlement — so the
         * unreachable combination "included scan used, nothing blocking, no
         * price in force" leaves it true while `nextScan` answers
         * `not_for_sale`. `authorizeDeepScan` returns `credits_required` for
         * exactly those facts, so no real project produces them; where the two
         * fields can disagree at all, the refusing one is the one that renders.
         */
        if (offersStart) expect(model.canStart).toBe(true);

        if (model.state === "additional_available") {
          expect(model.nextScan.kind).toBe("priced");
        }
        if (model.state === "credits_required") {
          expect(model.nextScan.kind).toBe("not_for_sale");
        }
        if (model.state === "insufficient_credits") {
          expect(model.nextScan.kind).toBe("insufficient_credits");
        }
      }
    }
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
 * The cause was a silent gate: the provider check of the day required a `bb_`
 * prefix, so a key in any other shape removed the button with no message
 * anywhere. That function and its provider are gone (ADR 0076) and the lesson
 * is not: both halves are covered here — the state must be reported, and the
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

/*
 * "Only partly", in amber, was the whole account of a scan whose single limit
 * was `mutation_blocked` — Vibe refusing every non-GET request, which it does
 * because the session is the founder's own, and which it always will.
 *
 * A permanent, deliberate safety property presented as a shortfall teaches a
 * person that Vibe half-works. It ran to the end.
 */
describe("describeCompletion", () => {
  it("calls a scan finished when only Vibe's own policy limited it", () => {
    expect(describeCompletion({ status: "partial", reasons: ["mutation_blocked"] })).toEqual({
      kind: "within_limits",
      policyLimited: true,
      budgetLimited: false,
    });
  });

  it("keeps a budget separate from a policy, because the sentence differs", () => {
    // "Vibe will never do this" and "Vibe stopped after 25 pages" are both
    // deliberate, and only one of them is an argument about safety.
    expect(
      describeCompletion({ status: "partial", reasons: ["page_budget_reached"] }),
    ).toEqual({ kind: "within_limits", policyLimited: false, budgetLimited: true });

    expect(
      describeCompletion({
        status: "partial",
        reasons: ["mutation_blocked", "page_budget_reached"],
      }),
    ).toEqual({ kind: "within_limits", policyLimited: true, budgetLimited: true });
  });

  it("still says a scan is incomplete when something actually went wrong", () => {
    const completion = describeCompletion({
      status: "partial",
      reasons: ["mutation_blocked", "navigation_failed"],
    });

    expect(completion.kind).toBe("incomplete");
    // And the limits are still reported, so the copy can explain both.
    expect(completion.policyLimited).toBe(true);
  });

  it("treats an unrecognised reason as a failure rather than as a limit", () => {
    /*
     * Written as the remainder rather than as its own list. A reason added
     * later is a failure until someone decides otherwise, which is the safe
     * direction for a label a founder trusts — the opposite default would let
     * a new fault quietly render as "finished".
     */
    expect(describeCompletion({ status: "partial", reasons: ["something_new"] }).kind).toBe(
      "incomplete",
    );
  });

  it("reports a clean scan as complete", () => {
    expect(describeCompletion({ status: "complete", reasons: [] })).toEqual({
      kind: "complete",
      policyLimited: false,
      budgetLimited: false,
    });
  });
});

/*
 * A founder spends 25 Credits and ninety seconds letting Vibe into their
 * signed-in product. What came back was a timestamp, a page count and a row of
 * grey chips — while the snapshot held, for every one of those chips, the
 * pages and headings that were the reason Vibe said it.
 */
describe("the overview after a scan", () => {
  function withResult(overrides: Record<string, unknown>) {
    return build({
      latestSnapshot: {
        result: { ...snapshotResult(), ...overrides },
        accessMode: "included_first_scan" as const,
        completedAt: "2026-08-11T10:00:00.000Z",
        createdAt: "2026-08-11T09:00:00.000Z",
        pagesInspected: 7,
      },
      accessStatus: accessStatus({ includedScanAvailable: false, blockedReason: "credits_required" }),
    } as Parameters<typeof build>[0]).lastResult!;
  }

  it("turns stored evidence into sentences with a page to check", () => {
    const result = withResult({
      productSurfaces: [
        {
          id: "settings",
          name: "Settings",
          detected: true,
          confidence: "high",
          evidence: [
            { kind: "url_path", path: "/app/settings" },
            { kind: "heading", path: "/app/settings", detail: "Project Settings" },
          ],
        },
      ],
    });

    expect(result.surfaces[0]!.evidence).toEqual([
      { detail: "Vibe opened this page while signed in.", source: "/app/settings" },
      { detail: "Its heading reads “Project Settings”.", source: "/app/settings" },
    ]);
  });

  it("drops a citation it cannot make readable rather than showing a bare kind", () => {
    // An unreadable citation is worse than one fewer (rule 45).
    const result = withResult({
      productSurfaces: [
        {
          id: "settings",
          name: "Settings",
          detected: true,
          confidence: "low",
          evidence: [
            { kind: "heading", path: "/app/settings", detail: null },
            { kind: "something_new", path: "/app/settings" },
            { kind: "url_path", path: "/app/settings" },
          ],
        },
      ],
    });

    expect(result.surfaces[0]!.evidence).toHaveLength(1);
    expect(JSON.stringify(result.surfaces[0]!.evidence)).not.toContain("something_new");
  });

  it("collapses pages onto their templates, keeping the order they were read", () => {
    /*
     * The fixture is deliberately in an order that alphabetical sorting would
     * change. A first version used pages that happened to sort into the order
     * they were read, so a planted `.sort()` passed it — a test that cannot
     * tell two orderings apart is not testing ordering.
     */
    const result = withResult({
      pages: [
        { path: "/app/workspace", mainHeading: "Workspace", formCount: 1, tableCount: 0, emptyStatePresent: false, surfaces: [] },
        { path: "/app", mainHeading: "Welcome back", formCount: 1, tableCount: 0, emptyStatePresent: false, surfaces: [] },
        { path: "/app/projects/88d1c463-74f4-43a4-b2ce-8b58cfdfbb4b/settings", mainHeading: "Project Settings", formCount: 1, tableCount: 0, emptyStatePresent: false, surfaces: [] },
        { path: "/app/projects/9b702a96-7863-4c29-8ece-c0055bfac24f/settings", mainHeading: "Project Settings", formCount: 1, tableCount: 0, emptyStatePresent: false, surfaces: [] },
      ],
    });

    // Read order, not alphabetical: `/app` would come first if it were sorted.
    expect(result.screens.map((screen) => screen.template)).toEqual([
      "/app/workspace",
      "/app",
      "/app/projects/:id/settings",
    ]);
    expect(result.screens[2]!.pages).toHaveLength(2);
    expect(result.screens[2]!.heading).toBe("Project Settings");
  });

  it("counts what was on the pages rather than describing it", () => {
    const result = withResult({
      pages: [
        { path: "/app", mainHeading: null, formCount: 1, tableCount: 0, emptyStatePresent: false, surfaces: [] },
        { path: "/app/repos", mainHeading: null, formCount: 0, tableCount: 2, emptyStatePresent: true, surfaces: [] },
        { path: "/app/billing", mainHeading: null, formCount: 7, tableCount: 0, emptyStatePresent: false, surfaces: [] },
      ],
      navigation: { labels: ["Home", "Billing"], paths: [] },
      session: { sessionId: "s", landingPath: "/app", ignoredTabCount: 0 },
    });

    expect(result.shape).toEqual({
      landingPath: "/app",
      navigation: ["Home", "Billing"],
      // Pages that have one, not how many there were: three forms on one page
      // is one page with a form.
      pagesWithForms: 2,
      pagesWithTables: 1,
      pagesWithEmptyState: 1,
    });
  });

  it("still lists only detected surfaces", () => {
    const result = withResult({
      productSurfaces: [
        { id: "dashboard", name: "Dashboard", detected: true, confidence: "high", evidence: [] },
        { id: "analytics", name: "Analytics", detected: false, confidence: "low", evidence: [] },
      ],
    });

    expect(result.surfaces.map((surface) => surface.id)).toEqual(["dashboard"]);
  });
});
