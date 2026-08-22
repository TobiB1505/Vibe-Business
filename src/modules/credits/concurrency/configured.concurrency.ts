import { describe, expect, it } from "vitest";
import { client, isConfigured, ITERATIONS, resolveTarget } from "./harness";

/**
 * The suite must fail when it cannot run, not pass quietly.
 *
 * Every other file here is wrapped in `describe.skipIf(!isConfigured())`, which
 * is what lets the files be collected without a database — and which would
 * otherwise turn a misconfigured CI job green having tested nothing. A gate
 * that reports success when it did no work is worse than no gate, because
 * somebody will trust it.
 *
 * So this file is deliberately *not* skippable. If the target does not resolve,
 * or the database does not answer, the run is red and says which.
 */

describe("the concurrency suite is actually pointed at a database", () => {
  it("resolves a disposable local target", () => {
    expect(
      isConfigured(),
      "the race matrix would have skipped silently — set CONCURRENCY_SUPABASE_URL " +
        "and CONCURRENCY_SERVICE_ROLE_KEY, or start a local stack with `supabase start`",
    ).toBe(true);
    expect(() => resolveTarget()).not.toThrow();
  });

  /**
   * The one place `42501` is expected to surface if ADR 0040's
   * `auto_expose_new_tables` assumption is wrong. It is checked here, before
   * any race, so the diagnosis is "the data API cannot see the table" rather
   * than twenty failing assertions further down.
   */
  it("can read a billing table through the data API", async () => {
    const { error } = await client()
      .from("billing_credit_accounts")
      .select("id")
      .limit(1);

    expect(
      error,
      "PostgREST refused a billing table. A 42501 here means the local privilege " +
        "model does not match the deployed one — ADR 0040 says to stop and record " +
        "that, not to add a GRANT migration.",
    ).toBeNull();
  });

  it("runs each race class the number of times the record claims", () => {
    expect(ITERATIONS).toBe(20);
  });
});
