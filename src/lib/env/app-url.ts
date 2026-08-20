/**
 * Where this deployment lives, resolved once from the environment rather
 * than hardcoded anywhere (Sprint: Production Domain & Environment
 * Migration v1).
 *
 * ## The principle
 *
 * ```
 * Code -> Environment Configuration -> Development / Preview / Production URL
 * ```
 *
 * The environment decides; the code never guesses a domain and never bakes
 * one in. Three tiers, resolved in this order:
 *
 * 1. **`NEXT_PUBLIC_APP_URL`, if set** — an explicit, operator-chosen origin.
 *    This is how Production is configured: set it once, in Vercel's
 *    Production environment variables, to the custom domain, and every
 *    server-rendered URL (sitemap, robots, `metadataBase`, the Stripe
 *    return-URL fallback) uses it.
 * 2. **`VERCEL_URL`, if `NEXT_PUBLIC_APP_URL` is absent** — Vercel injects
 *    this automatically on every Preview (and Production) deployment, as a
 *    bare host with no protocol (`my-app-git-branch-team.vercel.app`).
 *    Deliberately **not** a second manually-configured "preview domain"
 *    variable: a Preview deployment gets a fresh, unique URL per branch and
 *    per commit, so a fixed value would be wrong for every deployment but
 *    the one it was copied from. Reading Vercel's own answer is the only
 *    version of "Preview" that is actually correct without being
 *    reconfigured on every branch.
 * 3. **`http://localhost:3000`, otherwise** — local development, where
 *    neither of the above is set.
 *
 * ## What this file is deliberately not
 *
 * Not a replacement for `VIBE_AGENT_GATEWAY_ORIGIN`
 * (`coding-agent/gateway-config.ts`). That value becomes a Vercel Sandbox's
 * entire egress allowlist, and `gateway-config.ts` already documents in
 * detail why it must stay an explicit, independently-configured value rather
 * than derived from anything — including this file. A security boundary and
 * a marketing/SEO origin are both "this deployment's URL" in the abstract,
 * but conflating them would mean a change made for SEO reasons could widen
 * (or silently narrow) what a sandbox is allowed to reach. They stay two
 * variables on purpose.
 *
 * Not validated the way `env.ts`'s Supabase variables are (`getPublicEnv`
 * throws when they are missing). A missing `NEXT_PUBLIC_APP_URL` is not a
 * configuration error here — it is exactly what an un-configured Preview or
 * local run looks like, and the fallback chain above is the correct answer
 * to it, not an exception to catch.
 */

export const APP_ENVIRONMENTS = ["development", "preview", "production"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export type AppUrlEnvSource = Record<string, string | undefined>;

const LOCAL_DEVELOPMENT_URL = "http://localhost:3000";

/** Strips a trailing slash so every caller can safely do `${appUrl()}/path`. */
function withoutTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * This deployment's origin — no trailing slash, always `http(s)://host`.
 *
 * Pure and synchronous: takes its environment explicitly (defaulting to
 * `process.env`) rather than caching, so a test can exercise all three tiers
 * in the same run without a reset function to remember to call.
 */
export function getAppUrl(source: AppUrlEnvSource = process.env): string {
  const explicit = source.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return withoutTrailingSlash(explicit);

  const vercelUrl = source.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}`;

  return LOCAL_DEVELOPMENT_URL;
}

/**
 * Which of the three tiers this deployment is running as.
 *
 * Reads Vercel's own `VERCEL_ENV` (`"production"` | `"preview"` |
 * `"development"`) when present — the same variable
 * `sentry.server.config.ts` / `sentry.edge.config.ts` already fall back to
 * for the Sentry `environment` tag, so this is a second, independent use of
 * a value already trusted for that purpose, not a new source of truth.
 * Absent it (any environment without Vercel's own runtime, e.g. local dev or
 * a non-Vercel CI run), `NEXT_PUBLIC_APP_URL` pointing at `localhost` — or
 * being unset entirely — reads as `development`; anything else configured
 * explicitly reads as `production`, since an operator who set a real URL by
 * hand did so to run production-like, not to be guessed at.
 */
export function getAppEnvironment(source: AppUrlEnvSource = process.env): AppEnvironment {
  const vercelEnv = source.VERCEL_ENV?.trim();
  if (vercelEnv === "production" || vercelEnv === "preview" || vercelEnv === "development") {
    return vercelEnv;
  }

  const url = getAppUrl(source);
  if (url === LOCAL_DEVELOPMENT_URL) return "development";
  return "production";
}
