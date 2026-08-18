import type { BillingOverview } from "@/modules/billing/overview";
import { creditsToUnits } from "@/modules/credits/units";

/**
 * Billing screen states the browser suite renders (BILLING CORE-2 §93).
 *
 * Each is a complete `BillingOverview` — the same object `getBillingOverview`
 * returns from Supabase — so `BillingView` cannot tell a fixture from a
 * production render. That is the point of the whole arrangement: a domain test
 * proves the spend order and the expiry rule, and only a browser proves the
 * screen actually says "500 expire on 1 Sep" rather than showing a lot table.
 *
 * No AI call, no database and no Stripe request backs any of this. These are
 * written by hand from the read model's own types.
 */

export const E2E_BILLING_SCENARIOS = {
  /** A funded Free account with expiring Credits and some history. */
  "billing-free": {
    stripeReady: true,
    overview: {
      availableCredits: creditsToUnits(2_480),
      displayAvailable: "2,480",
      nextExpiry: {
        credits: creditsToUnits(120),
        displayCredits: "120",
        expiresAt: "2026-09-01T00:00:00.000Z",
      },
      plan: { key: "free", name: "Free", renewsAt: null, endingAtPeriodEnd: false },
      recentActivity: [
        {
          id: "e1",
          label: "Credits used",
          creditDelta: creditsToUnits(-35),
          displayAmount: "-35",
          at: "2026-08-17T10:00:00.000Z",
        },
        {
          id: "e2",
          label: "Credit purchase",
          creditDelta: creditsToUnits(500),
          displayAmount: "+500",
          at: "2026-08-16T10:00:00.000Z",
        },
        {
          id: "e3",
          label: "Credits added",
          creditDelta: creditsToUnits(100),
          displayAmount: "+100",
          at: "2026-08-15T10:00:00.000Z",
        },
      ],
      welcomeGranted: true,
    } satisfies BillingOverview,
  },

  /** A subscribed account, so the plan section shows a renewal. */
  "billing-builder": {
    stripeReady: true,
    overview: {
      availableCredits: creditsToUnits(1_000),
      displayAvailable: "1,000",
      nextExpiry: {
        credits: creditsToUnits(1_000),
        displayCredits: "1,000",
        expiresAt: "2026-09-18T00:00:00.000Z",
      },
      plan: {
        key: "builder",
        name: "Builder",
        renewsAt: "2026-09-18T00:00:00.000Z",
        endingAtPeriodEnd: false,
      },
      recentActivity: [
        {
          id: "e1",
          label: "Credits added",
          creditDelta: creditsToUnits(1_000),
          displayAmount: "+1,000",
          at: "2026-08-18T10:00:00.000Z",
        },
      ],
      welcomeGranted: true,
    } satisfies BillingOverview,
  },

  /** An empty account that predates Core-2 — the one-time Welcome claim shows. */
  "billing-empty": {
    stripeReady: true,
    overview: {
      availableCredits: creditsToUnits(0),
      displayAvailable: "0",
      nextExpiry: null,
      plan: { key: "free", name: "Free", renewsAt: null, endingAtPeriodEnd: false },
      recentActivity: [],
      welcomeGranted: false,
    } satisfies BillingOverview,
  },

  /** A deployment with no Stripe configuration: balance shows, buying does not. */
  "billing-unconfigured": {
    stripeReady: false,
    overview: {
      availableCredits: creditsToUnits(100),
      displayAvailable: "100",
      nextExpiry: null,
      plan: { key: "free", name: "Free", renewsAt: null, endingAtPeriodEnd: false },
      recentActivity: [],
      welcomeGranted: true,
    } satisfies BillingOverview,
  },

  /** Returned from Checkout. Says "being confirmed", never "Credits added". */
  "billing-checkout-complete": {
    stripeReady: true,
    checkoutState: "complete",
    overview: {
      availableCredits: creditsToUnits(100),
      displayAvailable: "100",
      nextExpiry: null,
      plan: { key: "free", name: "Free", renewsAt: null, endingAtPeriodEnd: false },
      recentActivity: [],
      welcomeGranted: true,
    } satisfies BillingOverview,
  },
} as const satisfies Record<
  string,
  { stripeReady: boolean; checkoutState?: string; overview: BillingOverview }
>;

export type E2eBillingScenario = keyof typeof E2E_BILLING_SCENARIOS;

export function isE2eBillingScenario(value: string): value is E2eBillingScenario {
  return Object.hasOwn(E2E_BILLING_SCENARIOS, value);
}
