/**
 * `review-policy-v1` — what makes two screenshots comparable (Sprint 11A §12, §13, §14, §17).
 *
 * Every number here is part of the policy version. A comparison is only
 * meaningful if both sides were produced under identical conditions, so the
 * conditions are named once, applied to both sides from the same constant, and
 * pinned into the review identity. Changing one changes what a stored
 * comparison *is*.
 */

export const REVIEW_POLICY = {
  /**
   * The single compared route (§4).
   *
   * One route, and the root, because V0.1 is proving that a controlled
   * before/after can be produced at all. Multi-route review is a real
   * capability and a different sprint; adding it now would multiply browser
   * cost before anyone has looked at one comparison.
   *
   * Server-resolved and never accepted from a client, so there is no parameter
   * through which a caller could point the browser somewhere else.
   */
  route: "/",

  /**
   * Desktop viewport, identical on both sides.
   *
   * 1440 × 1000 is a common desktop working area and, more importantly, it is
   * *one* number applied twice. The failure this prevents is subtle and would
   * look like a product change: capture "before" at one width and "after" at
   * another, and every reflowed element reads as a diff the change did not
   * make.
   */
  viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },

  /**
   * Fixed viewport, not full page.
   *
   * Full-page height varies with content, so two full-page screenshots of
   * different lengths cannot be laid side by side without scaling one of them —
   * and scaling is exactly how a comparison starts lying. A fixed frame
   * compares the same rectangle of both.
   */
  fullPage: false,

  format: "png" as const,

  /** How long the page has to respond at all before the capture is abandoned. */
  navigationTimeoutMs: 20_000,

  /**
   * Bounded settle after `domcontentloaded` (§13).
   *
   * Deliberately **not** `networkidle`. A modern app can hold a connection open
   * indefinitely — analytics, websockets, polling — so `networkidle` may never
   * arrive, and waiting for it would turn a screenshot into a multi-minute
   * browser job billed by the second. The Deep Scan connector learned the same
   * thing and navigates on `domcontentloaded` for the same reason.
   *
   * A short fixed settle is less clever and more honest: it gives fonts and
   * above-the-fold images a chance to land, and it costs a known amount.
   */
  settleMs: 2_500,

  /**
   * Whole-capture ceiling, so one unresponsive page cannot consume the budget.
   */
  captureTimeoutMs: 45_000,

  /**
   * Provider-side session ceiling.
   *
   * A backstop for the case where Vibe's own cleanup never runs: an abandoned
   * browser must not live indefinitely. Generous enough for two captures plus
   * connection overhead, and nothing more.
   */
  sessionTimeoutSeconds: 120,

  /**
   * Freeze animations for the screenshot only (§14).
   *
   * A carousel, a fade-in or a blinking caret produces a different pixel on
   * every capture, which would show up as a difference the change did not
   * make. The stylesheet is injected into the *rendering* of the page and
   * touches no application source.
   *
   * It is best-effort by nature: a canvas animation or a video will not be
   * stopped by CSS. That limit is recorded rather than papered over.
   */
  disableAnimations: true,

  /**
   * How long a comparison remains viewable (§17).
   *
   * Seven days, chosen. Long enough that a review is not lost overnight or
   * across a weekend; short enough that Vibe is not indefinitely storing images
   * of a customer's product. Deliberately *longer* than the preview it came
   * from, because the artifact exists precisely so the sandbox can be stopped
   * (§7).
   *
   * Not inherited from a storage default, which is what happens when nobody
   * decides.
   */
  retentionMs: 7 * 24 * 60 * 60 * 1000,
} as const;

/**
 * The stylesheet injected before a capture.
 *
 * Applied to both sides identically, like everything else in this policy. It
 * disables animation, transition and caret blinking, and forces a consistent
 * scroll position so two captures of the same page frame the same content.
 */
export const SCREENSHOT_STABILIZATION_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}
* { caret-color: transparent !important; }
html { scroll-behavior: auto !important; }
`.trim();

export type ReviewPolicy = typeof REVIEW_POLICY;
