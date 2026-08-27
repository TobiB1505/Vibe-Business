import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-account sign-in throttling (VB-010).
 *
 * Supabase Auth limits by IP, and Vibe runs behind a shared Vercel egress
 * pool — so one attacker's attempts against one account arrive mixed into
 * everyone else's traffic and the limit stops meaning "this account is under
 * attack". This bounds guessing at a single account, which is the gap.
 *
 * All the state and all the arithmetic live in `record_auth_attempt`, a single
 * `SECURITY DEFINER` function. Sign-in happens before there is a session, so
 * the caller is `anon`, which holds no privilege on any table — this design
 * works with that rather than around it.
 *
 * ## It fails open, on purpose
 *
 * If the database cannot answer, sign-in proceeds. That is the wrong default
 * for a primary access control and the right one here: this sits *on top of*
 * Supabase's own limits and its own password check, so failing open degrades
 * to the protection that existed before this file. Failing closed would turn a
 * database blip into "nobody can sign in", which is a worse outcome than the
 * one this is defending against.
 */

/** The address never reaches the database — see the migration's docblock. */
export function identifierHash(identifier: string): string {
  return createHash("sha256").update(identifier.trim().toLowerCase(), "utf8").digest("hex");
}

export type ThrottleDecision = {
  allowed: boolean;
  /** Seconds until the next attempt is permitted. Zero when allowed. */
  retryAfterSeconds: number;
};

const ALLOWED: ThrottleDecision = { allowed: true, retryAfterSeconds: 0 };

/**
 * Records one sign-in outcome, or reports the current state without recording.
 *
 * Recording and deciding are one statement so a caller cannot act on state
 * that changed underneath it. The pre-check (`succeeded: null`) is a read and
 * can in principle be raced by a concurrent attempt — worth one extra try
 * against a bound of eight, and worth far less than letting every attempt
 * reach the auth provider.
 */
export async function recordAuthAttempt(
  supabase: SupabaseClient,
  params: {
    identifier: string;
    /** `null` reports the current state and records nothing — the pre-check. */
    succeeded: boolean | null;
  },
): Promise<ThrottleDecision> {
  // Every failure path returns ALLOWED, including a thrown one. "Fails open"
  // has to mean *any* failure, not just the ones the client reports as an
  // error object — an exception here would otherwise take sign-in down, which
  // is the outcome this design says it will not cause.
  let data: unknown;
  try {
    const result = await supabase.rpc("record_auth_attempt", {
      p_identifier_hash: identifierHash(params.identifier),
      p_succeeded: params.succeeded,
    });
    if (result.error) return ALLOWED;
    data = result.data;
  } catch {
    return ALLOWED;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return ALLOWED;

  const decision = row as { allowed?: unknown; retry_after_seconds?: unknown };
  if (typeof decision.allowed !== "boolean") return ALLOWED;

  return {
    allowed: decision.allowed,
    retryAfterSeconds:
      typeof decision.retry_after_seconds === "number" ? decision.retry_after_seconds : 0,
  };
}

/**
 * What a throttled caller is told.
 *
 * Deliberately the same shape as a wrong password, and deliberately vague
 * about the account: "too many attempts for this account" would confirm the
 * account exists, which is the enumeration this repository's neutral
 * password-reset copy already avoids.
 */
export function throttleMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
