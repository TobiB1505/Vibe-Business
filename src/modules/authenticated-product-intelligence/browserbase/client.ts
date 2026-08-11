import "server-only";

import Browserbase from "@browserbasehq/sdk";
import { getBrowserbaseEnv, hasBrowserbaseApiKey } from "@/lib/env/browserbase";
import { BrowserbaseSessionProvider, sessionsClientFrom } from "./adapter";
import type { BrowserSessionProvider } from "../provider";

/**
 * Constructs the configured browser-session provider (ADR 0008, ADR 0012).
 *
 * `server-only` plus lazy env parsing means the API key is read at the moment
 * a scan actually starts — never at import time, never during a build, and
 * never in a client bundle.
 */

let cached: BrowserSessionProvider | undefined;

export function getBrowserSessionProvider(): BrowserSessionProvider {
  if (cached) return cached;

  const env = getBrowserbaseEnv();
  const client = new Browserbase({ apiKey: env.BROWSERBASE_API_KEY });

  cached = new BrowserbaseSessionProvider(sessionsClientFrom(client), {
    ...(env.BROWSERBASE_PROJECT_ID ? { projectId: env.BROWSERBASE_PROJECT_ID } : {}),
  });
  return cached;
}

/** Whether Deep Scan can run at all here. Gates the UI without throwing. */
export function isBrowserProviderConfigured(): boolean {
  return hasBrowserbaseApiKey();
}

/** Test-only: clears the cached provider. */
export function __resetBrowserProviderCacheForTests(): void {
  cached = undefined;
}
