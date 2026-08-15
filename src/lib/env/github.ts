import "server-only";

import { z } from "zod";

/**
 * Validated, server-only GitHub App configuration. Guarded by `server-only`
 * per the pattern documented in src/lib/env/README.md — these are secrets
 * (client ID excepted, but kept here since it only ever appears in
 * server-initiated requests) and must never be importable from a Client
 * Component. See ADR 0008 (secrets management) and ADR 0003 (GitHub App).
 */

const githubEnvSchema = z.object({
  GITHUB_APP_ID: z.string().min(1, "GITHUB_APP_ID is required."),
  GITHUB_APP_SLUG: z.string().min(1, "GITHUB_APP_SLUG is required."),
  GITHUB_APP_CLIENT_ID: z.string().min(1, "GITHUB_APP_CLIENT_ID is required."),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1, "GITHUB_APP_CLIENT_SECRET is required."),
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .min(1, "GITHUB_APP_PRIVATE_KEY is required.")
    .transform(normalizePrivateKey)
    .refine((key) => key.includes("BEGIN") && key.includes("PRIVATE KEY"), {
      message: "GITHUB_APP_PRIVATE_KEY does not look like a PEM private key.",
    })
    /**
     * The BEGIN check alone passes on a key that is only its first line, which
     * is exactly what a multiline PEM pasted into a `.env` file *without
     * surrounding quotes* produces: the parser keeps `-----BEGIN RSA PRIVATE
     * KEY-----` and drops the other 26 lines.
     *
     * That configuration then validates, and fails much later as an opaque
     * GitHub error with no indication that the key was the problem. Requiring
     * the footer turns a silent runtime failure into a startup message that
     * names the actual mistake.
     */
    .refine((key) => key.includes("END") && /END[^\n]*PRIVATE KEY/.test(key), {
      message:
        "GITHUB_APP_PRIVATE_KEY is missing its END line — the value looks truncated. " +
        "A multiline PEM must be wrapped in double quotes in a .env file, or written " +
        "on one line with literal \\n escapes. See .env.example.",
    }),
});

export type GithubEnv = z.infer<typeof githubEnvSchema>;

/**
 * Supports two ways of storing a multiline PEM key in a single-line env var:
 * literal `\n` escape sequences (the common `.env` file convention — see
 * .env.example) or real newlines (Vercel's environment variable UI supports
 * multiline values natively). Real newlines pass through unchanged.
 */
function normalizePrivateKey(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

let cached: GithubEnv | undefined;

/**
 * Parses and validates GitHub App configuration on first use. Throws a
 * descriptive error immediately if configuration is missing or invalid —
 * called lazily, only from code paths that actually perform a GitHub
 * operation, so a normal build/CI run never needs real GitHub credentials.
 */
export function getGithubEnv(source: Record<string, string | undefined> = process.env): GithubEnv {
  if (cached) return cached;

  const result = githubEnvSchema.safeParse({
    GITHUB_APP_ID: source.GITHUB_APP_ID,
    GITHUB_APP_SLUG: source.GITHUB_APP_SLUG,
    GITHUB_APP_CLIENT_ID: source.GITHUB_APP_CLIENT_ID,
    GITHUB_APP_CLIENT_SECRET: source.GITHUB_APP_CLIENT_SECRET,
    GITHUB_APP_PRIVATE_KEY: source.GITHUB_APP_PRIVATE_KEY,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid or missing GitHub App configuration:\n${issues}\n\nSee .env.example and docs/setup/github-app.md.`,
    );
  }

  cached = result.data;
  return cached;
}

/** Test-only: clears the cached env so tests can exercise fresh parses. */
export function __resetGithubEnvCacheForTests(): void {
  cached = undefined;
}
