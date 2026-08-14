/**
 * The screenshot-capture boundary (Sprint 11A §8, §9, §11).
 *
 * ## The security shape this interface exists to enforce
 *
 * ```
 * untrusted website → isolated browser → screenshot image → Vibe review UI
 * ```
 *
 * never
 *
 * ```
 * untrusted website → Vibe DOM
 * ```
 *
 * No iframe, no proxying HTML through Vibe, no DOM import, no page source
 * persisted. What crosses this boundary is a PNG and four numbers. That is the
 * entire reason the review layer can look at a customer's live product and a
 * sandbox serving code Vibe did not write, without either one reaching Vibe's
 * own origin.
 *
 * ## Why a separate port from `BrowserSessionProvider`
 *
 * Deep Scan's provider models an *interactive, human-authenticated* session:
 * create it, hand the user a live view, let them sign in, reconnect, analyse.
 * Its verbs are about session continuity across a human.
 *
 * Capture is the opposite shape and must not inherit those affordances. It is
 * one call, no human, no login, no live view, no reconnection, and — critically
 * — **no authenticated state at all**. Expressing it as its own narrow
 * capability is what keeps a future caller from reaching for `getLiveView` or
 * passing a Browserbase context id into a screenshot.
 *
 * The adapter behind it may share infrastructure with Deep Scan. The domain
 * must not share vocabulary.
 *
 * ## What an adapter must guarantee
 *
 * These are contract, not implementation detail, and the tests assert them:
 *
 *  - a **fresh** browser context per capture — no persistent profile, no
 *    `storageState`, no cookies carried in or out;
 *  - no customer credentials, no production cookies, no Vibe secrets reaching
 *    the page;
 *  - no session recording and no provider-side logging of page content;
 *  - the browser session is terminated on **every** terminal path, including
 *    failure and timeout;
 *  - no capability URL — connect URL, live view, debugger — is ever returned,
 *    persisted or logged.
 */

export type CaptureViewport = {
  width: number;
  height: number;
  deviceScaleFactor: number;
};

export type CaptureRequest = {
  /**
   * The page to photograph.
   *
   * Always server-resolved: the live origin comes from the project's own
   * verified production URL, the preview origin from the provider that created
   * the sandbox. There is no path by which a client names this (§33).
   */
  url: string;
  viewport: CaptureViewport;
  navigationTimeoutMs: number;
  /** Bounded wait after `domcontentloaded`. Never `networkidle` (§13). */
  settleMs: number;
  /** Whole-capture ceiling, so one hung page cannot consume the budget. */
  captureTimeoutMs: number;
  fullPage: boolean;
  /** Injected stylesheet that freezes animation for the screenshot only (§14). */
  stabilizationCss: string | null;
};

export type CaptureResult = {
  /** PNG bytes. The only page-derived data that crosses this boundary. */
  bytes: Uint8Array;
  width: number;
  height: number;
  /** HTTP status of the navigation, when the provider reports one. */
  httpStatus: number | null;
};

export type CaptureOutcome =
  | { ok: true; value: CaptureResult }
  | {
      ok: false;
      /**
       * Which layer failed, kept apart because the remedies differ entirely.
       *
       * `provider` is Vibe's problem with its vendor; `target` is the page
       * being photographed being slow, unreachable or erroring; `adapter` is a
       * defect in our own code. Collapsing them is how a failure becomes
       * unactionable — the lesson ADR 0015 §9 records after Sprint 10A lost
       * four runs to a swallowed message.
       */
      layer: "provider" | "target" | "adapter";
      /** Sanitized, bounded diagnosis. Never shown to a user, never a raw error. */
      detail: string | null;
    };

/**
 * Usage a capture session consumed, for the ledger (§22).
 *
 * Wall-clock only. Browserbase reports no attributable price with a session, so
 * cost is not part of this shape at all — a number derived from a rate card
 * would be a guess wearing an accounting figure's clothes, and there would be
 * no way to tell it apart later.
 */
export type CaptureUsage = {
  durationMs: number;
  captures: number;
};

export interface BrowserCaptureProvider {
  readonly id: "browserbase";
  /**
   * Photographs one or more URLs in a single isolated session.
   *
   * Both sides of a comparison are captured through one call so they share a
   * browser build, a viewport and a policy — the thing that makes them
   * comparable at all. The session is created and destroyed inside this call;
   * no handle escapes it.
   */
  captureAll(
    requests: readonly CaptureRequest[],
  ): Promise<{ outcomes: CaptureOutcome[]; usage: CaptureUsage }>;
}
