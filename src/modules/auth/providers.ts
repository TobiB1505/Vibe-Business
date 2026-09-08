/**
 * Which sign-in providers this deployment offers (UI-19).
 *
 * ## Why GitHub is behind a flag and Google is not
 *
 * Because Google is configured and GitHub is not yet. Enabling a provider is a
 * setting in the Supabase project — something this code cannot read — so a
 * "Continue with GitHub" button rendered unconditionally would be a control
 * that fails for a reason nobody on the screen can see or fix. The action
 * exists (`signInWithGithub`); the offer waits for the configuration.
 *
 * ## Why an environment variable is allowed here
 *
 * CLAUDE.md rule 78 forbids gating a customer capability on an environment
 * variable *nothing documents*, and both halves matter. This gates no
 * capability: everything Vibe does is reachable through the providers already
 * offered, and GitHub sign-in is a second door to the same room. And it is
 * documented, in `docs/deployment/environment.md`, which rule 83 makes a
 * current-state document that has to stay true.
 *
 * Turning it on is two steps, in this order: enable the GitHub provider in the
 * Supabase project with `<origin>/auth/callback` as the callback URL, then set
 * this variable. Doing them the other way round offers a button that cannot
 * work.
 */
export const GITHUB_AUTH_ENV = "VIBE_GITHUB_AUTH";

export function githubAuthEnabled(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return source[GITHUB_AUTH_ENV]?.trim() === "1";
}
