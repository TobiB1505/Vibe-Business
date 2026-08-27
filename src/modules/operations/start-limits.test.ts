import { describe, expect, it } from "vitest";
import { OPERATION_TYPES } from "./schema";
import { START_LIMITS, startAllowed } from "./start-limits";

/**
 * VB-008 — every start path is bounded.
 *
 * The finding is not that one limit was set wrong; it is that only the
 * Business Audit had one at all, so a product scan, a validation, a preview,
 * a review or an agent execution could be started in a loop. Each spends real
 * money.
 *
 * So the assertion that matters most is the coverage one: a new operation type
 * must not be able to arrive unbounded. `START_LIMITS` is typed as
 * `Record<OperationType, …>`, which makes that a compile error rather than a
 * test failure — this test exists because a compile error is easy to satisfy
 * with a placeholder, and a limit of zero or of infinity would satisfy it too.
 */

describe("coverage", () => {
  it("bounds every operation type with a usable number", () => {
    for (const type of OPERATION_TYPES) {
      const limit = START_LIMITS[type];
      expect(limit, `no limit for ${type}`).toBeDefined();
      expect(limit.perAccountPerDay, `${type} daily limit`).toBeGreaterThan(0);
      expect(limit.perProjectPerHour, `${type} hourly limit`).toBeGreaterThan(0);
    }
  });

  /**
   * Erasure is the one type with no hourly project bound, and it is deliberate
   * rather than an oversight: it is account-level so it has no project, and a
   * person deleting their account must never be told to come back in an hour.
   * Its daily account bound still exists.
   */
  it("exempts only account erasure from the hourly bound, and not from the daily one", () => {
    const unbounded = OPERATION_TYPES.filter(
      (type) => START_LIMITS[type].perProjectPerHour > 1000,
    );

    expect(unbounded).toEqual(["account_erasure"]);
    expect(START_LIMITS.account_erasure.perAccountPerDay).toBeLessThan(1000);
  });
});

describe("the decision", () => {
  it("allows a start below both windows", () => {
    expect(startAllowed("business_audit", { project: 0, account: 0 })).toBe(true);
    expect(startAllowed("business_audit", { project: 4, account: 39 })).toBe(true);
  });

  it("refuses on the project window alone", () => {
    const limit = START_LIMITS.business_audit;
    expect(startAllowed("business_audit", { project: limit.perProjectPerHour, account: 0 })).toBe(
      false,
    );
  });

  /**
   * The window the project one cannot see. An account can create projects, so
   * a loop spread across many of them stays under every hourly bound while
   * spending exactly as much.
   */
  it("refuses on the account window alone", () => {
    const limit = START_LIMITS.business_audit;
    expect(startAllowed("business_audit", { project: 0, account: limit.perAccountPerDay })).toBe(
      false,
    );
  });

  it("treats the limit as a ceiling, not a target", () => {
    const limit = START_LIMITS.product_scan;
    expect(
      startAllowed("product_scan", { project: limit.perProjectPerHour - 1, account: 0 }),
    ).toBe(true);
    expect(startAllowed("product_scan", { project: limit.perProjectPerHour, account: 0 })).toBe(
      false,
    );
  });
});

describe("what the numbers say about intent", () => {
  /**
   * Not a style rule. Paid inference is the most expensive thing a loop can
   * reach, so it must not be the loosest bound — and a future edit that makes
   * it looser than free work is the mistake worth catching.
   */
  it("never bounds paid inference more loosely than free work", () => {
    expect(START_LIMITS.business_audit.perProjectPerHour).toBeLessThanOrEqual(
      START_LIMITS.product_scan.perProjectPerHour,
    );
    expect(START_LIMITS.agent_execution.perAccountPerDay).toBeLessThanOrEqual(
      START_LIMITS.product_scan.perAccountPerDay,
    );
  });
});

describe("who the limit applies to", () => {
  /**
   * VB-008's placement in `createOperationRun` covers every start path, which
   * is its strength and was also its cost: the billing concurrency gate drives
   * one project sixty times on purpose, and a per-project window refuses that.
   *
   * The resolution is the threat model rather than a looser ceiling. The limit
   * exists to stop a *customer* looping; Vibe's own machinery is already
   * bounded by the operation it belongs to. So `initiatedBy` is required at
   * every call site — a caller that forgets cannot silently become exempt,
   * because there is no default to forget into.
   *
   * This is asserted against the source rather than behaviourally because the
   * guarantee is that no *customer* site says `system`. A behavioural test
   * would prove one call is exempt; this proves none of the fifteen drifted.
   */
  it("marks no customer-facing start path as system", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".ts") && !full.includes(".test.")) {
          const source = readFileSync(full, "utf8");
          if (source.includes('initiatedBy: "system"')) offenders.push(full);
        }
      }
    };
    walk("src/modules");

    // Exactly one file may say it, and naming it here is the point: a second
    // one appearing is a customer path quietly exempting itself, which is the
    // failure this guard exists for. `.concurrency.ts` is not matched by the
    // `.test.` filter above, so the harness is listed rather than hidden.
    expect(offenders).toEqual([
      "src/modules/credits/concurrency/agent-start-failure.concurrency.ts",
    ]);
  });
});
