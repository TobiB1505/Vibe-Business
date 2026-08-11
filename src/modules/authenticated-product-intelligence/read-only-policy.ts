/**
 * Read-only analysis policy (Sprint 5 §17, §18, §19).
 *
 * Once the user hands the session over for analysis, Vibe is operating inside
 * someone's live application while logged in as them. The only acceptable
 * default is that nothing we do can change their data.
 *
 * This module is the decision layer, kept pure so it can be exhaustively
 * tested; the Playwright adapter applies it. Two things it decides:
 *
 *  1. Whether a request may proceed (mutating methods are refused).
 *  2. Whether an event is allowed at all (downloads, permission prompts).
 *
 * The honest limitation, surfaced rather than hidden: some applications hydrate
 * over POST — GraphQL, server actions, tRPC batching. Blocking those can leave
 * a page half-rendered. We block anyway and *report* it
 * (`application_requires_mutating_method_for_render`), because a wrong audit is
 * recoverable and a deleted customer record is not (Sprint 5 §18).
 */

export const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"] as const;

export type RequestDecision =
  | { allow: true }
  | { allow: false; reason: "mutating_method" | "external_navigation" };

export type RequestContext = {
  method: string;
  url: string;
  /** True for a top-level document navigation rather than a subresource. */
  isNavigation: boolean;
  /** The origin analysis is confined to. */
  origin: string;
};

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * Decides one request during analysis mode.
 *
 * Ordering matters: an external *navigation* is refused even when its method is
 * safe, because a GET to a third-party dashboard is still a page we have no
 * business loading (Sprint 5 §15). Subresources from other origins — fonts,
 * images, analytics beacons — are left alone: blocking them would break
 * rendering without improving safety, since they cannot mutate the product.
 */
export function decideRequest(context: RequestContext): RequestDecision {
  const method = context.method.toUpperCase();

  if (context.isNavigation && !sameOrigin(context.url, context.origin)) {
    return { allow: false, reason: "external_navigation" };
  }

  if (!SAFE_METHODS.includes(method as (typeof SAFE_METHODS)[number])) {
    return { allow: false, reason: "mutating_method" };
  }

  return { allow: true };
}

/**
 * Browser permissions and capabilities denied for the whole analysis phase
 * (Sprint 5 §19). Passed to the browser context so no page can prompt for or
 * silently obtain any of them.
 */
export const DENIED_PERMISSIONS = [
  "geolocation",
  "notifications",
  "camera",
  "microphone",
  "clipboard-read",
  "clipboard-write",
  "midi",
  "background-sync",
  "payment-handler",
] as const;

/** Downloads are always refused; we never read a downloaded file's contents. */
export function shouldBlockDownload(): true {
  return true;
}

/**
 * Interactions the analyzer will never perform, documented as a list so the
 * intent is reviewable rather than implied by the absence of code.
 *
 * Navigation is by `page.goto()` to a validated same-origin path — never by
 * clicking, because a click's destination and side effects are whatever the
 * page decides they are (Sprint 5 §17).
 */
export const FORBIDDEN_INTERACTIONS = [
  "click",
  "tap",
  "fill",
  "type",
  "press",
  "check",
  "selectOption",
  "setInputFiles",
  "dragAndDrop",
  "dispatchEvent",
] as const;
