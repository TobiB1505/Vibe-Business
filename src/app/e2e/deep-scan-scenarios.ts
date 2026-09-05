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
  } satisfies DeepScanViewModel,

  /**
   * A finished scan that has things to say about itself.
   *
   * `completeness: "partial"` used to be the whole account of a scan that had
   * recorded specific warnings, so this is the state the disclosure exists
   * for: the result leads, the caveats are behind a label that says how many.
   */
  "deep-scan-completed-with-warnings": {
    ...BASE,
    state: "completed",
    includedScanAvailable: false,
    additionalScansRequireCredits: true,
    additionalScanPrice: creditUnits(25_000),
    blockedReason: null,
    canStart: true,
    lastResult: {
      analyzedAt: "2026-08-30T09:12:00.000Z",
      pagesInspected: 7,
      completeness: "partial",
      surfaces: [
        { id: "dashboard", name: "Dashboard" },
        { id: "settings", name: "Settings" },
      ],
      warnings: [
        "One page took too long to load and was not read.",
        "Vibe could not tell two settings pages apart, so it read one of them.",
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
  } satisfies DeepScanViewModel,
} as const satisfies Record<string, DeepScanViewModel>;

export type E2eDeepScanScenario = keyof typeof E2E_DEEP_SCAN_SCENARIOS;

export function isE2eDeepScanScenario(value: string): value is E2eDeepScanScenario {
  return Object.hasOwn(E2E_DEEP_SCAN_SCENARIOS, value);
}
