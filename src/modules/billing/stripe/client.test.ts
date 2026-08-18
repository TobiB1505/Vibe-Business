import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStripeEnvCache } from "@/lib/env/stripe";
import { STRIPE_API_VERSION, resetStripeClientCache, verifyStripeWebhook } from "./client";

/**
 * Webhook signature verification (BILLING CORE-2 §27, §66, §102.6).
 *
 * ## Why these use a real signature rather than a mock
 *
 * The thing being tested is a cryptographic check, and mocking it would test
 * nothing at all. Stripe ships `webhooks.generateTestHeaderString` precisely so
 * that a webhook endpoint can be exercised with genuinely signed payloads —
 * which is the supported way to test this **without weakening it**. There is no
 * bypass in the endpoint to reach for, deliberately, and adding one to make
 * tests convenient would be the exact failure §66 names.
 */

const WEBHOOK_SECRET = "whsec_test_secret_for_signature_verification";

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_abc123",
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

const stripe = new Stripe("sk_test_abc123", { apiVersion: STRIPE_API_VERSION });

function payloadFor(type: string): string {
  return JSON.stringify({
    id: "evt_test_1",
    object: "event",
    type,
    livemode: false,
    data: { object: { id: "cs_test_1", object: "checkout.session" } },
  });
}

function sign(payload: string, secret: string = WEBHOOK_SECRET): string {
  return stripe.webhooks.generateTestHeaderString({ payload, secret });
}

beforeEach(() => {
  resetStripeEnvCache();
  resetStripeClientCache();
  vi.stubEnv("STRIPE_SECRET_KEY", ENV.STRIPE_SECRET_KEY);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", ENV.STRIPE_WEBHOOK_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetStripeEnvCache();
  resetStripeClientCache();
});

describe("valid signatures", () => {
  it("accepts a correctly signed payload", async () => {
    const payload = payloadFor("checkout.session.completed");
    const result = await verifyStripeWebhook({ payload, signature: sign(payload) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.id).toBe("evt_test_1");
    expect(result.event.type).toBe("checkout.session.completed");
  });
});

describe("invalid signatures are refused (§66, §102.6)", () => {
  it("refuses a payload with no signature header at all", async () => {
    expect(await verifyStripeWebhook({ payload: payloadFor("invoice.paid"), signature: null })).toEqual({
      ok: false,
      reason: "missing_signature",
    });
  });

  it("refuses an empty signature header", async () => {
    expect(await verifyStripeWebhook({ payload: payloadFor("invoice.paid"), signature: "" })).toEqual({
      ok: false,
      reason: "missing_signature",
    });
  });

  it("refuses a signature made with the wrong secret", async () => {
    // The forged-webhook case: an attacker who knows the payload shape but not
    // the signing secret.
    const payload = payloadFor("invoice.paid");
    const forged = sign(payload, "whsec_an_attackers_guess");

    expect(await verifyStripeWebhook({ payload, signature: forged })).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("refuses a payload that was altered after signing", async () => {
    // The tampering case: a real signature, applied to a body that was then
    // edited to grant a more generous pack.
    const original = JSON.stringify({
      id: "evt_test_1",
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: { id: "cs_test_1", object: "checkout.session", metadata: { vibe_sku: "pack_500" } } },
    });
    const signature = sign(original);
    const tampered = original.replace("pack_500", "pack_5000");

    expect(await verifyStripeWebhook({ payload: tampered, signature })).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("refuses a re-serialized body even when it is semantically identical", async () => {
    // The reason the route reads request.text() and never request.json().
    // Stripe signs exact bytes; a reparsed-and-restringified object is a
    // different string with the same meaning, and the HMAC no longer matches.
    const payload = payloadFor("invoice.paid");
    const signature = sign(payload);
    const reserialized = JSON.stringify(JSON.parse(payload), null, 2);

    expect(await verifyStripeWebhook({ payload: reserialized, signature })).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("refuses garbage", async () => {
    expect(await verifyStripeWebhook({ payload: "{}", signature: "t=1,v1=deadbeef" })).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("never echoes the payload or the signature in its refusal", async () => {
    // A failure message that quoted either would put payment data into logs.
    const result = await verifyStripeWebhook({
      payload: payloadFor("invoice.paid"),
      signature: "t=1,v1=deadbeef",
    });

    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
    expect(JSON.stringify(result)).not.toContain("deadbeef");
    expect(JSON.stringify(result)).not.toContain("evt_test_1");
  });
});

describe("the pinned API version", () => {
  it("matches the version this integration's field shapes were verified against", () => {
    // Subscription periods live on items, and an invoice's subscription lives
    // under `parent.subscription_details` — both true from `2025-03-31.basil`
    // onward. Pinning makes a future SDK bump a deliberate re-verification
    // rather than a silent change in where fields are read from.
    expect(STRIPE_API_VERSION).toBe("2026-07-29.dahlia");
  });
});
