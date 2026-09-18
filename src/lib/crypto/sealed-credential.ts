import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Authenticated encryption for stored third-party credentials (Sprint 12C §6).
 *
 * ## Why this module exists at all
 *
 * Because Vibe has never stored a long-lived third-party credential, and that
 * was a deliberate posture rather than an accident. The GitHub App mints
 * short-lived installation tokens from a private key it never persists. Deep
 * Scan refuses to keep `storageState` or cookies (ADR 0012) — the user signs in
 * to a temporary browser and the browser is destroyed.
 *
 * A Google refresh token breaks that pattern, and it has to: business
 * measurement runs days or weeks after the user closes the tab, so a credential
 * that only works while they are present cannot answer the question the
 * measurement engine exists to ask (§5).
 *
 * So this is the smallest primitive that makes storing one defensible, and
 * nothing else in the codebase should acquire the habit without the same
 * argument.
 *
 * ## The construction, and why each part
 *
 * **AES-256-GCM.** Authenticated encryption, so a tampered ciphertext fails to
 * open rather than decrypting to something attacker-chosen. A bare AES-CBC
 * blob with no MAC is the classic version of this mistake.
 *
 * **A fresh 96-bit IV per seal.** Never derived, never counted, never reused.
 * GCM's security collapses entirely on IV reuse under the same key — two
 * messages sealed with one IV leak their XOR and, worse, the authentication
 * key. `randomBytes` per call is the only rule that matters here.
 *
 * **Additional authenticated data.** The connection id is bound into the
 * authentication tag without being encrypted, so a sealed credential cannot be
 * *moved*: lifting row A's ciphertext into row B makes it fail to open rather
 * than silently authorizing the wrong project's Google account.
 *
 * **A key version in the envelope.** Rotation is a fact of life for a secret
 * that lives in an environment variable, and a stored blob that cannot say
 * which key sealed it can only be rotated by asking every user to reconnect.
 *
 * ## What this is not
 *
 * Not a general encryption utility, and deliberately not exported as one. It
 * seals one shape of thing — a provider refresh credential — and the narrow
 * surface is what keeps it reviewable.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The envelope version, distinct from the *key* version.
 *
 * Bumped if the construction itself changes — a different cipher, a different
 * AAD binding. A stored blob must never be reinterpreted under rules it was not
 * sealed with, which is the same discipline the validation and review policies
 * follow.
 */
export const SEALED_CREDENTIAL_ENVELOPE = "scv1" as const;

export type SealedCredential = {
  /** `scv1.<keyVersion>.<iv>.<tag>.<ciphertext>`, all base64url. */
  ciphertext: string;
  /** Which key sealed it. Stored beside the blob so rotation is possible. */
  keyVersion: string;
};

export type SealingKey = {
  version: string;
  key: Buffer;
};

/**
 * Parses a key from its environment representation.
 *
 * Base64, exactly 32 bytes decoded. Both checks matter: a hex-encoded 64-char
 * key would decode to 48 bytes of nonsense under base64 and produce a working
 * cipher with an attacker-guessable key, which is precisely the kind of failure
 * that never announces itself.
 */
export function parseSealingKey(params: { version: string; material: string }): SealingKey {
  const key = Buffer.from(params.material, "base64");

  if (key.length !== KEY_BYTES) {
    // Deliberately does not echo the value, the decoded length being the only
    // safe diagnostic.
    throw new Error(
      `Credential sealing key must decode to ${KEY_BYTES} bytes; got ${key.length}.`,
    );
  }
  if (!params.version.trim()) throw new Error("Credential sealing key needs a version.");

  return { version: params.version, key };
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

/**
 * Seals a credential so only a holder of the key can read it.
 *
 * `context` is authenticated but not encrypted: it binds the blob to the row it
 * belongs to. Pass something the row cannot change — the connection id — never
 * something a client supplies.
 */
export function sealCredential(params: {
  plaintext: string;
  key: SealingKey;
  context: string;
}): SealedCredential {
  if (!params.plaintext) throw new Error("Refusing to seal an empty credential.");
  if (!params.context) throw new Error("Refusing to seal without a binding context.");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, params.key.key, iv);
  cipher.setAAD(Buffer.from(params.context, "utf8"));

  const sealed = Buffer.concat([cipher.update(params.plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: [
      SEALED_CREDENTIAL_ENVELOPE,
      params.key.version,
      encode(iv),
      encode(tag),
      encode(sealed),
    ].join("."),
    keyVersion: params.key.version,
  };
}

export type OpenResult =
  | { ok: true; plaintext: string }
  /**
   * Why it could not be opened.
   *
   * `wrong_key` and `tampered` are deliberately separate: the first is an
   * operational situation with a remedy (rotate forward, or restore the old
   * key), the second is a security event. Collapsing them would hide the second
   * inside the first.
   */
  | { ok: false; error: "malformed" | "wrong_key" | "tampered" };

/**
 * Opens a sealed credential, or says why not.
 *
 * Returns a result rather than throwing, because every caller has to handle
 * failure anyway — a connection whose credential will not open is
 * `reconnect_required`, not a 500.
 */
export function openCredential(params: {
  sealed: string;
  keys: SealingKey[];
  context: string;
}): OpenResult {
  const parts = params.sealed.split(".");
  if (parts.length !== 5) return { ok: false, error: "malformed" };

  const [envelope, keyVersion, ivPart, tagPart, bodyPart] = parts;
  if (envelope !== SEALED_CREDENTIAL_ENVELOPE) return { ok: false, error: "malformed" };

  // Constant-time version comparison is not required — a key *version* is not a
  // secret — but the key lookup must not fall back to "try them all and see",
  // which would turn a rotation mistake into a silent success under the wrong
  // key and leave nobody any wiser.
  const key = params.keys.find((candidate) => candidate.version === keyVersion);
  if (!key) return { ok: false, error: "wrong_key" };

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const body = Buffer.from(bodyPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return { ok: false, error: "malformed" };

  try {
    const decipher = createDecipheriv(ALGORITHM, key.key, iv);
    decipher.setAAD(Buffer.from(params.context, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    return { ok: true, plaintext };
  } catch {
    // GCM's tag check failed: either the ciphertext was altered, or it was
    // sealed against a different context — a blob lifted from another row.
    // Both are the same answer to a caller and both are security-relevant.
    return { ok: false, error: "tampered" };
  }
}

/**
 * Whether two credential strings are equal, without leaking where they differ.
 *
 * Used for the OAuth state comparison rather than the credential itself, and
 * kept here because it is the same class of mistake: `===` on a secret is a
 * timing oracle, and the fix belongs next to the other cryptographic
 * primitives rather than inlined at a call site where it can be "simplified"
 * back.
 */
export function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  // `timingSafeEqual` throws on length mismatch, which would itself be a
  // length oracle if the throw escaped. Comparing lengths first and returning
  // the same shape keeps the caller's branching uniform.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
