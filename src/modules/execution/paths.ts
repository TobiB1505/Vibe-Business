import type { ExecutionCapability } from "./schema";

/**
 * Where a capability is allowed to write (Sprint 9 §13, §32).
 *
 * The rule this file exists to make unbreakable: **a repository path may only
 * ever be produced by capability code.** Never from an opportunity's title,
 * problem, whyNow, evidence text, or any other model output — those are
 * untrusted strings that happen to look like English, and one of them being
 * used as a path is the difference between writing `src/app/robots.ts` and
 * writing `.github/workflows/deploy.yml`.
 *
 * Two independent defences, because one is a policy and the other is a proof:
 *
 *  1. the generator composes paths from a resolved app root plus fixed
 *     basenames, so no caller-supplied string reaches a path at all;
 *  2. every path is checked against the allowlist below before it is written,
 *     so a future capability that forgets rule 1 still cannot escape.
 */

/** Exact basenames a capability may create, per capability. */
const CAPABILITY_BASENAMES: Record<ExecutionCapability, readonly string[]> = {
  nextjs_seo_foundations_v1: ["robots.ts", "sitemap.ts"],
  // v2 refined *what the sitemap lists*, not which files exist. The capability
  // scope is unchanged: two files, same names, same places.
  nextjs_seo_foundations_v2: ["robots.ts", "sitemap.ts"],
};

/**
 * Never written by any capability, now or later.
 *
 * These are the paths where a mistake stops being a bad commit and becomes a
 * security incident: CI can execute, env files carry secrets, manifests and
 * lockfiles control what code runs, and migrations change data.
 */
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.github\//i,
  /(^|\/)\.env/i,
  /(^|\/)package(-lock)?\.json$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)pnpm-workspace\.yaml$/i,
  /(^|\/)supabase\//i,
  /(^|\/)vercel\.json$/i,
  /(^|\/)next\.config\./i,
  /(^|\/)middleware\./i,
  /(^|\/)proxy\./i,
];

export type PathRejection =
  | "not_relative"
  | "path_traversal"
  | "forbidden_location"
  | "not_allowed_for_capability";

export type PathCheck = { ok: true } | { ok: false; reason: PathRejection };

/**
 * Is this path one the capability may create?
 *
 * Deliberately strict about shape before it is strict about location: an
 * absolute path, a `..` segment or a backslash is rejected outright rather
 * than normalized, because normalizing attacker-shaped input is how
 * normalization bugs become traversal bugs.
 */
export function checkWritePath(path: string, capability: ExecutionCapability): PathCheck {
  if (path.startsWith("/") || path.includes("\\") || /^[a-zA-Z]:/.test(path)) {
    return { ok: false, reason: "not_relative" };
  }

  const segments = path.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "")) {
    return { ok: false, reason: "path_traversal" };
  }

  if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(path))) {
    return { ok: false, reason: "forbidden_location" };
  }

  const basename = segments[segments.length - 1];
  if (!CAPABILITY_BASENAMES[capability].includes(basename)) {
    return { ok: false, reason: "not_allowed_for_capability" };
  }

  // The app root the generator composes with is resolved from repository
  // intelligence and always ends in `app/`. Requiring it here means a
  // capability cannot write its allowed basenames just anywhere.
  if (!/(^|\/)app\/[^/]+$/.test(path)) {
    return { ok: false, reason: "forbidden_location" };
  }

  return { ok: true };
}

/** Every path must pass. One rejection fails the whole change. */
export function checkWritePaths(
  paths: string[],
  capability: ExecutionCapability,
): { ok: true } | { ok: false; path: string; reason: PathRejection } {
  for (const path of paths) {
    const result = checkWritePath(path, capability);
    if (!result.ok) return { ok: false, path, reason: result.reason };
  }
  return { ok: true };
}
