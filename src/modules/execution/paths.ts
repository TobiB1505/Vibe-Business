import { isForbiddenExecutionPath } from "@/modules/execution-contract/policy";
import {
  AGENTIC_EXECUTION_CAPABILITY,
  isAgenticCapability,
  type AgenticExecutionCapability,
  type ExecutionCapability,
} from "./schema";

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

/**
 * Exact basenames a *deterministic* capability may create.
 *
 * A generator knows every file it emits before it runs, so an exact allowlist
 * is the honest description of its scope — and the strictest rule available.
 *
 * Agentic execution is deliberately absent, and cannot be added: an agent
 * cannot know which files a step needs before it has read the repository, so a
 * predicted basename list would be either wrong or so broad it says nothing.
 * Its scope is expressed as *classes it may never touch* instead — see
 * {@link checkWritePath}.
 */
const CAPABILITY_BASENAMES: Record<
  // Both agentic capabilities are excluded: neither writes a fixed set of
  // basenames, which is the whole difference between a generator and an agent.
  Exclude<ExecutionCapability, AgenticExecutionCapability>,
  readonly string[]
> = {
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

  /*
   * Agentic execution (EXECUTION CORE-4 §28, §30).
   *
   * The shape checks and `FORBIDDEN_PATTERNS` above already ran, and they are
   * the substance of the rule: an agent may not touch CI, env files, manifests,
   * lockfiles, workspace configuration, migrations, `vercel.json`, the Next.js
   * config, middleware or the proxy. Those are the paths where a bad edit stops
   * being a bad commit and becomes a privilege escalation, a supply-chain
   * change or a data migration.
   *
   * `isForbiddenExecutionPath` is applied on top, so the credential and git
   * classes Core-3 defined are refused here too — one policy, checked in both
   * the tool gateway (at write time) and here (immediately before the branch is
   * written), which is the same two-independent-refusals discipline this file
   * already documents.
   *
   * What is deliberately *not* required is a basename or a directory. The whole
   * point of agentic execution is that Vibe does not know in advance which file
   * a customer's individual product needs changed (§3), and a scope that
   * pretended otherwise would either block real work or be a name for nothing.
   * Blast radius is bounded by count and bytes instead — `checkWriteScope`.
   */
  // Both agentic capabilities, not only the current one: a v1 change still on a
  // branch is re-checked under the same rule it was written under, and the rule
  // did not change — ADR 0073 widened what may be *removed*, and a removal goes
  // through this same call.
  if (isAgenticCapability(capability)) {
    return isForbiddenExecutionPath(path) ? { ok: false, reason: "forbidden_location" } : { ok: true };
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

/**
 * The write-path rule an agent's tool gateway applies, by the same code.
 *
 * Exported so the gateway refuses a forbidden write *at the moment the agent
 * asks*, rather than letting it discover at the end that everything it did was
 * out of scope. Same predicate, two moments — the second one, immediately
 * before the branch is written, is the control.
 */
export function isAgenticWritablePath(path: string): boolean {
  return checkWritePath(path, AGENTIC_EXECUTION_CAPABILITY).ok;
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
