import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SandboxHandle, SandboxProvider } from "@/modules/validation/sandbox-port";
import { writeSandboxTextFile } from "@/modules/validation/sandbox-files";
import type { AuthenticatedAnalysisFailure } from "../errors";
import { BROWSER_RUNTIME_VERSION } from "./guard-program";
import {
  IMAGE_BUILD_HOSTS,
  IMAGE_LINK,
  IMAGE_LINK_PROGRAM,
  imageBuildCommands,
  imageBuildEnv,
  imageLinkCommand,
} from "./image-build";
import type { BrowserRuntimeImage } from "./provider";
import { BROWSER_SANDBOX } from "./runtime";

/**
 * Resolving the image a browser session starts from (ADR 0076).
 *
 * ## Read-triggered, never scheduled
 *
 * A provider snapshot has a lifetime, so the recorded id stops naming anything
 * after its expiry. The rebuild happens on the next read that finds no usable
 * row — no cron, no scheduler, no queue. CLAUDE.md rule 24's "needs no new
 * infrastructure" met rather than argued around, and the same pattern ADR 0069
 * had to make an exception for only because a retention period needs a clock
 * and this does not: something is always about to ask.
 *
 * ## Why the lookup is keyed on the guard version
 *
 * An image built for one guard is not an image for another. Keying on recency
 * alone would start a changed guard from a filesystem assembled for the old
 * one, and the failure would be a browser that comes up and then behaves
 * subtly differently — the worst kind to diagnose.
 *
 * ## What a failed build costs
 *
 * One sandbox, discarded. It is deliberately not retried here: a build that
 * failed for a reason that persists — a registry outage, a browser download
 * that moved — would otherwise be retried once per scan, each time for the
 * minutes a build takes, on a person waiting for a browser. The failure is
 * reported and the next scan tries again.
 */

const BUILD_TIMEOUT_MS = 300_000;
const BUILD_STEP_TIMEOUT_MS = 180_000;
/**
 * How long a built image is kept.
 *
 * Explicit because the provider's own default is 30 days, which is not a
 * retention anybody chose. Seven days is short enough that a stale image is
 * never long-lived and long enough that a rebuild is rare.
 */
const IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type ImageRow = { snapshot_id: string };

export type BrowserRuntimeImageDeps = {
  supabase: SupabaseClient;
  sandboxes: SandboxProvider;
  now?: () => number;
};

/**
 * A build sandbox, torn down on every path.
 *
 * `snapshot()` is terminal at the provider — after it the sandbox is
 * unreachable — so the cleanup below is for the paths that never got there.
 */
async function discard(handle: SandboxHandle): Promise<void> {
  await handle.stop().catch(() => undefined);
}

export function createBrowserRuntimeImage(deps: BrowserRuntimeImageDeps): BrowserRuntimeImage {
  const now = deps.now ?? Date.now;

  async function recorded(): Promise<string | null> {
    const { data } = await deps.supabase
      .from("browser_runtime_images")
      .select("snapshot_id")
      .eq("runtime_version", BROWSER_RUNTIME_VERSION)
      .gt("expires_at", new Date(now()).toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle<ImageRow>();

    return data?.snapshot_id ?? null;
  }

  async function build(): Promise<
    { ok: true; snapshotId: string } | { ok: false; error: AuthenticatedAnalysisFailure }
  > {
    let handle: SandboxHandle;
    try {
      handle = await deps.sandboxes.create({
        // No source at all: the image is Chromium and a guard, and a customer
        // repository has no place in either.
        name: `vibe-browser-image-${Date.now()}`,
        source: { kind: "image" },
        // The build window, and it is narrow because a build knows where it is
        // going. A *session* does not, which is why the two are separate.
        networkPolicy: { mode: "allow_domains", domains: [...IMAGE_BUILD_HOSTS] },
        // No inbound. Nothing serves anything during a build.
        timeoutMs: BUILD_TIMEOUT_MS,
        env: imageBuildEnv(),
      });
    } catch {
      return { ok: false, error: "browser_provider_unavailable" };
    }

    try {
      for (const command of imageBuildCommands()) {
        const result = await handle.run({
          command,
          cwd: BROWSER_SANDBOX.root,
          timeoutMs: BUILD_STEP_TIMEOUT_MS,
        });
        if (result.exitCode !== 0) {
          await discard(handle);
          return { ok: false, error: "browser_provider_unavailable" };
        }
      }

      // Both Vibe-authored programs land in the image rather than in each
      // session, so a session starts by running them rather than by receiving
      // them.
      const link = await writeSandboxTextFile(handle, {
        path: IMAGE_LINK.programPath,
        content: IMAGE_LINK_PROGRAM,
      });
      if (!link.ok) {
        await discard(handle);
        return { ok: false, error: "browser_provider_unavailable" };
      }

      const linked = await handle.run({
        command: imageLinkCommand(),
        cwd: BROWSER_SANDBOX.root,
        timeoutMs: BUILD_STEP_TIMEOUT_MS,
        env: { ...imageBuildEnv(), ...IMAGE_LINK.env },
      });
      if (linked.exitCode !== 0) {
        await discard(handle);
        return { ok: false, error: "browser_provider_unavailable" };
      }

      const guard = await writeSandboxTextFile(handle, {
        path: `${BROWSER_SANDBOX.root}/guard.mjs`,
        content: (await import("./guard-program")).BROWSER_GUARD_PROGRAM,
      });
      if (!guard.ok) {
        await discard(handle);
        return { ok: false, error: "browser_provider_unavailable" };
      }

      const artifact = await handle.snapshot({ expirationMs: IMAGE_TTL_MS });

      await deps.supabase.from("browser_runtime_images").insert({
        runtime_version: BROWSER_RUNTIME_VERSION,
        snapshot_id: artifact.snapshotId,
        // Vibe's own ceiling, not the provider's report of it. If the provider
        // says something shorter the row simply expires early and a rebuild
        // happens; the other direction would keep using an image that is gone.
        expires_at: new Date(now() + IMAGE_TTL_MS).toISOString(),
      });

      return { ok: true, snapshotId: artifact.snapshotId };
    } catch {
      await discard(handle);
      return { ok: false, error: "browser_provider_unavailable" };
    }
  }

  return {
    async resolve() {
      const existing = await recorded();
      if (existing) return { ok: true, snapshotId: existing };
      return await build();
    },
  };
}
