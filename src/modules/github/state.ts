import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Anti-CSRF state for the GitHub connect flow (ADR 0009). Self-verifying —
 * no database table needed. Signed with GITHUB_APP_CLIENT_SECRET (an
 * existing App secret we already hold; not a new dedicated signing key,
 * see docs/sprints/0001-github-app-connection.md for that tradeoff).
 *
 * Binds the state to: an unpredictable nonce, the initiating Vibe Business
 * user's id, and an issue time checked against STATE_TTL_MS on verify.
 * Single-use is not independently enforced (no server-side nonce store) —
 * an accepted tradeoff documented in the sprint doc: replaying a state
 * alone cannot grant access, because the callback still independently
 * re-verifies GitHub installation ownership via the GitHub API before
 * anything is persisted.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

type StatePayload = {
  uid: string;
  nonce: string;
  iat: number;
};

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Creates a signed, expiring state value tied to `userId`. */
export function createConnectState(userId: string, secret: string): string {
  const payload: StatePayload = {
    uid: userId,
    nonce: base64url(randomBytes(18)),
    iat: Date.now(),
  };
  const encodedPayload = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export type VerifyStateResult =
  | { ok: true }
  | { ok: false; reason: "malformed" | "invalid_signature" | "expired" | "user_mismatch" };

/**
 * Verifies a state value produced by createConnectState. Checks signature
 * (constant-time comparison), expiry, and that it was issued for
 * `expectedUserId` — the currently authenticated Vibe Business user.
 */
export function verifyConnectState(
  state: string,
  secret: string,
  expectedUserId: string,
): VerifyStateResult {
  const parts = state.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [encodedPayload, signature] = parts;

  const expectedSignature = sign(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return { ok: false, reason: "invalid_signature" };
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (typeof payload.iat !== "number" || Date.now() - payload.iat > STATE_TTL_MS) {
    return { ok: false, reason: "expired" };
  }

  if (payload.uid !== expectedUserId) {
    return { ok: false, reason: "user_mismatch" };
  }

  return { ok: true };
}
