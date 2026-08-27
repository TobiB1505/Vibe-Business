/**
 * Is this string a UUID (VB-028)?
 *
 * Route parameters arrive as strings and go straight into `.eq("id", …)`.
 * PostgreSQL answers a malformed one with `22P02 invalid input syntax for type
 * uuid`, the store throws it, and the request becomes a 500 — so
 * `/app/projects/x` returned a server error where it should have returned
 * "no such project".
 *
 * That is worse than untidy. A 500 is Vibe saying *it* broke, so it pages
 * whoever is watching, fills the error tracker with traffic anyone can
 * generate by typing, and hides real failures among the noise.
 *
 * ## Why a shape check and not a cast
 *
 * This answers one question — is this string shaped like a UUID — and nothing
 * else. It says nothing about whether the row exists or whether the caller may
 * see it; those are still the query's job and the policy's job. Callers turn
 * `false` into the same `notFound()` a real miss produces, because from
 * outside there is no difference worth exposing: an id that cannot exist and
 * an id that does not exist are both "not here".
 *
 * Accepts any RFC 4122 version and both cases, because the question is whether
 * PostgreSQL will accept the literal, not which generator produced it.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
