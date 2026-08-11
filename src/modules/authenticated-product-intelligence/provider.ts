import type { AuthenticatedAnalysisFailure } from "./errors";

/**
 * The browser-session boundary (Sprint 5 §5, ADR 0012).
 *
 * Browserbase is adapter #1 and must not become domain logic: nothing outside
 * `./browserbase/` may import its SDK, name its fields, or see its errors.
 * The interface is deliberately narrow — four verbs — because a remote browser
 * is infrastructure, not a feature.
 *
 * Two fields never appear on a persisted or client-visible object, and the
 * types enforce it by keeping them inside short-lived return values only:
 *
 *  - `connectUrl` — a capability URL granting full CDP control of the browser.
 *  - `liveViewUrl` — a capability URL granting interactive control to whoever
 *    holds it.
 *
 * Both are fetched server-side per use and thrown away (Sprint 5 §10, §12).
 */

export type BrowserSessionHandle = {
  /** The provider's own session id. Operational metadata, not a capability. */
  providerSessionId: string;
  /**
   * CDP endpoint for this session. **Capability URL** — never persisted,
   * logged, or returned to a browser.
   */
  connectUrl: string;
  /** Provider-side automatic end time, so we can bound our own expiry by it. */
  expiresAt: string | null;
};

export type BrowserLiveView = {
  /**
   * Interactive live-view URL. **Capability URL** — returned to the owning
   * user for the lifetime of one response and never stored anywhere.
   */
  url: string;
};

export type CreateBrowserSessionOptions = {
  /**
   * Hard provider-side ceiling in seconds. Set explicitly so an abandoned
   * browser cannot run indefinitely if our own cleanup never happens
   * (Sprint 5 §11).
   */
  timeoutSeconds: number;
};

export type ProviderResult<T> = { ok: true; value: T } | { ok: false; error: AuthenticatedAnalysisFailure };

export type BrowserSessionProvider = {
  readonly name: string;
  createSession(options: CreateBrowserSessionOptions): Promise<ProviderResult<BrowserSessionHandle>>;
  getLiveView(providerSessionId: string): Promise<ProviderResult<BrowserLiveView>>;
  /**
   * Best-effort termination. Called on completion, failure, cancellation and
   * expiry — so it must be safe to call on an already-dead session.
   */
  terminateSession(providerSessionId: string): Promise<ProviderResult<void>>;
};
