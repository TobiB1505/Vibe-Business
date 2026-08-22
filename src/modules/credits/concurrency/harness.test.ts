import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyError, resolveTarget, UnsafeTargetError } from "./harness";

/**
 * The target guard is the mechanism, so it is tested where CI can see it.
 *
 * The concurrency suite itself needs Docker and cannot run in `pnpm test`. What
 * *can* run here is the thing that decides where that suite is allowed to
 * write — and that is the part worth pinning, because a race matrix writes
 * deliberately conflicting rows into an append-only ledger. A guard that only
 * runs where the guarded thing runs is a guard nobody checks.
 */

const SAVED = { ...process.env };

const LOCAL = {
  CONCURRENCY_SUPABASE_URL: "http://127.0.0.1:54321",
  CONCURRENCY_SERVICE_ROLE_KEY: "local-demo-key",
};

beforeEach(() => {
  for (const name of [
    "CONCURRENCY_SUPABASE_URL",
    "CONCURRENCY_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
  ]) {
    delete process.env[name];
  }
});

afterEach(() => {
  process.env = { ...SAVED };
});

describe("the concurrency harness runs only against a disposable local stack", () => {
  it("accepts a loopback stack", () => {
    Object.assign(process.env, LOCAL);
    expect(resolveTarget()).toEqual({
      url: "http://127.0.0.1:54321",
      serviceRoleKey: "local-demo-key",
    });
  });

  it("accepts localhost and IPv6 loopback too", () => {
    for (const url of ["http://localhost:54321", "http://[::1]:54321"]) {
      Object.assign(process.env, { ...LOCAL, CONCURRENCY_SUPABASE_URL: url });
      expect(resolveTarget().url).toBe(url);
    }
  });

  it("refuses any host that is not loopback", () => {
    Object.assign(process.env, {
      ...LOCAL,
      CONCURRENCY_SUPABASE_URL: "https://example.supabase.co",
    });
    expect(() => resolveTarget()).toThrow(UnsafeTargetError);
  });

  /**
   * Redundant with the loopback rule today. The redundancy is the point: it
   * survives somebody deciding loopback is too strict.
   */
  it("refuses the deployed project by name", () => {
    Object.assign(process.env, {
      ...LOCAL,
      CONCURRENCY_SUPABASE_URL: "https://dcbwlctscooefwnivxzv.supabase.co",
    });
    expect(() => resolveTarget()).toThrow(/names the deployed project|not point at loopback/);
  });

  /**
   * The failure this exists for: code under test that builds its own client.
   *
   * `expireStaleAgentExecution` reads `NEXT_PUBLIC_SUPABASE_URL` and
   * `SUPABASE_SERVICE_ROLE_KEY` itself rather than accepting a client, so
   * checking only the harness's own target would let a scenario reach a
   * database this guard never looked at.
   */
  it("refuses when the application's own url is not loopback", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dcbwlctscooefwnivxzv.supabase.co";
    Object.assign(process.env, LOCAL);
    expect(() => resolveTarget()).toThrow(/NEXT_PUBLIC_SUPABASE_URL does not point at loopback/);
  });

  it("accepts an application url that names the same local stack", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "local-demo-key";
    Object.assign(process.env, LOCAL);
    expect(() => resolveTarget()).not.toThrow();
  });

  it("refuses to fall back to the application's variables", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dcbwlctscooefwnivxzv.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "the-real-one";
    // Nothing sets the harness's own names, so there is nothing to inherit.
    expect(() => resolveTarget()).toThrow(/CONCURRENCY_SUPABASE_URL is not set/);
  });

  it("refuses a missing key even with a valid local url", () => {
    process.env.CONCURRENCY_SUPABASE_URL = LOCAL.CONCURRENCY_SUPABASE_URL;
    expect(() => resolveTarget()).toThrow(/CONCURRENCY_SERVICE_ROLE_KEY is not set/);
  });

  it("refuses a url it cannot parse", () => {
    Object.assign(process.env, { ...LOCAL, CONCURRENCY_SUPABASE_URL: "not-a-url" });
    expect(() => resolveTarget()).toThrow(/is not a URL/);
  });

  /** No refusal may echo a value — CI logs are not a place for key material. */
  it("never repeats the value it refused", () => {
    Object.assign(process.env, {
      ...LOCAL,
      CONCURRENCY_SUPABASE_URL: "https://secret-host.example.com",
      CONCURRENCY_SERVICE_ROLE_KEY: "sk-do-not-log-me",
    });
    let message = "";
    try {
      resolveTarget();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain("secret-host");
    expect(message).not.toContain("sk-do-not-log-me");
    expect(message).toContain("does not point at loopback");
  });
});

describe("database errors are named, not repeated", () => {
  it("maps the SQLSTATEs a race can produce", () => {
    expect(classifyError({ code: "23505" })).toEqual({
      pgCode: "23505",
      kind: "unique_violation",
    });
    expect(classifyError({ code: "23514" }).kind).toBe("check_violation");
    expect(classifyError({ code: "40001" }).kind).toBe("serialization_failure");
    expect(classifyError({ code: "40P01" }).kind).toBe("deadlock_detected");
    // The auto_expose_new_tables assumption: this is the code that says it
    // was wrong, and E2b stops on it rather than adding a GRANT migration.
    expect(classifyError({ code: "42501" }).kind).toBe("insufficient_privilege");
  });

  it("does not lose an unknown code", () => {
    expect(classifyError({ code: "XX000" })).toEqual({ pgCode: "XX000", kind: "other" });
  });

  it("survives an error with no code at all", () => {
    expect(classifyError(new Error("connection lost"))).toEqual({ pgCode: null, kind: "other" });
    expect(classifyError(undefined)).toEqual({ pgCode: null, kind: "other" });
  });
});
