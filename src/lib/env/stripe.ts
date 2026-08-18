import "server-only";

import { z } from "zod";

/**
 * Validated, server-only Stripe configuration (ADR 0008, ADR 0025).
 *
 * Guarded by `server-only` so an accidental import from a Client Component
 * fails the build rather than shipping a payment secret to a browser. None of
 * these are `NEXT_PUBLIC_` prefixed, and none may ever become so: the secret
 * key can charge customers and the webhook signing secret can forge a payment
 * event, which is the same thing as minting Credits (§21).
 *
 * Parsed lazily, only from a code path actually about to talk to Stripe, so
 * `pnpm build`, `pnpm test`, `pnpm lint` and CI all run without any Stripe
 * configuration at all.
 *
 * ## Test mode versus live mode (§20, §91)
 *
 * Stripe's test and live modes are entirely separate worlds that share an id
 * namespace, and the *key itself* decides which one a request lands in. So the
 * mode is derived from the key prefix rather than configured separately —
 * a mismatch between "what the operator thinks is configured" and "what the key
 * actually does" is exactly the error that ends with a real customer being
 * charged during a test.
 *
 * Billing Core-2 is test-mode-first. {@link getStripeEnv} refuses a live key
 * unless `STRIPE_ALLOW_LIVE_MODE` is explicitly set, so live payments cannot be
 * switched on by pasting a key into an environment variable — it takes a second,
 * deliberate act. See the production activation checklist in
 * docs/sprints/0038-billing-core2-stripe-entitlements.md.
 */

const stripeEnvSchema = z.object({
  // Presence only, deliberately — the same reasoning `anthropic.ts` records.
  // A guess about a provider's key format must never be able to disable a
  // feature; a genuinely wrong key fails loudly at Stripe, which is both
  // accurate and actionable.
  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required."),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, "STRIPE_WEBHOOK_SECRET is required."),

  // The approved catalog's Stripe Price ids. Configuration rather than code
  // because they differ between test and live mode, and hardcoding a test id
  // as production truth is exactly what §22 forbids.
  //
  // Optional individually: a deployment mid-setup may have configured the
  // packs but not the plans, and the honest failure for that is "Builder
  // cannot be purchased yet", not "billing is completely broken".
  STRIPE_PRICE_BUILDER_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_PRO_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_PACK_500: z.string().min(1).optional(),
  STRIPE_PRICE_PACK_1500: z.string().min(1).optional(),
  STRIPE_PRICE_PACK_5000: z.string().min(1).optional(),

  /** Where Stripe returns the customer after Checkout. */
  STRIPE_BILLING_RETURN_URL: z.string().url().optional(),

  /**
   * The deliberate second act required to leave test mode.
   *
   * Not a boolean parsed loosely — the literal string `"true"`, so a stray
   * `0`, `no` or empty value cannot be read as permission to charge real
   * money.
   */
  STRIPE_ALLOW_LIVE_MODE: z.literal("true").optional(),
});

export type StripeEnv = z.infer<typeof stripeEnvSchema> & {
  /** Derived from the secret key, never configured independently. */
  livemode: boolean;
};

export class StripeLiveModeNotAuthorizedError extends Error {
  constructor() {
    super(
      "A Stripe live-mode secret key is configured, but live mode is not authorized. " +
        "Billing Core-2 is test-mode-first: set STRIPE_ALLOW_LIVE_MODE=true only after " +
        "completing the production activation checklist.",
    );
    this.name = "StripeLiveModeNotAuthorizedError";
  }
}

/**
 * Whether a secret key addresses Stripe live mode.
 *
 * Test keys are `sk_test_…` / `rk_test_…`; live keys are `sk_live_…` /
 * `rk_live_…`. Anything that is not recognizably a test key is treated as
 * **live**, which is the safe direction: an unrecognized key shape refuses to
 * run rather than quietly assuming it cannot spend real money.
 */
export function isLiveModeKey(secretKey: string): boolean {
  return !/^(sk|rk)_test_/.test(secretKey);
}

let cached: StripeEnv | undefined;

export function getStripeEnv(source: Record<string, string | undefined> = process.env): StripeEnv {
  if (cached) return cached;

  const parsed = stripeEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid Stripe configuration.\n${issues.join("\n")}`);
  }

  const livemode = isLiveModeKey(parsed.data.STRIPE_SECRET_KEY);
  if (livemode && parsed.data.STRIPE_ALLOW_LIVE_MODE !== "true") {
    throw new StripeLiveModeNotAuthorizedError();
  }

  cached = { ...parsed.data, livemode };
  return cached;
}

/**
 * Whether Stripe is configured at all, without throwing.
 *
 * Gates UI affordances: a deployment with no Stripe configuration should show
 * a balance and hide the purchase buttons, not crash the billing page. Checks
 * presence only — whether the key *works* is Stripe's answer to give.
 */
export function hasStripeConfiguration(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(source.STRIPE_SECRET_KEY && source.STRIPE_WEBHOOK_SECRET);
}

/** Test-only. Clears the memoized configuration between cases. */
export function resetStripeEnvCache(): void {
  cached = undefined;
}
