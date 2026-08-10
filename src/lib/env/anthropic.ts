import "server-only";

import { z } from "zod";

/**
 * Validated, server-only Anthropic configuration (ADR 0008).
 *
 * Guarded by `server-only` so an accidental import from a Client Component
 * fails the build rather than shipping an API key to a browser. The key is
 * deliberately *not* `NEXT_PUBLIC_` prefixed — see src/lib/env/README.md.
 *
 * Parsed lazily, only from a code path that is actually about to call the
 * provider, so `pnpm build`, `pnpm test` and CI all run without a real key.
 */

const anthropicEnvSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string()
    .min(1, "ANTHROPIC_API_KEY is required.")
    // A cheap shape check that catches a pasted placeholder before it
    // becomes a confusing 401 from the provider.
    .refine((key) => key.startsWith("sk-ant-"), {
      message: 'ANTHROPIC_API_KEY does not look like an Anthropic key (expected an "sk-ant-" prefix).',
    }),
});

export type AnthropicEnv = z.infer<typeof anthropicEnvSchema>;

let cached: AnthropicEnv | undefined;

export function getAnthropicEnv(source: Record<string, string | undefined> = process.env): AnthropicEnv {
  if (cached) return cached;

  const result = anthropicEnvSchema.safeParse({
    ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY,
  });

  if (!result.success) {
    // The message names the variable but never echoes its value — an
    // invalid-key error must not leak the key into logs (ADR 0008).
    const issues = result.error.issues.map((issue) => `- ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid or missing Anthropic configuration:\n${issues}\n\nSee .env.example.`);
  }

  cached = result.data;
  return cached;
}

/** True when a usable key is configured, without throwing. Used to gate UI affordances. */
export function hasAnthropicApiKey(source: Record<string, string | undefined> = process.env): boolean {
  return anthropicEnvSchema.safeParse({ ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY }).success;
}

/** Test-only: clears the cached env so tests can exercise fresh parses. */
export function __resetAnthropicEnvCacheForTests(): void {
  cached = undefined;
}
