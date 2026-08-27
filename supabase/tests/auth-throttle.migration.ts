import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * VB-010 / VB-053 — one account cannot be guessed at indefinitely, and the
 * control cannot be turned on a customer by the party it is bounding.
 *
 * The finding's own verification is "scripted brute-force throttled per
 * account", so that is what the first block does: it runs the attempts rather
 * than asserting the arithmetic that ought to bound them.
 *
 * The second block is the one the first version of this file did not have, and
 * the omission was the defect. Every test here asked whether the mechanism
 * *works*; none asked what a hostile caller could do with it. The answer turned
 * out to be "quite a lot", because the function was granted to `anon` — which
 * is anyone holding the publishable key, and that key is published.
 *
 * Under [ADR 0060](../../docs/decisions/0060-sign-in-throttle-authority.md)
 * there is no hostile caller left to test: `execute` is revoked from both Data
 * API roles and the only caller is Vibe's own server with a service-role
 * client. So the load-bearing assertion is now the **privilege** one, and the
 * behavioural tests run as the privileged caller because that is the only
 * caller there is.
 *
 * It has to be real PostgreSQL. The whole mechanism is one `SECURITY DEFINER`
 * function doing an upsert with a windowed counter, and `FakeDatabase` models
 * neither `on conflict do update` against a moving clock nor the privilege
 * boundary that is now the entire security argument.
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

/**
 * `[allowed, retryAfterSeconds]` from one call, made **as `service_role`**.
 *
 * The role matters and is not decoration. The harness connects as the function's
 * owner, who can execute it whatever the grants say — so a fixture that used the
 * default connection would pass every assertion below with `service_role` holding
 * no privilege at all. That is not hypothetical: `20260827233010` shipped exactly
 * that state, and reading `pg_proc.proacl` back is what caught it, not this file.
 *
 * Running every behavioural call under the role the application actually uses
 * makes the grant load-bearing for the whole file rather than for one assertion.
 */
function callAs(target: Account, succeeded: boolean | null): [boolean, number] {
  const value = succeeded === null ? "null" : String(succeeded);
  const row = db.sqlLast(
    `begin; set local role service_role;` +
      ` select allowed::text || '|' || retry_after_seconds::text` +
      ` from public.record_auth_attempt('${target.hash}', ${value}); commit;`,
  );
  const [allowed, retry] = row.split("|");
  return [allowed === "true", Number(retry)];
}

const attempt = callAs;

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

describe("who may call it at all", () => {
  /**
   * The whole of VB-053. Everything the previous version of this file tried to
   * defend against — forged failures locking a known address out, a forged
   * success clearing a victim's counter — required reaching the function, and
   * nothing else could stop it once reached.
   */
  it.each(["anon", "authenticated"])("refuses %s outright", (role) => {
    const error = db.sqlExpectingError(
      `begin; set local role ${role};` +
        ` select * from public.record_auth_attempt('${account().hash}', null); commit;`,
    );

    expect(error).toMatch(/permission denied/i);
  });

  /**
   * The complement, and the assertion whose absence let a broken grant ship:
   * the caller that is allowed must still be able to call. Stated as a
   * privilege rather than only as behaviour, because behaviour alone passes
   * when the harness runs as the owner.
   */
  it("allows service_role, which is the only caller there is", () => {
    const granted = db.sql(
      `select has_function_privilege('service_role',` +
        ` 'public.record_auth_attempt(text, boolean)', 'execute')::text;`,
    );

    expect(granted).toBe("true");
    expect(callAs(account(), false)).toEqual([true, 0]);
  });

  it("is still not readable as a table by either Data API role", () => {
    for (const role of ["anon", "authenticated"]) {
      const error = db.sqlExpectingError(
        `begin; set local role ${role}; select count(*) from public.auth_attempt_windows; commit;`,
      );
      expect(error).toMatch(/permission denied/i);
    }
  });

  /**
   * A client that could choose its own allowance would be choosing whether to
   * be throttled. The overload that let it is gone rather than defaulted.
   */
  it("has no overload that lets a caller choose the allowance", () => {
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
   * that history — holding a grudge is a support ticket, not a control.
   *
   * The clear is keyed on the identifier argument again, which was the shape
   * before `20260827210658` and is safe again for a different reason: the
   * argument is only as trustworthy as the caller, and there is now exactly one
   * caller (ADR 0060). A publicly callable version of this would be forgeable
   * and was.
   */
  it("clears the window on a success", () => {
    const target = account();

    for (let i = 0; i < 5; i += 1) attempt(target, false);
    expect(callAs(target, true)).toEqual([true, 0]);

    expect(windowRows(target)).toBe("0");
    expect(attempt(target, null)[0]).toBe(true);
  });

  it("clears exactly the account named and leaves the others standing", () => {
    const signedIn = account();
    const bystander = account();

    for (let i = 0; i < 5; i += 1) attempt(signedIn, false);
    for (let i = 0; i < 5; i += 1) attempt(bystander, false);

    callAs(signedIn, true);

    expect(windowRows(signedIn)).toBe("0");
    expect(windowRows(bystander)).toBe("1");
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

  /*
   * The half of this that asserted the function was *reachable* by anon is
   * gone rather than weakened: ADR 0060 makes unreachability the entire
   * security argument, so asserting the opposite would be asserting the
   * defect. Both halves now live in "who may call it at all" above.
   */
});
