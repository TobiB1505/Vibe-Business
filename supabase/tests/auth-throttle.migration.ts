import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * VB-010 — one account cannot be guessed at indefinitely.
 *
 * The finding's own verification is "scripted brute-force throttled per
 * account", so that is what the central test does: it runs the attempts rather
 * than asserting the arithmetic that ought to bound them.
 *
 * It has to be real PostgreSQL. The whole mechanism is one `SECURITY DEFINER`
 * function doing an upsert with a windowed counter, and `FakeDatabase` models
 * neither `on conflict do update` against a moving clock nor the privilege
 * boundary that makes the function the only way in.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;
let counter = 0;

function hashOf(identifier: string): string {
  return createHash("sha256").update(identifier.trim().toLowerCase(), "utf8").digest("hex");
}

/** A distinct account per test, so windows never leak between them. */
function account(): string {
  counter += 1;
  return hashOf(`throttle-${counter}@fixture.test`);
}

/** `[allowed, retryAfterSeconds]` from one call. */
function attempt(hash: string, succeeded: boolean | null): [boolean, number] {
  const value = succeeded === null ? "null" : String(succeeded);
  const row = db.sql(
    `select allowed::text || '|' || retry_after_seconds::text` +
      ` from public.record_auth_attempt('${hash}', ${value});`,
  );
  const [allowed, retry] = row.split("|");
  return [allowed === "true", Number(retry)];
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);
}, 300_000);

afterAll(() => db?.stop());

describe("a scripted brute force", () => {
  it("is refused once the window's allowance is spent", () => {
    const hash = account();

    // The default allowance is eight failures in fifteen minutes.
    for (let i = 0; i < 7; i += 1) {
      expect(attempt(hash, false)[0]).toBe(true);
    }

    const [allowedOnEighth, retryAfter] = attempt(hash, false);
    expect(allowedOnEighth).toBe(false);
    expect(retryAfter).toBeGreaterThan(0);

    // And it stays refused without further failures being needed.
    expect(attempt(hash, null)[0]).toBe(false);
  });

  it("bounds one account without touching another", () => {
    const victim = account();
    const bystander = account();

    for (let i = 0; i < 8; i += 1) attempt(victim, false);

    expect(attempt(victim, null)[0]).toBe(false);
    expect(attempt(bystander, null)[0]).toBe(true);
  });
});

describe("what it must not break", () => {
  it("allows an untouched account", () => {
    expect(attempt(account(), null)).toEqual([true, 0]);
  });

  /**
   * A customer who mistypes twice and then signs in correctly must not carry
   * that history — holding a grudge is a support ticket, not a control.
   */
  it("clears the window on a success", () => {
    const hash = account();

    for (let i = 0; i < 5; i += 1) attempt(hash, false);
    attempt(hash, true);

    expect(db.sql(`select count(*) from public.auth_attempt_windows where identifier_hash = '${hash}';`)).toBe(
      "0",
    );
    expect(attempt(hash, null)[0]).toBe(true);
  });
});

describe("the boundary around it", () => {
  it("stores a hash and never an address", () => {
    const hash = account();
    attempt(hash, false);

    const stored = db.sql(`select identifier_hash from public.auth_attempt_windows where identifier_hash = '${hash}';`);
    expect(stored).toBe(hash);
    expect(stored).not.toContain("@");
  });

  it("refuses an identifier that is not a sha-256", () => {
    // The failure mode this guards: a caller passing the address itself, which
    // would put a register of e-mail addresses in the table.
    const error = db.sqlExpectingError(`select * from public.record_auth_attempt('someone@example.com', false);`);
    expect(error).toContain("sha-256");
  });

  it("is not readable by anon or authenticated, only callable", () => {
    for (const role of ["anon", "authenticated"]) {
      const error = db.sqlExpectingError(
        `begin; set local role ${role}; select count(*) from public.auth_attempt_windows; commit;`,
      );
      expect(error).toMatch(/permission denied/i);
    }

    // ...and the function itself is reachable, or sign-in could not use it.
    for (const role of ["anon", "authenticated"]) {
      db.sql(
        `begin; set local role ${role};` +
          ` select * from public.record_auth_attempt('${account()}', null); commit;`,
      );
    }
  });
});
