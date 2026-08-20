import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStripeEnvCache } from "@/lib/env/stripe";

/**
 * PART D/H — the Stripe return-URL fallback must track this deployment's
 * resolved origin, not a hardcoded `localhost`, while an explicit
 * `STRIPE_BILLING_RETURN_URL` still wins as it always did. `billingReturnBase`
 * is re-imported per case (module-level `getStripeEnv()` caching means the
 * env must be set before the module first parses it in each case) so the
 * environment really is what decides, not import order.
 */

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_dummy",
  STRIPE_WEBHOOK_SECRET: "whsec_dummy",
};

describe("billingReturnBase", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    resetStripeEnvCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetStripeEnvCache();
  });

  it("falls back to this deployment's resolved origin when no override is configured", async () => {
    process.env = {
      ...process.env,
      ...STRIPE_ENV,
      NEXT_PUBLIC_APP_URL: "https://vibe.business",
      STRIPE_BILLING_RETURN_URL: undefined,
    };
    delete process.env.STRIPE_BILLING_RETURN_URL;
    delete process.env.VERCEL_URL;

    const { billingReturnBase } = await import("./checkout");
    expect(billingReturnBase()).toBe("https://vibe.business/app/billing");
  });

  it("falls back to localhost, never a stale hardcode, when nothing at all is configured", async () => {
    process.env = { ...process.env, ...STRIPE_ENV };
    delete process.env.STRIPE_BILLING_RETURN_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;

    const { billingReturnBase } = await import("./checkout");
    expect(billingReturnBase()).toBe("http://localhost:3000/app/billing");
  });

  it("an explicit STRIPE_BILLING_RETURN_URL still wins over the resolved origin", async () => {
    process.env = {
      ...process.env,
      ...STRIPE_ENV,
      NEXT_PUBLIC_APP_URL: "https://vibe.business",
      STRIPE_BILLING_RETURN_URL: "https://billing.vibe.business/return",
    };

    const { billingReturnBase } = await import("./checkout");
    expect(billingReturnBase()).toBe("https://billing.vibe.business/return");
  });
});
