import { getAppEnvironment, type AppUrlEnvSource } from "@/lib/env/app-url";

/**
 * Which build is serving, as a closed set of fields (VB-034).
 *
 * Separate from the route so the shape can be asserted without a request, and
 * so the decision about *what is public* lives in one place rather than being
 * re-made every time someone edits a handler.
 *
 * The type is the boundary: adding a field to the health response means
 * changing this type, which is a diff a reviewer sees. Spreading `process.env`
 * or a config object into a public response is the failure this shape exists
 * to make impossible.
 */
export type BuildIdentity = {
  /** The deployed commit, short form. Resolves to nothing outside the private repository. */
  commit: string | null;
  /** `production` | `preview` | `development` — the tier, never the hostname. */
  environment: string;
};

/** Vercel's own build variable, or the generic one a non-Vercel runner may set. */
function commitSha(env: AppUrlEnvSource): string | null {
  const sha = env.VERCEL_GIT_COMMIT_SHA ?? env.GIT_COMMIT_SHA;
  const trimmed = sha?.trim();
  if (!trimmed) return null;
  // Short form only. The full SHA says nothing more to anyone who can resolve
  // it, and less is the right default for a public response.
  return trimmed.slice(0, 7);
}

export function buildIdentity(env: AppUrlEnvSource = process.env): BuildIdentity {
  return { commit: commitSha(env), environment: getAppEnvironment(env) };
}
