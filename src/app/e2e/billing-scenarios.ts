import type { BillingOverview } from "@/modules/billing/overview";
import { creditsToUnits, ZERO_CREDITS } from "@/modules/credits/units";

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
 *
 * ## A fixture must not be more honest than the page
 *
 * These labels used to be aspirational. `billing-launch-v1` said "Agent
 * improvement" and the suite asserted it, while `getBillingOverview` mapped
 * every charge to "Credits used" — so the tests described a screen that did not
 * exist, which is rule 69's failure mode with the polarity reversed. The
 * projection now resolves those names for real, and `overview.test.ts` proves
 * each branch against ledger rows. Every label written below is one that file
 * can produce; nothing here may be written because it would look better.
 */

/** No hold outstanding — the common case, and the reason the line is absent. */
const NO_HOLD = { reservedCredits: ZERO_CREDITS, displayReserved: "0" } as const;

/**
 * An instant inside the closed `retail-v1` policy.
 *
 * Every scenario renders the price table, and the table resolves an
 * effective-dated policy — so a scenario without an `at` shows whichever policy
 * happens to be in force on the day CI runs, and its assertions change
 * underneath it at a policy boundary with nobody having touched the code. Only
 * `billing-launch-v1` and `billing-low` deliberately sit in the live policy;
 * everything else is pinned here so the two are compared rather than confused.
 */
const RETAIL_V1_INSTANT = "2026-08-20T12:00:00.000Z";

export const E2E_BILLING_SCENARIOS = {
  /**
   * A funded Free account with expiring Credits and some history.
   *
   * Pinned to an instant inside `retail-v1`, for the same reason
   * `billing-launch-v1` is pinned inside its own policy: without an `at` this
   * scenario renders whichever price policy happens to be in force on the day
   * CI runs, so the assertions below would have started failing on the morning
   * `launch-v1` took effect, for nothing anybody changed. The pair now covers
   * both policies deterministically — the closed one here, the live one there.
   */
  "billing-free": {
    stripeReady: true,
    at: RETAIL_V1_INSTANT,
    overview: {
      availableCredits: creditsToUnits(2_480),
      displayAvailable: "2,480",
      ...NO_HOLD,
      nextExpiry: {
        credits: creditsToUnits(120),
        displayCredits: "120",
        expiresAt: "2026-09-01T00:00:00.000Z",
      },
      // Free has no included allowance to be a fraction of.
      monthlyAllowance: null,
      plan: { key: "free", name: "Free", renewsAt: null, endingAtPeriodEnd: false },
      recentActivity: [
        {
          id: "e1",
          label: "Business Audit",
          creditDelta: creditsToUnits(-35),
          displayAmount: "-35",
          at: "2026-08-17T10:00:00.000Z",
        },
        {
          id: "e2",
          label: "Credit Pack",
          creditDelta: creditsToUnits(500),
          displayAmount: "+500",
          at: "2026-08-16T10:00:00.000Z",
        },
        {
          id: "e3",
          label: "Welcome Credits",
          creditDelta: creditsToUnits(100),
          displayAmount: "+100",
          at: "2026-08-15T10:00:00.000Z",
        },
      ],
      welcomeGranted: true,
    } satisfies BillingOverview,
  },

  /**
   * A subscribed account: a renewal date, an allowance to be a fraction of, and
   * a live hold.
   *
   * The hold is the state this fixture exists for. A customer whose balance is
   * lower than their own history explains has no way to find out why, and
   * "held for work in progress" is the only line on the page that can tell
   * them — so it needs a browser state, not just a type.
   */
  "billing-builder": {
    stripeReady: true,
    at: RETAIL_V1_INSTANT,
    overview: {
      availableCredits: creditsToUnits(1_000),
      displayAvailable: "1,000",
      reservedCredits: creditsToUnits(200),
      displayReserved: "200",
      nextExpiry: {
        credits: creditsToUnits(1_000),
        displayCredits: "1,000",
        expiresAt: "2026-09-18T00:00:00.000Z",
      },
      monthlyAllowance: {
        remaining: creditsToUnits(1_000),
        initial: creditsToUnits(1_000),
        displayRemaining: "1,000",
        displayInitial: "1,000",
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
          label: "Monthly Credits",
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
    at: RETAIL_V1_INSTANT,
    overview: {
      availableCredits: ZERO_CREDITS,
      displayAvailable: "0",
      ...NO_HOLD,
      nextExpiry: null,
      monthlyAllowance: null,
      plan: { key: "free", name: "Free", renewsAt: null, endingAtPeriodEnd: false },
      recentActivity: [],
      welcomeGranted: false,
    } satisfies BillingOverview,
  },

  /** A deployment with no Stripe configuration: balance shows, buying does not. */
  "billing-unconfigured": {
    stripeReady: false,
    at: RETAIL_V1_INSTANT,
    overview: {
      availableCredits: creditsToUnits(100),
      displayAvailable: "100",
      ...NO_HOLD,
      nextExpiry: null,
      monthlyAllowance: null,
      plan: { key: "free", name: "Free", renewsAt: null, endingAtPeriodEnd: false },
      recentActivity: [],
      welcomeGranted: true,
    } satisfies BillingOverview,
  },

  /** Returned from Checkout. Says "being confirmed", never "Credits added". */
  "billing-checkout-complete": {
    stripeReady: true,
    checkoutState: "complete",
    at: RETAIL_V1_INSTANT,
    overview: {
      availableCredits: creditsToUnits(100),
      displayAvailable: "100",
      ...NO_HOLD,
      nextExpiry: null,
      monthlyAllowance: null,
      plan: { key: "free", name: "Free", renewsAt: null, endingAtPeriodEnd: false },
      recentActivity: [],
      welcomeGranted: true,
    } satisfies BillingOverview,
  },

  /**
   * The screen under `launch-v1`, rendered at an instant inside it.
   *
   * Exists because the price table resolves a versioned, effective-dated
   * policy, so the only page a browser test could otherwise see is whichever
   * policy happens to be in force on the day CI runs. That is how a repricing
   * ships with a green domain layer and a screen nobody has looked at
   * ([CLAUDE.md](../../../CLAUDE.md) rule 69) — and it is exactly what happened
   * here: the first render of this page after `launch-v1` was authored showed
   * `retail-v1`'s prices and a footnote about agent tiers that were not on it.
   *
   * `at` moves no money. Every reservation resolves its own price server-side
   * from the real clock.
   *
   * It also carries the full activity vocabulary, one line per branch of the
   * projection — an operation charge, the Deep Scan charge that has no
   * operation row, a plan renewal, a purchased pack, a refund, and the generic
   * fallback. A reader can check the whole customer-facing dictionary against
   * one screen.
   */
  "billing-launch-v1": {
    stripeReady: true,
    at: "2026-09-15T12:00:00.000Z",
    overview: {
      availableCredits: creditsToUnits(1_720),
      displayAvailable: "1,720",
      ...NO_HOLD,
      nextExpiry: null,
      monthlyAllowance: {
        remaining: creditsToUnits(720),
        initial: creditsToUnits(1_000),
        displayRemaining: "720",
        displayInitial: "1,000",
      },
      plan: {
        key: "builder",
        name: "Builder",
        renewsAt: "2026-10-15T00:00:00.000Z",
        endingAtPeriodEnd: false,
      },
      /*
       * Ordered newest-first, because the panel says "Newest first" and
       * `listLedgerEntries` orders by `created_at` descending. A fixture whose
       * order contradicts the header it renders under is the same defect as a
       * fixture whose labels contradict the projection — it makes the browser
       * suite agree with a screen production would never produce.
       */
      recentActivity: [
        {
          id: "l7",
          label: "Monthly Credits",
          creditDelta: creditsToUnits(1_000),
          displayAmount: "+1,000",
          at: "2026-09-15T00:00:00.000Z",
        },
        {
          id: "l1",
          label: "Agent improvement",
          creditDelta: creditsToUnits(-200),
          displayAmount: "-200",
          at: "2026-09-14T10:00:00.000Z",
        },
        {
          id: "l2",
          label: "Deep Scan",
          creditDelta: creditsToUnits(-25),
          displayAmount: "-25",
          at: "2026-09-13T10:00:00.000Z",
        },
        {
          id: "l3",
          label: "Refund",
          creditDelta: creditsToUnits(35),
          displayAmount: "+35",
          at: "2026-09-12T10:00:00.000Z",
        },
        {
          id: "l4",
          label: "Business Audit",
          creditDelta: creditsToUnits(-35),
          displayAmount: "-35",
          at: "2026-09-11T10:00:00.000Z",
        },
        {
          id: "l5",
          label: "Next moves",
          creditDelta: creditsToUnits(-20),
          displayAmount: "-20",
          at: "2026-09-10T10:00:00.000Z",
        },
        {
          id: "l6",
          label: "Credit Pack",
          creditDelta: creditsToUnits(1_000),
          displayAmount: "+1,000",
          at: "2026-09-09T10:00:00.000Z",
        },
        {
          // The fallback, on screen on purpose: a charge whose operation row is
          // gone still has to render as something true.
          id: "l8",
          label: "Credits used",
          creditDelta: creditsToUnits(-20),
          displayAmount: "-20",
          at: "2026-09-08T10:00:00.000Z",
        },
      ],
      welcomeGranted: true,
    } satisfies BillingOverview,
  },

  /**
   * Not enough Credits to start anything, on the screen that sells them.
   *
   * The billing page itself never refuses an operation — admission is decided
   * server-side by `authorizeOperationCredits`, and no display figure may
   * override it. What this state has to get right is smaller and entirely
   * presentational: a balance too low to fund the cheapest thing on the price
   * table must still render as a calm, buyable page rather than a warning, with
   * the top-up controls reachable.
   */
  "billing-low": {
    stripeReady: true,
    at: "2026-09-15T12:00:00.000Z",
    overview: {
      availableCredits: creditsToUnits(8),
      displayAvailable: "8",
      ...NO_HOLD,
      nextExpiry: null,
      monthlyAllowance: {
        remaining: creditsToUnits(8),
        initial: creditsToUnits(1_000),
        displayRemaining: "8",
        displayInitial: "1,000",
      },
      plan: {
        key: "builder",
        name: "Builder",
        renewsAt: "2026-10-15T00:00:00.000Z",
        endingAtPeriodEnd: false,
      },
      recentActivity: [
        {
          id: "low1",
          label: "Agent improvement",
          creditDelta: creditsToUnits(-200),
          displayAmount: "-200",
          at: "2026-09-14T10:00:00.000Z",
        },
      ],
      welcomeGranted: true,
    } satisfies BillingOverview,
  },
} as const satisfies Record<
  string,
  { stripeReady: boolean; checkoutState?: string; at?: string; overview: BillingOverview }
>;

export type E2eBillingScenario = keyof typeof E2E_BILLING_SCENARIOS;

export function isE2eBillingScenario(value: string): value is E2eBillingScenario {
  return Object.hasOwn(E2E_BILLING_SCENARIOS, value);
}
