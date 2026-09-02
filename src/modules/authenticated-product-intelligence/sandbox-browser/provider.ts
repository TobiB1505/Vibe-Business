import "server-only";

import { randomUUID } from "node:crypto";
import type { SandboxHandle, SandboxProvider } from "@/modules/validation/sandbox-port";
import type { AuthenticatedAnalysisFailure } from "../errors";
import type {
  BrowserConnection,
  BrowserLiveView,
  BrowserSessionHandle,
  BrowserSessionProvider,
  BrowserSessionUsage,
  CreateBrowserSessionOptions,
  ProviderResult,
} from "../provider";
import { BROWSER_GUARD_ENV } from "./guard-program";
import { BROWSER_SANDBOX, browserSandboxNameFor, chromiumCommand, guardCommand } from "./runtime";
import { deriveBrowserSessionTokens } from "./tokens";

/**
 * A browser session that is a sandbox Vibe owns (ADR 0076).
 *
 * ## What this is and is not
 *
 * It is adapter #2 behind `BrowserSessionProvider`, and it replaces
 * Browserbase. Everything above it — the analyzer, its read-only policy, the
 * route budgets, the entitlement and billing rules — is untouched, because the
 * port was already the right shape and this proves it.
 *
 * It is **not** a preview. No customer repository is cloned, built or served
 * here. The VM holds Chromium, a guard Vibe wrote, and nothing else, and it
 * points at the customer's own production origin — the same place Browserbase
 * pointed. That distinction is the whole reason the design works: a preview
 * runs the customer's code with no environment, so nobody could log into it.
 *
 * ## Why unrestricted egress, and why that is not a hole
 *
 * A browser a person signs into cannot have its destinations enumerated: an
 * identity provider, a CDN, a bot-check, whatever their login form posts to. An
 * allowlist covering all of that is a list somebody maintains until the day a
 * customer cannot sign in.
 *
 * What makes it acceptable is what is in the VM. Egress matters when there is
 * something to exfiltrate; here there is no repository, no credential, no
 * database and no source. `network-policy-scope.test.ts` is what keeps that
 * argument attached to this one file.
 *
 * ## Why the session id is a sandbox name
 *
 * `providerSessionId` is persisted, so it must be an identifier and never a
 * capability (CLAUDE.md rule 52). A sandbox name is exactly that: it names the
 * VM and opens nothing. Both tokens are derived from it per request and never
 * stored — see `tokens.ts` for why that is a property of the login flow rather
 * than a preference.
 */

/**
 * The reusable image a browser session starts from.
 *
 * A port rather than a concrete store, because building one is a different
 * kind of operation from using one — it wants a package registry, minutes
 * rather than seconds, and a place to remember the result. The provider only
 * ever asks "which snapshot", which is what makes it testable without either.
 */
export type BrowserRuntimeImage = {
  resolve(): Promise<
    { ok: true; snapshotId: string } | { ok: false; error: AuthenticatedAnalysisFailure }
  >;
};

export type SandboxBrowserProviderDeps = {
  sandboxes: SandboxProvider;
  image: BrowserRuntimeImage;
  /** Injectable so a test can exercise a slow start without waiting for one. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** How long Vibe waits for the guard to report the VM usable. */
const READY_TIMEOUT_MS = 45_000;
const READY_POLL_MS = 500;

const READY_PATH = `${BROWSER_SANDBOX.root}/ready`;

function failure<T>(error: AuthenticatedAnalysisFailure): ProviderResult<T> {
  return { ok: false, error };
}

/**
 * The public origin as a WebSocket origin.
 *
 * Derived from what the provider returned rather than assembled from a
 * hostname of our own, so a provider that changes its routing changes this
 * with it. `https` is the only scheme a sandbox origin has; anything else is a
 * provider answering something we do not understand, and it refuses rather
 * than coercing.
 */
function websocketOrigin(origin: string): string | null {
  if (!origin.startsWith("https://")) return null;
  return `wss://${origin.slice("https://".length)}`;
}

export function createSandboxBrowserSessionProvider(
  deps: SandboxBrowserProviderDeps,
): BrowserSessionProvider {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  /**
   * Reconnects by name, refusing anything that is not demonstrably running.
   *
   * The two reasons a session cannot be reached are kept apart on purpose: a
   * name the provider has never heard of is `browser_session_not_found`, and a
   * sandbox that has passed its own timeout is `browser_session_expired`. The
   * caller shows a person a different sentence for each.
   */
  async function live(name: string): Promise<ProviderResult<SandboxHandle>> {
    let handle: SandboxHandle | null;
    try {
      handle = await deps.sandboxes.reconnect({ name });
    } catch {
      return failure("browser_provider_unavailable");
    }
    if (!handle) return failure("browser_session_not_found");
    if (handle.liveness !== "running") return failure("browser_session_expired");
    return { ok: true, value: handle };
  }

  /** The guard's own readiness file, polled until it appears or the ceiling is reached. */
  async function waitUntilReady(handle: SandboxHandle): Promise<boolean> {
    const deadline = now() + READY_TIMEOUT_MS;
    while (now() < deadline) {
      // Bounded hard: this is a file Vibe's own guard wrote, and a large read
      // here would mean something else is writing it.
      const content = await handle.readFile({ path: READY_PATH, maxBytes: 64 }).catch(() => null);
      if (content !== null) return true;
      await sleep(READY_POLL_MS);
    }
    return false;
  }

  async function urlFor(
    name: string,
    channel: "control" | "view",
  ): Promise<ProviderResult<string>> {
    const handle = await live(name);
    if (!handle.ok) return handle;

    let origin: string;
    try {
      origin = await handle.value.publicOrigin(BROWSER_SANDBOX.publicPort);
    } catch {
      // The guard may be running perfectly and still be unroutable. That is a
      // provider fact, not the session having gone away.
      return failure("browser_provider_unavailable");
    }

    const ws = websocketOrigin(origin);
    if (!ws) return failure("browser_provider_unavailable");

    const tokens = deriveBrowserSessionTokens(name);
    return { ok: true, value: `${ws}/${channel}?token=${tokens[channel]}` };
  }

  return {
    name: "vercel_sandbox_browser",

    async createSession(
      options: CreateBrowserSessionOptions,
    ): Promise<ProviderResult<BrowserSessionHandle>> {
      const image = await deps.image.resolve();
      if (!image.ok) return failure(image.error);

      const name = browserSandboxNameFor(randomUUID());
      const tokens = deriveBrowserSessionTokens(name);
      const timeoutMs = options.timeoutSeconds * 1000;

      let handle: SandboxHandle;
      try {
        handle = await deps.sandboxes.create({
          name,
          source: { kind: "snapshot", snapshotId: image.snapshotId },
          // See the header. Scoped to this file by network-policy-scope.test.ts.
          networkPolicy: { mode: "allow_all" },
          // Exactly one, and it is the guard's. Chromium's DevTools port is
          // absent from this list and stays on loopback.
          ports: [BROWSER_SANDBOX.publicPort],
          timeoutMs,
          vcpus: BROWSER_SANDBOX.vcpus,
          env: {
            [BROWSER_GUARD_ENV.controlToken]: tokens.control,
            [BROWSER_GUARD_ENV.viewToken]: tokens.view,
            [BROWSER_GUARD_ENV.publicPort]: String(BROWSER_SANDBOX.publicPort),
            [BROWSER_GUARD_ENV.devtoolsPort]: String(BROWSER_SANDBOX.devtoolsPort),
            [BROWSER_GUARD_ENV.readyFile]: READY_PATH,
          },
        });
      } catch {
        return failure("browser_session_create_failed");
      }

      try {
        // Chromium first: the guard waits for it and refuses to report ready
        // without it, so the order here is what that wait is for.
        await handle.runBackground({ command: chromiumCommand(), cwd: BROWSER_SANDBOX.root });
        await handle.runBackground({ command: guardCommand(), cwd: BROWSER_SANDBOX.root });
      } catch {
        await handle.stop().catch(() => undefined);
        return failure("browser_session_create_failed");
      }

      if (!(await waitUntilReady(handle))) {
        // A VM nobody can use is worse than none: it bills for its whole
        // timeout and shows a person a live view that never paints.
        await handle.stop().catch(() => undefined);
        return failure("browser_session_create_failed");
      }

      let connectUrl: string;
      try {
        const origin = await handle.publicOrigin(BROWSER_SANDBOX.publicPort);
        const ws = websocketOrigin(origin);
        if (!ws) throw new Error("unroutable");
        connectUrl = `${ws}/control?token=${tokens.control}`;
      } catch {
        await handle.stop().catch(() => undefined);
        return failure("browser_provider_unavailable");
      }

      return {
        ok: true,
        value: {
          providerSessionId: name,
          connectUrl,
          // Vibe set the ceiling, so Vibe can state it. Reading it back from
          // the provider would be asking a question we already know the answer
          // to, and getting a different one would not change when the VM dies.
          expiresAt: new Date(now() + timeoutMs).toISOString(),
        },
      };
    },

    async getConnection(providerSessionId: string): Promise<ProviderResult<BrowserConnection>> {
      const url = await urlFor(providerSessionId, "control");
      return url.ok ? { ok: true, value: { connectUrl: url.value } } : url;
    },

    async getLiveView(providerSessionId: string): Promise<ProviderResult<BrowserLiveView>> {
      const url = await urlFor(providerSessionId, "view");
      return url.ok ? { ok: true, value: { url: url.value } } : url;
    },

    async terminateSession(
      providerSessionId: string,
    ): Promise<ProviderResult<BrowserSessionUsage | null>> {
      let handle: SandboxHandle | null;
      try {
        handle = await deps.sandboxes.reconnect({ name: providerSessionId });
      } catch {
        return failure("browser_provider_unavailable");
      }

      // Already gone is the outcome this asks for, so it is a success. This is
      // called on completion, failure, cancellation *and* expiry, and a
      // terminal path that throws because the thing it wanted destroyed was
      // already destroyed would turn cleanup into an error to handle. There is
      // nothing left to measure, which is what `null` says.
      if (!handle) return { ok: true, value: null };

      try {
        const usage = await handle.stop();
        return {
          ok: true,
          value: {
            sandboxDurationMs: null,
            activeCpuMs: usage.activeCpuDurationMs,
            outboundBytes: usage.networkEgressBytes,
            // Vercel reports no attributable price per sandbox, so this is null
            // in practice — and it is read from the provider rather than pinned
            // to null, so a provider that ever does answer stops being ignored
            // without anybody having to remember this line exists.
            costUsd: usage.costUsd,
            // Configured rather than reported: the provider does not say what
            // it allocated, so this is the profile's own request. That is
            // exactly the distinction the estimate's basis vocabulary records.
            vcpus: BROWSER_SANDBOX.vcpus,
          },
        };
      } catch {
        return failure("browser_provider_unavailable");
      }
    },
  };
}
