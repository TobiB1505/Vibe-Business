import "server-only";

import { z } from "zod";

/**
 * The Supabase service-role key (Sprint 7, ADR 0013).
 *
 * Sprint 0 and Sprint 1 both recorded a deliberate decision *not* to introduce
 * this key: every request-scoped query runs as the signed-in user, so RLS is
 * always in force and there is nothing to bypass.
 *
 * Durable execution ends that. A workflow step runs in its own function
 * invocation, minutes after the browser request returned, with no cookies and
 * no user session. The two alternatives were both worse:
 *
 *  - putting the user's access token into workflow state — persisting a
 *    credential into a third-party durable log, which Sprint 7 §14/§31
 *    explicitly forbid, and which expires mid-run anyway;
 *  - minting user-impersonating JWTs from the project's signing secret —
 *    strictly more dangerous than a service key, since it forges identity.
 *
 * So the key exists, and the protection it removes is re-added in code:
 * `src/lib/supabase/service.ts` documents the rules, and every query made with
 * it carries an explicit `project_id`/`user_id` predicate taken from the
 * operation row rather than from anything a caller supplied.
 *
 * Parsed lazily, so `pnpm build`, `pnpm test` and CI never need it.
 */

const supabaseServiceEnvSchema = z.object({
  // Presence only — a format guess must never be able to disable a feature
  // (see src/lib/env/anthropic.ts for what that costs).
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required."),
});

export type SupabaseServiceEnv = z.infer<typeof supabaseServiceEnvSchema>;

let cached: SupabaseServiceEnv | undefined;

export function getSupabaseServiceEnv(
  source: Record<string, string | undefined> = process.env,
): SupabaseServiceEnv {
  if (cached) return cached;

  const result = supabaseServiceEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!result.success) {
    // Names the variable, never echoes its value.
    const issues = result.error.issues.map((issue) => `- ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid or missing Supabase service configuration:\n${issues}\n\nSee .env.example.`);
  }

  cached = result.data;
  return cached;
}
