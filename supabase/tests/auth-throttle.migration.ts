import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * VB-010 — one account cannot be guessed at indefinitely, and the control
 * cannot be talked out of by the party it is bounding.
 *
 * The finding's own verification is "scripted brute-force throttled per
 * account", so that is what the first block does: it runs the attempts rather
 * than asserting the arithmetic that ought to bound them.
 *
 * The second block is the one the first version of this file did not have, and
 * the omission was the defect. Every test here asked whether the mechanism
 * *works*; none asked what a hostile caller can do with it — and the function
 * is granted to `anon`, so the hostile caller needs nothing but the publishable
 * key to reach it.
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

type Account = { email: string; hash: string };

/** A distinct account per test, so windows never leak between them. */
function account(): Account {
  counter += 1;
  const email = `throttle-${counter}@fixture.test`;
  return { email, hash: hashOf(email) };
}

/** `[allowed, retryAfterSeconds]` from one call, made by nobody in particular. */
function attempt(target: Account, succeeded: boolean | null): [boolean, number] {
  return callAs(null, target, succeeded);
}

/**
 * One call made *as* a given signed-in identity — or as nobody, when
 * `signedInAs` is null.
 *
 * The claim is set the way PostgREST sets it, because that is the only thing
 * the function will read: an attacker controls the arguments completely and
 * the token not at all, which is the entire point of the repair.
 */
function callAs(
  signedInAs: Account | null,
  target: Account,
  succeeded: boolean | null,
): [boolean, number] {
  const value = succeeded === null ? "null" : String(succeeded);
  const claim = signedInAs
    ? `select set_config('request.jwt.claim.email', '${signedInAs.email}', true);`
    : "";
  const row = db.sqlLast(
    `begin;${claim}` +
      ` select allowed::text || '|' || retry_after_seconds::text` +
      ` from public.record_auth_attempt('${target.hash}', ${value}); commit;`,
  );
  const [allowed, retry] = row.split("|");
  return [allowed === "true", Number(retry)];
}

function windowRows(target: Account): string {
  return db.sql(
    `select count(*) from public.auth_attempt_windows where identifier_hash = '${target.hash}';`,
  );
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);
}, 300_000);

afterAll(() => db?.stop());

describe("a scripted brute force", () => {
  it("is refused once the window's allowance is spent", () => {
    const target = account();

    // The allowance is eight failures in fifteen minutes.
    for (let i = 0; i < 7; i += 1) {
      expect(attempt(target, false)[0]).toBe(true);
    }

    const [allowedOnEighth, retryAfter] = attempt(target, false);
    expect(allowedOnEighth).toBe(false);
    expect(retryAfter).toBeGreaterThan(0);

    // And it stays refused without further failures being needed.
    expect(attempt(target, null)[0]).toBe(false);
  });

  it("bounds one account without touching another", () => {
    const victim = account();
    const bystander = account();

    for (let i = 0; i < 8; i += 1) attempt(victim, false);

    expect(attempt(victim, null)[0]).toBe(false);
    expect(attempt(bystander, null)[0]).toBe(true);
  });
});

describe("a caller trying to talk its way out of the throttle", () => {
  /**
   * The vector that made the control opt-out. `record_auth_attempt` is granted
   * to `anon`, so anyone with the publishable key can POST to it — and if
   * asserting "the sign-in succeeded" were enough to clear the counter, an
   * attacker would clear it between guesses and the allowance would never run
   * down.
   */
  it("cannot clear a window it has not signed in to", () => {
    const victim = account();

    for (let i = 0; i < 8; i += 1) attempt(victim, false);
    expect(attempt(victim, null)[0]).toBe(false);

    // Claiming success about somebody else's account, with their exact hash.
    expect(callAs(null, victim, true)).toEqual([true, 0]);

    // Nothing was cleared, and the block is still in force.
    expect(windowRows(victim)).toBe("1");
    expect(attempt(victim, null)[0]).toBe(false);
  });

  /**
   * The same attempt with a real session behind it. Being signed in as
   * *someone* is not being signed in as the account named in the argument, and
   * the argument is what an attacker controls.
   */
  it("cannot clear another account's window while signed in as its own", () => {
    const victim = account();
    const attacker = account();

    for (let i = 0; i < 8; i += 1) attempt(victim, false);

    expect(callAs(attacker, victim, true)).toEqual([true, 0]);

    expect(windowRows(victim)).toBe("1");
    expect(attempt(victim, null)[0]).toBe(false);
  });

  /**
   * A client that could choose its own allowance would be choosing whether to
   * be throttled. The overload that let it is gone rather than defaulted.
   */
  it("cannot choose the allowance, because there is no argument for it", () => {
    const error = db.sqlExpectingError(
      `select * from public.record_auth_attempt('${account().hash}', false, 100000, 1);`,
    );
    expect(error).toMatch(/does not exist/i);
  });
});

describe("what it must not break", () => {
  it("allows an untouched account", () => {
    expect(attempt(account(), null)).toEqual([true, 0]);
  });

  /**
   * A customer who mistypes twice and then signs in correctly must not carry
   * that history — holding a grudge is a support ticket, not a control. The
   * clear is now keyed on the session the successful sign-in just produced,
   * so this is also the test that the legitimate path still works at all.
   */
  it("clears the window for the account that actually signed in", () => {
    const target = account();

    for (let i = 0; i < 5; i += 1) attempt(target, false);
    expect(callAs(target, target, true)).toEqual([true, 0]);

    expect(windowRows(target)).toBe("0");
    expect(attempt(target, null)[0]).toBe(true);
  });

  /**
   * The identifier argument is redundant on the success path, and a caller
   * that gets it wrong — a stale form value, a different capitalization —
   * still clears its own window rather than nothing.
   */
  it("clears by session identity even when the argument disagrees", () => {
    const target = account();
    const unrelated = account();

    for (let i = 0; i < 5; i += 1) attempt(target, false);
    callAs(target, unrelated, true);

    expect(windowRows(target)).toBe("0");
  });

  it("matches the address case-insensitively, the way the caller hashes it", () => {
    const target = account();

    for (let i = 0; i < 3; i += 1) attempt(target, false);
    callAs({ email: target.email.toUpperCase(), hash: target.hash }, target, true);

    expect(windowRows(target)).toBe("0");
  });
});

describe("the boundary around it", () => {
  it("stores a hash and never an address", () => {
    const target = account();
    attempt(target, false);

    const stored = db.sql(
      `select identifier_hash from public.auth_attempt_windows where identifier_hash = '${target.hash}';`,
    );
    expect(stored).toBe(target.hash);
    expect(stored).not.toContain("@");
  });

  it("refuses an identifier that is not a sha-256", () => {
    // The failure mode this guards: a caller passing the address itself, which
    // would put a register of e-mail addresses in the table.
    const error = db.sqlExpectingError(
      `select * from public.record_auth_attempt('someone@example.com', false);`,
    );
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
          ` select * from public.record_auth_attempt('${account().hash}', null); commit;`,
      );
    }
  });
});
