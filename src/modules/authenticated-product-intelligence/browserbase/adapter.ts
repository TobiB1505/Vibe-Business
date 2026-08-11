import type Browserbase from "@browserbasehq/sdk";
import type {
  BrowserLiveView,
  BrowserSessionHandle,
  BrowserSessionProvider,
  CreateBrowserSessionOptions,
  ProviderResult,
} from "../provider";

/**
 * Browserbase adapter (Sprint 5 §4, §6, §7 — ADR 0012).
 *
 * The only file allowed to name Browserbase's API shape. Everything above it
 * sees `BrowserSessionProvider` and typed failure codes.
 *
 * Three settings are **hard security invariants**, asserted by tests, and none
 * of them may rely on a provider default:
 *
 *  - `recordSession: false` — **the SDK default is `true`.** An authenticated
 *    session contains password entry, MFA codes and real customer data; a
 *    recording of it would be a durable copy of exactly what this feature
 *    promises not to keep (Sprint 5 §7).
 *  - `logSession: false` — also defaults to `true`. Same reasoning applied to
 *    provider-side console/network logs.
 *  - **No `context`.** Supplying a Browserbase Context would persist cookies
 *    and storage across sessions, which is precisely the reusable
 *    authentication state V0.1 refuses to hold (Sprint 5 §6).
 *
 * `solveCaptchas: false` is set for a different reason: automated CAPTCHA
 * solving is out of scope (Sprint 5 §4). The human is present and solves their
 * own challenges.
 *
 * `keepAlive: true` is **required by the manual-login flow**, and this was wrong
 * in the first version of this adapter. The flow spans two separate server
 * requests — create the session, then reconnect after the user has signed in
 * through the Live View — with a human in between. With `keepAlive: false` the
 * provider is free to end the session when the first request's connection
 * drops, so the reconnect would find nothing and every scan would fail.
 *
 * `keepAlive` is **session continuity, not persistent authentication**: it keeps
 * one temporary browser alive across a login the user performs by hand. It adds
 * no stored state, and it makes the other two guarantees load-bearing rather
 * than incidental — an explicit short `timeout` so an abandoned browser cannot
 * live indefinitely, and `REQUEST_RELEASE` on every terminal path (Sprint 5 §14).
 */

/** The slice of the SDK this adapter uses, declared structurally so tests need no SDK. */
export type BrowserbaseSessionsClient = {
  create(params: {
    projectId?: string;
    browserSettings?: {
      recordSession?: boolean;
      logSession?: boolean;
      solveCaptchas?: boolean;
      context?: { id: string; persist?: boolean };
    };
    keepAlive?: boolean;
    timeout?: number;
  }): Promise<{ id: string; connectUrl: string; expiresAt?: string | null }>;
  debug(id: string): Promise<{ debuggerFullscreenUrl: string; debuggerUrl: string }>;
  update(id: string, params: { status: "REQUEST_RELEASE"; projectId?: string }): Promise<unknown>;
};

export type BrowserbaseAdapterConfig = {
  projectId?: string;
};

/**
 * Reduces any thrown provider value to a typed code.
 *
 * Deliberately coarse and message-blind: matching on provider prose would
 * silently reclassify failures the day Browserbase rewords something, and the
 * message itself must not reach a caller (Sprint 5 §28).
 */
function classifyProviderError(error: unknown): "browser_provider_unavailable" | "browser_session_not_found" {
  const status = readStatus(error);
  if (status === 404) return "browser_session_not_found";
  return "browser_provider_unavailable";
}

function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

export class BrowserbaseSessionProvider implements BrowserSessionProvider {
  readonly name = "browserbase";

  constructor(
    private readonly sessions: BrowserbaseSessionsClient,
    private readonly config: BrowserbaseAdapterConfig = {},
  ) {}

  async createSession(
    options: CreateBrowserSessionOptions,
  ): Promise<ProviderResult<BrowserSessionHandle>> {
    try {
      const session = await this.sessions.create({
        ...(this.config.projectId ? { projectId: this.config.projectId } : {}),
        browserSettings: {
          // Every one of these is explicit. See the invariants above — the
          // provider defaults for the first two are `true`.
          recordSession: false,
          logSession: false,
          solveCaptchas: false,
          // `context` is deliberately absent, not undefined-by-omission-by-
          // accident: there is no code path that can add one.
        },
        // See the note above: the login happens between two requests, so the
        // session must survive the first connection closing. The `timeout`
        // below is what bounds it.
        keepAlive: true,
        timeout: options.timeoutSeconds,
      });

      return {
        ok: true,
        value: {
          providerSessionId: session.id,
          connectUrl: session.connectUrl,
          expiresAt: session.expiresAt ?? null,
        },
      };
    } catch (error) {
      const code = classifyProviderError(error);
      return {
        ok: false,
        error: code === "browser_session_not_found" ? "browser_session_create_failed" : code,
      };
    }
  }

  async getLiveView(providerSessionId: string): Promise<ProviderResult<BrowserLiveView>> {
    try {
      const urls = await this.sessions.debug(providerSessionId);
      // The fullscreen variant is the one meant for embedding: it omits the
      // provider's own surrounding chrome, which the user has no use for.
      return { ok: true, value: { url: urls.debuggerFullscreenUrl } };
    } catch (error) {
      return { ok: false, error: classifyProviderError(error) };
    }
  }

  async terminateSession(providerSessionId: string): Promise<ProviderResult<void>> {
    try {
      await this.sessions.update(providerSessionId, {
        status: "REQUEST_RELEASE",
        ...(this.config.projectId ? { projectId: this.config.projectId } : {}),
      });
      return { ok: true, value: undefined };
    } catch (error) {
      // A session that is already gone is a successful outcome for a
      // terminator: the goal is "no browser left running", not "the provider
      // acknowledged this exact call".
      const code = classifyProviderError(error);
      if (code === "browser_session_not_found") return { ok: true, value: undefined };
      return { ok: false, error: code };
    }
  }
}

/** Narrows the real SDK to the structural slice above. */
export function sessionsClientFrom(client: Browserbase): BrowserbaseSessionsClient {
  return client.sessions as unknown as BrowserbaseSessionsClient;
}
