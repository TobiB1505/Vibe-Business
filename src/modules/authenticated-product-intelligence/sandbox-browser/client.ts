import "server-only";

import { hasBrowserSandboxSecret } from "@/lib/env/browser-sandbox";
import { createServiceClient } from "@/lib/supabase/service";
import { createVercelSandboxProvider } from "@/modules/validation/vercel/provider";
import type { BrowserSessionProvider } from "../provider";
import { createBrowserRuntimeImage } from "./image";
import { createSandboxBrowserSessionProvider } from "./provider";

/**
 * Constructs the configured browser-session provider (ADR 0076).
 *
 * `server-only` plus lazy env parsing means the session secret is read at the
 * moment a scan actually starts — never at import time, never during a build,
 * and never in a client bundle.
 *
 * ## Why a service-role client
 *
 * `browser_runtime_images` is Vibe's own infrastructure, not customer data: it
 * holds which provider snapshot a browser starts from, the same value for every
 * customer. It has RLS enabled with **no policies at all**, deliberately, so a
 * caller's cookie-scoped client reads nothing and writes nothing. There is no
 * ownership to scope this by, because there is no owner — which is why the site
 * is reviewed in `service-boundary.test.ts` rather than moved into
 * `src/modules/operations`: a Deep Scan is not a durable operation, it has no
 * `operation_runs` row, and this read happens inside a Server Action's request.
 *
 * Nothing here takes an identifier from a caller. The only argument any query
 * makes is the guard's own version constant.
 */

let cached: BrowserSessionProvider | undefined;

export function getBrowserSessionProvider(): BrowserSessionProvider {
  if (cached) return cached;

  const supabase = createServiceClient();
  const sandboxes = createVercelSandboxProvider();

  cached = createSandboxBrowserSessionProvider({
    sandboxes,
    image: createBrowserRuntimeImage({ supabase, sandboxes }),
  });
  return cached;
}

/** Whether Deep Scan can run at all here. Gates the UI without throwing. */
export function isBrowserProviderConfigured(): boolean {
  return hasBrowserSandboxSecret();
}
