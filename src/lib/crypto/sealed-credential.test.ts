import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  openCredential,
  parseSealingKey,
  sealCredential,
  secretsMatch,
  type SealingKey,
} from "./sealed-credential";

/**
 * The properties that make storing a refresh token defensible (Sprint 12C §6, §49).
 *
 * This is the first long-lived third-party credential the codebase persists, so
 * the primitive holding it gets tested for the failures that actually matter
 * rather than for round-tripping. Three of them are silent by nature: an IV
 * reused across seals, a blob moved between rows, and a key rotated without the
 * envelope being able to say which key sealed what.
 */

const KEY_A: SealingKey = { version: "v1", key: randomBytes(32) };
const KEY_B: SealingKey = { version: "v2", key: randomBytes(32) };
const REFRESH_TOKEN = "1//0eXampleRefreshTokenMaterial-not-real";
const CONNECTION = "connection_abc";

describe("sealing and opening", () => {
  it("round-trips a credential under the right key and context", () => {
    const sealed = sealCredential({ plaintext: REFRESH_TOKEN, key: KEY_A, context: CONNECTION });

    expect(openCredential({ sealed: sealed.ciphertext, keys: [KEY_A], context: CONNECTION })).toEqual({
      ok: true,
      plaintext: REFRESH_TOKEN,
    });
  });

  it("never puts the plaintext in the envelope", () => {
    const sealed = sealCredential({ plaintext: REFRESH_TOKEN, key: KEY_A, context: CONNECTION });

    expect(sealed.ciphertext).not.toContain(REFRESH_TOKEN);
    expect(sealed.ciphertext).not.toContain("0eXample");
  });

  it("uses a fresh IV for every seal", () => {
    // The single most dangerous mistake available in GCM. Two messages sealed
    // under one IV and key leak their XOR *and* the authentication key, so a
    // deterministic or counter-derived IV would quietly destroy the whole
    // construction while every round-trip test stayed green.
    const seals = new Set(
      Array.from({ length: 50 }, () =>
        sealCredential({ plaintext: REFRESH_TOKEN, key: KEY_A, context: CONNECTION }).ciphertext,
      ),
    );

    expect(seals.size).toBe(50);
  });
});

describe("what must not open", () => {
  it("refuses a credential sealed for a different connection", () => {
    // Lifting row A's ciphertext into row B must fail rather than silently
    // authorizing the wrong project's Google account.
    const sealed = sealCredential({ plaintext: REFRESH_TOKEN, key: KEY_A, context: "connection_a" });

    expect(
      openCredential({ sealed: sealed.ciphertext, keys: [KEY_A], context: "connection_b" }),
    ).toEqual({ ok: false, error: "tampered" });
  });

  it("refuses a tampered ciphertext rather than returning garbage", () => {
    const sealed = sealCredential({ plaintext: REFRESH_TOKEN, key: KEY_A, context: CONNECTION });
    const parts = sealed.ciphertext.split(".");
    const body = Buffer.from(parts[4], "base64url");
    body[0] ^= 0xff;
    parts[4] = body.toString("base64url");

    expect(
      openCredential({ sealed: parts.join("."), keys: [KEY_A], context: CONNECTION }),
    ).toEqual({ ok: false, error: "tampered" });
  });

  it("refuses a wrong key by version rather than trying every key it holds", () => {
    // "Try them all and see which works" would turn a rotation mistake into a
    // silent success under the wrong key, with nobody any wiser.
    const sealed = sealCredential({ plaintext: REFRESH_TOKEN, key: KEY_A, context: CONNECTION });

    expect(
      openCredential({ sealed: sealed.ciphertext, keys: [KEY_B], context: CONNECTION }),
    ).toEqual({ ok: false, error: "wrong_key" });
  });

  it("refuses a malformed envelope", () => {
    for (const bad of ["", "nonsense", "scv1.v1.short", "wrong.v1.a.b.c"]) {
      expect(openCredential({ sealed: bad, keys: [KEY_A], context: CONNECTION }).ok).toBe(false);
    }
  });
});

describe("rotation", () => {
  it("opens old blobs while sealing new ones under the current key", () => {
    // The property that makes rotating a key possible without asking every
    // user to reconnect: the envelope names its key, and the opener may hold
    // several.
    const old = sealCredential({ plaintext: REFRESH_TOKEN, key: KEY_A, context: CONNECTION });
    const fresh = sealCredential({ plaintext: REFRESH_TOKEN, key: KEY_B, context: CONNECTION });

    for (const sealed of [old, fresh]) {
      expect(
        openCredential({ sealed: sealed.ciphertext, keys: [KEY_B, KEY_A], context: CONNECTION }),
      ).toEqual({ ok: true, plaintext: REFRESH_TOKEN });
    }

    expect(old.keyVersion).toBe("v1");
    expect(fresh.keyVersion).toBe("v2");
  });
});

describe("key parsing", () => {
  it("accepts exactly 32 decoded bytes", () => {
    const key = parseSealingKey({ version: "v1", material: randomBytes(32).toString("base64") });
    expect(key.key.length).toBe(32);
  });

  it("rejects a key of the wrong length, without echoing it", () => {
    // A hex-encoded key pasted into a base64 field decodes to the wrong length
    // and would otherwise produce a working cipher under a guessable key.
    const hexLooking = "a".repeat(64);

    expect(() => parseSealingKey({ version: "v1", material: hexLooking })).toThrowError(/32 bytes/);
    try {
      parseSealingKey({ version: "v1", material: hexLooking });
    } catch (error) {
      expect(String(error)).not.toContain(hexLooking);
    }
  });

  it("requires a version", () => {
    expect(() => parseSealingKey({ version: " ", material: randomBytes(32).toString("base64") }))
      .toThrowError(/version/);
  });
});

describe("refusals that prevent a useless seal", () => {
  it("will not seal an empty credential or an unbound one", () => {
    expect(() => sealCredential({ plaintext: "", key: KEY_A, context: CONNECTION })).toThrow();
    expect(() => sealCredential({ plaintext: REFRESH_TOKEN, key: KEY_A, context: "" })).toThrow();
  });
});

describe("constant-time comparison", () => {
  it("matches equal secrets and rejects unequal ones, including by length", () => {
    expect(secretsMatch("abc123", "abc123")).toBe(true);
    expect(secretsMatch("abc123", "abc124")).toBe(false);
    // A length mismatch must not throw out of the comparison — an escaping
    // throw would itself be a length oracle.
    expect(secretsMatch("abc", "abcdef")).toBe(false);
    expect(secretsMatch("", "")).toBe(true);
  });
});
