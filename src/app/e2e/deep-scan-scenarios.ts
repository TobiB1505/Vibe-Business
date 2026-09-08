import type { DeepScanViewModel } from "@/modules/authenticated-product-intelligence/view";
import { creditUnits } from "@/modules/credits/units";

/**
 * Deep Scan panel states the browser suite renders (`launch-v1`).
 *
 * Each is a complete `DeepScanViewModel` — the same object `buildDeepScanViewModel`
 * returns — so `DeepScanPanel` cannot tell a fixture from a production render.
 *
 * These exist because `launch-v1` put a **button that spends Credits** on this
 * panel, replacing a disabled "Coming with Vibe Credits". A domain test proves
 * the entitlement resolves `credits`; only a browser proves the person is told
 * the price, and told what happens if the scan comes back with nothing, before
 * they click.
 */

const BASE = {
  activeSession: null,
  showRecommendation: false,
  recommendationReason: null,
  lastResult: null,
  lastFailure: null,
  providerConfigured: true,
  unavailableReason: null,
  retryAvailableAt: null,
} as const;

export const E2E_DEEP_SCAN_SCENARIOS = {
  /** The included scan is used, an additional one is priced, and the wallet covers it. */
  "deep-scan-additional-available": {
    ...BASE,
    state: "additional_available",
    includedScanAvailable: false,
    additionalScansRequireCredits: true,
    additionalScanPrice: creditUnits(25_000),
    blockedReason: null,
    canStart: true,
    nextScan: { kind: "priced", price: creditUnits(25_000) },
  } satisfies DeepScanViewModel,

  /** Priced, and the balance does not cover it. A refusal the customer can act on. */
  "deep-scan-insufficient-credits": {
    ...BASE,
    state: "insufficient_credits",
    includedScanAvailable: false,
    additionalScansRequireCredits: true,
    additionalScanPrice: creditUnits(25_000),
    blockedReason: "insufficient_credits",
    canStart: false,
    nextScan: { kind: "insufficient_credits", price: creditUnits(25_000) },
  } satisfies DeepScanViewModel,

  /**
   * A finished scan that has things to say about itself.
   *
   * `completeness: "partial"` used to be the whole account of a scan that had
   * recorded specific warnings, so this is the state the disclosure exists
   * for: the result leads, the caveats are behind a label that says how many.
   *
   * The three kinds are all present on purpose. A real scan produced six notes
   * of which one was a failure, and the disclosure used to head all six with
   * "things Vibe could not check" — so this fixture is the shape that has to
   * keep reading correctly: one failure, one deliberate stop, one observation.
   */
  "deep-scan-completed-with-warnings": {
    ...BASE,
    state: "completed",
    includedScanAvailable: false,
    additionalScansRequireCredits: true,
    additionalScanPrice: creditUnits(25_000),
    blockedReason: null,
    canStart: true,
    nextScan: { kind: "priced", price: creditUnits(25_000) },
    lastResult: {
      analyzedAt: "2026-08-30T09:12:00.000Z",
      pagesInspected: 7,
      completion: { kind: "within_limits", policyLimited: true, budgetLimited: true },
      surfaces: [
        {
          id: "dashboard",
          name: "Dashboard",
          confidence: "high",
          evidence: [
            { detail: "Vibe opened this page while signed in.", source: "/app" },
            { detail: "Its heading reads “Welcome back”.", source: "/app" },
          ],
        },
        {
          id: "settings",
          name: "Settings",
          confidence: "medium",
          evidence: [{ detail: "Its heading reads “Project Settings”.", source: "/app/settings" }],
        },
      ],
      screens: [
        { template: "/app", heading: "Welcome back", pages: [{ path: "/app", heading: "Welcome back" }] },
        {
          template: "/app/projects/:id/settings",
          heading: "Project Settings",
          pages: [
            { path: "/app/projects/88d1c463/settings", heading: "Project Settings" },
            { path: "/app/projects/9b702a96/settings", heading: "Project Settings" },
          ],
        },
      ],
      shape: {
        landingPath: "/app",
        navigation: ["Home", "My Products", "Billing"],
        pagesWithForms: 4,
        pagesWithTables: 2,
        pagesWithEmptyState: 1,
      },
      notes: [
        {
          kind: "failed",
          path: "/app/reports",
          message: "One page took too long to load and was not read.",
        },
        {
          kind: "by_design",
          path: null,
          message: "3 screen(s) exist in more copies than Vibe inspected. Each was read up to 2 time(s).",
        },
        {
          kind: "observed",
          path: "/app/onboarding",
          message: "This path redirected to a page Vibe had already inspected, so it added no new evidence.",
        },
      ],
      accessMode: "credits",
    },
  } satisfies DeepScanViewModel,

  /** No policy prices an additional scan. The honest terminal answer. */
  "deep-scan-credits-required": {
    ...BASE,
    state: "credits_required",
    includedScanAvailable: false,
    additionalScansRequireCredits: true,
    additionalScanPrice: null,
    blockedReason: "credits_required",
    canStart: false,
    nextScan: { kind: "not_for_sale" },
  } satisfies DeepScanViewModel,

  /**
   * A finished result, with another scan buyable — the state the founder was
   * actually in, and the one nothing rendered.
   *
   * It is here rather than only in a unit test because the defect was invisible
   * to the domain: the view model was right, the entitlement was right, and the
   * panel drew a summary card with no control on it. Only a browser says
   * whether a person can start a scan (rule 69).
   */
  "deep-scan-completed-rerunnable": {
    ...BASE,
    state: "completed",
    includedScanAvailable: false,
    additionalScansRequireCredits: true,
    additionalScanPrice: creditUnits(25_000),
    blockedReason: null,
    canStart: true,
    nextScan: { kind: "priced", price: creditUnits(25_000) },
    lastResult: {
      analyzedAt: "2026-08-11T22:30:00.000Z",
      pagesInspected: 6,
      completion: { kind: "complete", policyLimited: false, budgetLimited: false },
      surfaces: [
        { id: "dashboard", name: "Dashboard", confidence: "high", evidence: [] },
        { id: "project_workspace", name: "Project workspace", confidence: "high", evidence: [] },
        { id: "integrations", name: "Integrations", confidence: "medium", evidence: [] },
      ],
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
    },
  } satisfies DeepScanViewModel,

  /** A finished result while a cooldown is in force: a reason, never silence. */
  "deep-scan-completed-blocked": {
    ...BASE,
    state: "completed",
    includedScanAvailable: false,
    additionalScansRequireCredits: true,
    additionalScanPrice: creditUnits(25_000),
    blockedReason: "cooldown_active",
    canStart: false,
    nextScan: { kind: "blocked", reason: "cooldown_active", retryAvailableAt: null },
    lastResult: {
      analyzedAt: "2026-08-11T22:30:00.000Z",
      pagesInspected: 6,
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
    },
  } satisfies DeepScanViewModel,
} as const satisfies Record<string, DeepScanViewModel>;

export type E2eDeepScanScenario = keyof typeof E2E_DEEP_SCAN_SCENARIOS;

export function isE2eDeepScanScenario(value: string): value is E2eDeepScanScenario {
  return Object.hasOwn(E2E_DEEP_SCAN_SCENARIOS, value);
}
