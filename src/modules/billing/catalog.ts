import { creditsToUnits, type CreditUnits } from "@/modules/credits/units";

/**
 * The V1 product catalog (BILLING CORE-2 §8, §9, §22, §23, §69).
 *
 * ## The rule this file exists to make structural
 *
 * **The browser names a SKU. The server decides everything else.**
 *
 * A client may say "buy Pack500". It may not say how many Credits that is,
 * what it costs, which currency it is in, or which Stripe Price to charge. All
 * four are resolved here, server-side, from a constant — so the attack of
 * posting `credits=500000` or a forged `priceId` has nothing to attach to.
 * There is deliberately no function in this module that accepts a Credit
 * amount or a price from a caller.
 *
 * That is also why the Credit amounts live in code rather than in Stripe
 * metadata. Stripe is the payment rail (§18); if the Credit grant were read
 * back from a Stripe object, then whoever could edit that object — including
 * anyone who ever gains access to the Stripe dashboard — could mint Vibe
 * Credits. The grant amount is Vibe's decision, and it is made here.
 *
 * ## Prices are display facts, not authority
 *
 * The euro amounts below are what the UI shows. The amount actually charged is
 * whatever the configured Stripe Price says, because Stripe is the payment
 * rail and its Price object is the authority on money. These two must agree,
 * and the production activation checklist requires verifying that they do —
 * but a mismatch is a configuration error to be caught before launch, not
 * something this code should paper over by trusting one side.
 */

/* ---------------------------------------------------------------------------
 * Plans
 * ------------------------------------------------------------------------ */

/**
 * The subscription plans.
 *
 * Exactly three: Free, Builder, Pro. No Enterprise, no Team, no annual, no
 * seats, no usage overage — V1 stays small on purpose (§8).
 */
export const PLAN_KEYS = ["free", "builder", "pro"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/** The paid plans — the only ones with a Stripe Price and a monthly grant. */
export const PAID_PLAN_KEYS = ["builder", "pro"] as const;
export type PaidPlanKey = (typeof PAID_PLAN_KEYS)[number];

export type PlanDefinition = {
  key: PlanKey;
  /** Customer-facing name. */
  name: string;
  /** Display price in euro cents. Zero for Free. */
  priceCents: number;
  currency: "eur";
  /**
   * Credits granted for each successfully paid billing period.
   *
   * Zero for Free — a free account receives Welcome Credits once and no
   * recurring grant (§8).
   */
  monthlyCreditUnits: CreditUnits;
  /** The environment variable holding this plan's Stripe Price id. */
  stripePriceEnvVar: string | null;
};

const PLAN_DEFINITIONS: Readonly<Record<PlanKey, PlanDefinition>> = {
  free: {
    key: "free",
    name: "Free",
    priceCents: 0,
    currency: "eur",
    monthlyCreditUnits: creditsToUnits(0),
    stripePriceEnvVar: null,
  },
  builder: {
    key: "builder",
    name: "Builder",
    priceCents: 1_900,
    currency: "eur",
    monthlyCreditUnits: creditsToUnits(1_000),
    stripePriceEnvVar: "STRIPE_PRICE_BUILDER_MONTHLY",
  },
  pro: {
    key: "pro",
    name: "Pro",
    priceCents: 4_900,
    currency: "eur",
    monthlyCreditUnits: creditsToUnits(3_000),
    stripePriceEnvVar: "STRIPE_PRICE_PRO_MONTHLY",
  },
};

export function getPlan(key: PlanKey): PlanDefinition {
  return PLAN_DEFINITIONS[key];
}

export function listPlans(): PlanDefinition[] {
  return PLAN_KEYS.map((key) => PLAN_DEFINITIONS[key]);
}

export function listPaidPlans(): PlanDefinition[] {
  return PAID_PLAN_KEYS.map((key) => PLAN_DEFINITIONS[key]);
}

/**
 * Narrows an untrusted string to a paid plan key.
 *
 * The only way a request body's plan reaches the rest of the system. Anything
 * unrecognized — including `"free"`, which has no Checkout — returns null and
 * the request is refused.
 */
export function parsePaidPlanKey(value: unknown): PaidPlanKey | null {
  return typeof value === "string" && (PAID_PLAN_KEYS as readonly string[]).includes(value)
    ? (value as PaidPlanKey)
    : null;
}

/* ---------------------------------------------------------------------------
 * Top-up packs
 * ------------------------------------------------------------------------ */

export const CREDIT_PACK_KEYS = ["pack_500", "pack_1500", "pack_5000"] as const;
export type CreditPackKey = (typeof CREDIT_PACK_KEYS)[number];

export type CreditPackDefinition = {
  key: CreditPackKey;
  /** Displayed Credits, e.g. 500. */
  credits: number;
  /** The same amount in internal credit units — what is actually granted. */
  creditUnits: CreditUnits;
  /** Display price in euro cents. */
  priceCents: number;
  currency: "eur";
  stripePriceEnvVar: string;
};

/**
 * The approved one-time Credit packs.
 *
 * Purchasable by any authenticated user — a subscription is deliberately not
 * required (§9). Purchased Credits carry no normal monthly expiration, and the
 * spend order preserves them until expiring Credits are exhausted (§11).
 */
const CREDIT_PACK_DEFINITIONS: Readonly<Record<CreditPackKey, CreditPackDefinition>> = {
  pack_500: {
    key: "pack_500",
    credits: 500,
    creditUnits: creditsToUnits(500),
    priceCents: 1_200,
    currency: "eur",
    stripePriceEnvVar: "STRIPE_PRICE_PACK_500",
  },
  pack_1500: {
    key: "pack_1500",
    credits: 1_500,
    creditUnits: creditsToUnits(1_500),
    priceCents: 3_300,
    currency: "eur",
    stripePriceEnvVar: "STRIPE_PRICE_PACK_1500",
  },
  pack_5000: {
    key: "pack_5000",
    credits: 5_000,
    creditUnits: creditsToUnits(5_000),
    priceCents: 9_900,
    currency: "eur",
    stripePriceEnvVar: "STRIPE_PRICE_PACK_5000",
  },
};

export function getCreditPack(key: CreditPackKey): CreditPackDefinition {
  return CREDIT_PACK_DEFINITIONS[key];
}

export function listCreditPacks(): CreditPackDefinition[] {
  return CREDIT_PACK_KEYS.map((key) => CREDIT_PACK_DEFINITIONS[key]);
}

/** Narrows an untrusted string to an approved pack key. See {@link parsePaidPlanKey}. */
export function parseCreditPackKey(value: unknown): CreditPackKey | null {
  return typeof value === "string" && (CREDIT_PACK_KEYS as readonly string[]).includes(value)
    ? (value as CreditPackKey)
    : null;
}

/* ---------------------------------------------------------------------------
 * Welcome Credits
 * ------------------------------------------------------------------------ */

/**
 * The once-per-account onboarding allowance (§5, §57).
 *
 * Account-scoped, never project-scoped — otherwise creating projects would
 * farm Credits, which is exactly what the idempotency identity below prevents.
 */
export const WELCOME_CREDIT_UNITS: CreditUnits = creditsToUnits(100);

/** How long Welcome Credits live. */
export const WELCOME_CREDIT_VALIDITY_DAYS = 30;

/**
 * What each kind of grant's idempotency key begins with.
 *
 * The three builders below already encoded this, one literal each. Naming the
 * prefixes makes them readable in the other direction, which is what the
 * billing page needs: a `grant` or `purchase` ledger row records no source
 * kind, so where its Credits came from — a renewal, a pack, the welcome
 * allowance — is recoverable only from the key that wrote it.
 *
 * Reading a key is a *display* concern and nothing more. The uniqueness
 * guarantee stays the ledger's index, and no authority anywhere is derived
 * from a string prefix.
 */
export const GRANT_KEY_PREFIXES = {
  welcome: "welcome-credit-v1:",
  subscription: "subscription-period-v1:",
  topUp: "topup-v1:",
} as const;

/**
 * The durable identity of an account's one Welcome grant.
 *
 * Versioned in the string so a future, deliberately different welcome offer is
 * a *different* grant rather than a silent second issue of this one. The
 * uniqueness guarantee is the ledger's
 * `billing_credit_ledger_idempotency_idx`, not this function — ten concurrent
 * provisioning attempts all compute the same key and exactly one wins the
 * index (§70).
 */
export function welcomeGrantIdempotencyKey(userId: string): string {
  return `${GRANT_KEY_PREFIXES.welcome}${userId}`;
}

/**
 * The durable identity of one subscription period's Credit grant (§30).
 *
 * Bound to the **invoice**, which is the real external identity of a paid
 * billing period. Not to the subscription — a subscription stays `active` for
 * a month and would grant repeatedly — and not to a period date range, which
 * Stripe may restate.
 */
export function subscriptionGrantIdempotencyKey(stripeInvoiceId: string): string {
  return `${GRANT_KEY_PREFIXES.subscription}${stripeInvoiceId}`;
}

/**
 * The durable identity of one top-up purchase's grant (§28, §72).
 *
 * Bound to the Checkout Session, which is one-per-purchase. A replayed
 * `checkout.session.completed` computes the same key and posts nothing.
 */
export function topUpGrantIdempotencyKey(stripeCheckoutSessionId: string): string {
  return `${GRANT_KEY_PREFIXES.topUp}${stripeCheckoutSessionId}`;
}
