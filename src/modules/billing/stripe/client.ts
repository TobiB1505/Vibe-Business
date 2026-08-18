import "server-only";

import Stripe from "stripe";
import { getStripeEnv } from "@/lib/env/stripe";

/**
 * The Stripe SDK boundary (BILLING CORE-2 §19, §21).
 *
 * The only module in the application that constructs a Stripe client. Every
 * other file talks to Stripe through the narrow functions in this directory,
 * for the same reason `src/modules/ai/anthropic/` is the only place an AI SDK
 * is imported: a provider that can be reached from anywhere is a provider that
 * cannot be swapped, rate-limited, or audited in one place.
 *
 * ## The pinned API version
 *
 * Stripe's API is versioned, and a version change can move a field without
 * breaking a request. Two examples that Billing Core-2 verified directly
 * against this SDK's own type definitions rather than trusting recollection:
 *
 * - `Subscription.current_period_start` / `current_period_end` no longer exist
 *   on the subscription. They live on each **subscription item**
 *   (`subscription.items.data[].current_period_end`).
 * - `Invoice.subscription` no longer exists. It is
 *   `invoice.parent.subscription_details.subscription`.
 *
 * Both moved in the `2025-03-31.basil` release, and code written from memory
 * would not have failed loudly — it would have read `undefined` and granted
 * Credits with a null expiry. So the version is pinned explicitly to the one
 * this SDK's types describe, and upgrading it is a deliberate change with the
 * field shapes re-verified, not a side effect of a dependency bump.
 */

/**
 * The Stripe API version this integration is written against.
 *
 * Matches the version `stripe@22.5.0` pins by default. Stated explicitly
 * anyway: an implicit default silently changes under a dependency upgrade,
 * and the field-shape drift described above is exactly what that would hide.
 */
export const STRIPE_API_VERSION = "2026-07-29.dahlia" satisfies Stripe.LatestApiVersion;

let cached: Stripe | undefined;

/**
 * The configured Stripe client.
 *
 * Throws when Stripe is not configured, and refuses a live-mode key that has
 * not been explicitly authorized — see `src/lib/env/stripe.ts`. Callers that
 * must tolerate an unconfigured deployment check `hasStripeConfiguration()`
 * first rather than catching from here.
 */
export function getStripeClient(): Stripe {
  if (cached) return cached;

  const env = getStripeEnv();
  cached = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    // Identifies Vibe in Stripe's own request logs, which is what makes a
    // support conversation about a specific charge tractable.
    appInfo: { name: "Vibe Business", url: "https://github.com/TobiB1505/Vibe-Business" },
    // Stripe's client retries idempotently on network errors. Left at the
    // SDK default rather than raised: a *payment* retry must be governed by
    // explicit idempotency keys, not by a transport-level count.
    maxNetworkRetries: 2,
  });

  return cached;
}

/** Test-only. Clears the memoized client between cases. */
export function resetStripeClientCache(): void {
  cached = undefined;
}

/**
 * Verifies a webhook signature and returns the event (§27, §66).
 *
 * ## Why the raw body, and why async
 *
 * Stripe signs the exact bytes it sent. `JSON.parse` followed by
 * `JSON.stringify` produces a semantically identical object and a *different*
 * string, so the HMAC no longer matches — parsing before verifying is the
 * single most common cause of a failed signature check. The caller therefore
 * passes `await request.text()`, never `await request.json()`.
 *
 * `constructEventAsync` rather than `constructEvent`: the async form uses Web
 * Crypto, works on both the Node and Edge runtimes, and is the form Stripe
 * documents for Next.js Route Handlers.
 *
 * ## No bypass
 *
 * There is deliberately no environment check here, no `skipVerification`
 * parameter and no development shortcut (§66). A signature check that can be
 * disabled by configuration is an unauthenticated endpoint that mints Credits.
 * Tests construct genuinely signed payloads with Stripe's own
 * `webhooks.generateTestHeaderString`, which is the supported way to test this
 * without weakening it.
 */
export async function verifyStripeWebhook(params: {
  payload: string;
  signature: string | null;
}): Promise<{ ok: true; event: Stripe.Event } | { ok: false; reason: "missing_signature" | "invalid_signature" }> {
  if (!params.signature) return { ok: false, reason: "missing_signature" };

  const env = getStripeEnv();

  try {
    const event = await getStripeClient().webhooks.constructEventAsync(
      params.payload,
      params.signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
    return { ok: true, event };
  } catch {
    // Deliberately swallowing the Stripe error rather than propagating or
    // logging it. A signature failure's message can echo the payload and the
    // provided signature back, and neither belongs in a log line (§21, §68).
    // The only fact the caller needs is that verification failed.
    return { ok: false, reason: "invalid_signature" };
  }
}
