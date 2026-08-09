import { z } from "zod";

/**
 * Validated environment access.
 *
 * Only NEXT_PUBLIC_-prefixed variables are validated here, because they are
 * safe to read from both server and client code by definition (Next.js
 * inlines them into the client bundle). Sprint 0 introduces no server-only
 * secrets (see ADR 0002, ADR 0008) — nothing in this sprint's code paths
 * needs SUPABASE_SERVICE_ROLE_KEY or similar.
 *
 * When a server-only secret is introduced (GitHub App private key, Anthropic
 * API key, service role key, webhook secrets, ...), it must be validated in
 * a separate module guarded by `import "server-only"` at the top, never
 * added to this file. See CLAUDE.md rule 18-19 and ADR 0008.
 */

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .url({ message: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL." })
    .min(1, "NEXT_PUBLIC_SUPABASE_URL is required."),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required."),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cached: PublicEnv | undefined;

/**
 * Parses and validates the public environment on first use, then caches
 * the result. Throws a descriptive error immediately if configuration is
 * missing or invalid, rather than letting the app start with `undefined`
 * values that fail confusingly later.
 */
export function getPublicEnv(source: Record<string, string | undefined> = process.env): PublicEnv {
  if (cached) return cached;

  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid or missing environment configuration:\n${issues}\n\nSee .env.example for the required variables.`,
    );
  }

  cached = result.data;
  return cached;
}

/** Test-only: clears the cached env so tests can exercise fresh parses. */
export function __resetPublicEnvCacheForTests(): void {
  cached = undefined;
}
