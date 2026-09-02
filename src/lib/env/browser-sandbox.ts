import "server-only";

import { z } from "zod";

/**
 * Validated, server-only browser-sandbox configuration (ADR 0076).
 *
 * One value: the key the two per-session capability tokens are derived from.
 * It is never sent anywhere — not to the sandbox, not to a browser, not into a
 * database. Only the values derived *from* it travel, and each of those opens
 * exactly one channel of one VM for that VM's lifetime.
 *
 * Guarded by `server-only` so an accidental import from a Client Component
 * fails the build rather than shipping the key that guards every live browser
 * session. Deliberately not `NEXT_PUBLIC_` prefixed.
 *
 * Parsed lazily, only from a path about to open or reconnect a session, so
 * `pnpm build`, `pnpm test` and CI all run without a real secret.
 *
 * ## Why the minimum is 32 characters
 *
 * Not a format guess. The deleted `browserbase.ts` recorded what one cost this
 * repository — a `bb_` prefix check that silently removed the Deep Scan button
 * for a key in any other shape — and `anthropic.ts` still carries the lesson.
 * This is a length floor on a value whose only job is to be unguessable, and a
 * short one is the single way this scheme fails quietly: every token stays
 * well-formed and the whole set becomes searchable.
 */
const browserSandboxEnvSchema = z.object({
  VIBE_BROWSER_SESSION_SECRET: z
    .string()
    .min(32, "VIBE_BROWSER_SESSION_SECRET must be at least 32 characters."),
});

export type BrowserSandboxEnv = z.infer<typeof browserSandboxEnvSchema>;

let cached: BrowserSandboxEnv | undefined;

/**
 * @param source defaults to the process environment.
 *
 * The cache applies **only** to that default. A caller that names a source is
 * asking about that source, and answering from a value parsed out of a
 * different one is how a seam stops being a seam: the first successful parse
 * would pin the answer for every later call, including the ones written to
 * prove a bad configuration is refused.
 */
export function getBrowserSandboxEnv(
  source: Record<string, string | undefined> = process.env,
): BrowserSandboxEnv {
  const fromProcessEnv = source === process.env;
  if (fromProcessEnv && cached) return cached;

  const result = browserSandboxEnvSchema.safeParse({
    VIBE_BROWSER_SESSION_SECRET: source.VIBE_BROWSER_SESSION_SECRET,
  });

  if (!result.success) {
    // Names the variable, never echoes the value — the same rule as every other
    // env module here (ADR 0008).
    const issues = result.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid or missing browser sandbox configuration:\n${issues}\n\nSee .env.example.`);
  }

  if (fromProcessEnv) cached = result.data;
  return result.data;
}

/** True when a usable secret is configured, without throwing. Gates UI affordances. */
export function hasBrowserSandboxSecret(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return browserSandboxEnvSchema.safeParse({
    VIBE_BROWSER_SESSION_SECRET: source.VIBE_BROWSER_SESSION_SECRET,
  }).success;
}

/** Test seam. The cache exists so a hot path does not re-parse on every session. */
export function resetBrowserSandboxEnvCache(): void {
  cached = undefined;
}
