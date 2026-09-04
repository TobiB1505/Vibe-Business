/**
 * Who may open the operator console ([ADR 0088](../../../docs/decisions/0088-the-internal-operator-console.md) §1).
 *
 * ## Why an environment allowlist rather than a role
 *
 * The same reasoning `coding-agent/authorization.ts` already uses for the
 * dogfood allowlist, applied to a surface that reads every tenant's rows.
 *
 * A `role` column would be application state, and application state has a write
 * path — which is a way to grant yourself the console. A boolean feature flag
 * is one switch somebody can flip for everyone. An allowlist has to **name**
 * what it admits, so the blast radius of a mistake is one account rather than
 * the customer base, and nothing a customer can reach can write to it.
 *
 * ## Unset means nobody
 *
 * An absent or empty variable admits no one. A missing variable must never be
 * the permissive case for a surface that bypasses RLS — a deployment that
 * forgot to configure this shows the console to nobody, which is the failure
 * everyone can live with.
 */

const OPERATOR_ENV = "VIBE_INTERNAL_OPERATOR_USER_IDS";

/**
 * The user ids permitted to open the console.
 *
 * Comma-separated Supabase user ids. Absent, empty or all-whitespace means
 * nobody.
 */
export function internalOperatorUserIds(
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  const raw = env[OPERATOR_ENV];
  if (!raw) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Whether one verified user id is an operator.
 *
 * The id must come from a verified session — `getSession()` checks the JWT
 * signature — never from a cookie read, a header, or anything a caller sent.
 * A null id (signed out) is never an operator, stated rather than left to a
 * falsy comparison.
 */
export function isInternalOperator(
  userId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!userId) return false;
  return internalOperatorUserIds(env).includes(userId);
}
