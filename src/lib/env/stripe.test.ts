import { beforeEach, describe, expect, it } from "vitest";
import {
  StripeLiveModeNotAuthorizedError,
  getStripeEnv,
  hasStripeConfiguration,
  isLiveModeKey,
  resetStripeEnvCache,
} from "./stripe";

/**
 * Stripe configuration safety (BILLING CORE-2 §20, §21, §91).
 *
 * The property these tests exist to hold: **live mode cannot be reached by
 * accident.** Billing Core-2 is test-mode-first, and pasting a live key into an
 * environment variable must not be enough to start charging real customers.
 */

const TEST_CONFIG = {
  STRIPE_SECRET_KEY: "sk_test_abc123",
  STRIPE_WEBHOOK_SECRET: "whsec_test_abc123",
};

beforeEach(() => {
  resetStripeEnvCache();
});

describe("mode detection", () => {
  it("recognizes a test secret key", () => {
    expect(isLiveModeKey("sk_test_abc")).toBe(false);
    expect(isLiveModeKey("rk_test_abc")).toBe(false);
  });

  it("recognizes a live secret key", () => {
    expect(isLiveModeKey("sk_live_abc")).toBe(true);
    expect(isLiveModeKey("rk_live_abc")).toBe(true);
  });

  it("treats an unrecognized key shape as live", () => {
    // The safe direction. An unfamiliar key refuses to run rather than quietly
    // assuming it cannot spend real money.
    expect(isLiveModeKey("something_else")).toBe(true);
    expect(isLiveModeKey("")).toBe(true);
  });
});

describe("test mode", () => {
  it("accepts a test key with no further ceremony", () => {
    const env = getStripeEnv(TEST_CONFIG);

    expect(env.livemode).toBe(false);
    expect(env.STRIPE_SECRET_KEY).toBe("sk_test_abc123");
  });

  it("parses optional Price ids when configured", () => {
    const env = getStripeEnv({ ...TEST_CONFIG, STRIPE_PRICE_PACK_500: "price_500" });
    expect(env.STRIPE_PRICE_PACK_500).toBe("price_500");
  });

  it("does not require Price ids to be configured", () => {
    // A deployment mid-setup should report "that SKU cannot be purchased yet",
    // not "billing is completely broken".
    expect(() => getStripeEnv(TEST_CONFIG)).not.toThrow();
  });
});

describe("live mode requires a deliberate second act (§20, §91)", () => {
  it("refuses a live key that has not been authorized", () => {
    expect(() =>
      getStripeEnv({ ...TEST_CONFIG, STRIPE_SECRET_KEY: "sk_live_abc123" }),
    ).toThrow(StripeLiveModeNotAuthorizedError);
  });

  it("refuses a live key when the flag is not exactly \"true\"", () => {
    // A loosely parsed boolean would read "0", "no" or "" as permission.
    for (const value of ["1", "yes", "TRUE", "", "false"]) {
      resetStripeEnvCache();
      expect(() =>
        getStripeEnv({
          ...TEST_CONFIG,
          STRIPE_SECRET_KEY: "sk_live_abc123",
          STRIPE_ALLOW_LIVE_MODE: value,
        }),
      ).toThrow();
    }
  });

  it("allows live mode only when explicitly authorized", () => {
    const env = getStripeEnv({
      ...TEST_CONFIG,
      STRIPE_SECRET_KEY: "sk_live_abc123",
      STRIPE_ALLOW_LIVE_MODE: "true",
    });

    expect(env.livemode).toBe(true);
  });
});

describe("missing configuration", () => {
  it("reports absence without throwing, so the billing page can degrade", () => {
    expect(hasStripeConfiguration({})).toBe(false);
    expect(hasStripeConfiguration({ STRIPE_SECRET_KEY: "sk_test_a" })).toBe(false);
    expect(hasStripeConfiguration(TEST_CONFIG)).toBe(true);
  });

  it("names what is missing when configuration is required", () => {
    expect(() => getStripeEnv({})).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => getStripeEnv({ STRIPE_SECRET_KEY: "sk_test_a" })).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});

describe("secrets stay server-side (§21)", () => {
  it("declares no NEXT_PUBLIC_ Stripe variable", () => {
    // Next.js inlines NEXT_PUBLIC_* into the client bundle. A publishable key
    // would be legitimate there; a secret key or a webhook signing secret
    // never is, and the schema is the structural guarantee that neither can be
    // read from one.
    const env = getStripeEnv(TEST_CONFIG);
    expect(Object.keys(env).some((key) => key.startsWith("NEXT_PUBLIC"))).toBe(false);
  });
});
