import "server-only";

import { z } from "zod";

/**
 * Validated, server-only Browserbase configuration (ADR 0008, ADR 0012).
 *
 * Guarded by `server-only` so an accidental import from a Client Component
 * fails the build rather than shipping an API key to a browser. Deliberately
 * *not* `NEXT_PUBLIC_` prefixed — see src/lib/env/README.md.
 *
 * Parsed lazily, only from a code path that is about to start a browser
 * session, so `pnpm build`, `pnpm test` and CI all run without a real key.
 *
 * `BROWSERBASE_PROJECT_ID` is optional because the SDK infers the project from
 * the API key when it is omitted. It is supported for accounts with several
 * projects, and never guessed.
 */

const browserbaseEnvSchema = z.object({
  // Presence only, deliberately.
  //
  // This previously required a `bb_` prefix as a "cheap shape check". That was
  // a guess about a format we do not control, and it failed the worst possible
  // way: `hasBrowserbaseApiKey()` gates the UI, so a key in any other shape
  // silently removed the Deep Scan button with no message anywhere. A guess
  // about formatting must never be able to disable a feature.
  //
  // A genuinely wrong key now fails loudly at the provider as a typed auth
  // error, which is both accurate and actionable.
  BROWSERBASE_API_KEY: z.string().min(1, "BROWSERBASE_API_KEY is required."),
  BROWSERBASE_PROJECT_ID: z.string().min(1).optional(),
});

export type BrowserbaseEnv = z.infer<typeof browserbaseEnvSchema>;

let cached: BrowserbaseEnv | undefined;

export function getBrowserbaseEnv(
  source: Record<string, string | undefined> = process.env,
): BrowserbaseEnv {
  if (cached) return cached;

  const result = browserbaseEnvSchema.safeParse({
    BROWSERBASE_API_KEY: source.BROWSERBASE_API_KEY,
    BROWSERBASE_PROJECT_ID: source.BROWSERBASE_PROJECT_ID,
  });

  if (!result.success) {
    // The message names the variable but never echoes its value — an invalid
    // key error must not leak the key into logs (ADR 0008).
    const issues = result.error.issues.map((issue) => `- ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid or missing Browserbase configuration:\n${issues}\n\nSee .env.example.`);
  }

  cached = result.data;
  return cached;
}

/** True when a usable key is configured, without throwing. Gates UI affordances. */
export function hasBrowserbaseApiKey(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return browserbaseEnvSchema.safeParse({
    BROWSERBASE_API_KEY: source.BROWSERBASE_API_KEY,
    BROWSERBASE_PROJECT_ID: source.BROWSERBASE_PROJECT_ID,
  }).success;
}

/** Test-only: clears the cached env so tests can exercise fresh parses. */
export function __resetBrowserbaseEnvCacheForTests(): void {
  cached = undefined;
}
