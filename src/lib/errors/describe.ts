/**
 * A safe description of an unknown thrown value.
 *
 * Three orchestrators had written this byte for byte — validation, change
 * preview and review capture — each with its own three-line docblock giving
 * the same reason. Identical code carrying a security rationale is the shape
 * where one copy quietly stops matching the others.
 *
 * ## Why the name and the message, and not the object
 *
 * Provider errors carry request context, headers and occasionally credentials,
 * so the object is never stored. Its name and message are — which is the
 * difference between "we refuse to look" and "we cannot find out"
 * ([ADR 0015](../../../docs/decisions/0015-untrusted-repository-execution-provider.md) §9).
 *
 * ## What this does not bound
 *
 * The length. Every caller passes the result through its own sanitizer or
 * truncation before the string is stored or logged, because how much of a
 * failure is worth keeping is a decision each failure path makes. A caller
 * that skips that step reports an unbounded message, and this function will
 * not stop it.
 *
 * ## Where it does not apply
 *
 * A Supabase error. On postgrest-js's default path — no `throwOnError` — the
 * rejected value is the parsed body, a **plain object**, and only the throwing
 * path constructs a real `PostgrestError`. `instanceof Error` never matches
 * it, so this returns "non-error value thrown" for every database failure.
 * `operations/founder-input/server-writes.ts` records what that cost the one
 * time it was written this way: a guard that stops a resolution committing
 * against an unreleased Credit hold told the founder "try again", when waiting
 * was the only thing that worked. Read the property directly there.
 */
export function describeThrown(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "non-error value thrown";
}
