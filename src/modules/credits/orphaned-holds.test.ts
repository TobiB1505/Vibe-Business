import { describe, expect, it } from "vitest";
import { creditsToUnits } from "./units";
import { SETTLEMENT_GRACE_MS, findOrphanedHolds } from "./orphaned-holds";

/**
 * VB-020 — a Credit hold left standing over an operation that has finished.
 *
 * The tests that matter are the negative ones. "Terminal operation, active
 * hold" is a state every successful operation passes through — the completion
 * and the settlement are two writes milliseconds apart — so a detector without
 * a grace window reports every operation in flight, and a detector that fires
 * on the happy path is one people learn to ignore.
 */

const NOW = new Date("2026-08-27T22:00:00.000Z");

function at(msAgo: number): string {
  return new Date(NOW.getTime() - msAgo).toISOString();
}

function hold(overrides: Partial<{ id: string; operationRunId: string | null }> = {}) {
  return {
    id: "reservation_1",
    operationRunId: "operation_1",
    reservedCredits: creditsToUnits(35),
    ...overrides,
  };
}

function operation(overrides: Partial<{ status: string; completedAt: string | null }> = {}) {
  return {
    id: "operation_1",
    operationType: "business_audit",
    status: "failed",
    completedAt: at(SETTLEMENT_GRACE_MS * 2),
    ...overrides,
  };
}

describe("what it reports", () => {
  it("finds a hold outliving a failed operation, and says a release is owed", () => {
    const found = findOrphanedHolds({
      reservations: [hold()],
      operations: [operation({ status: "failed" })],
      now: NOW,
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      reservationId: "reservation_1",
      operationId: "operation_1",
      owed: "release",
    });
  });

  /**
   * The distinction the repair turns on. A completed operation delivered the
   * work, so what the crash abandoned was a settlement — releasing instead
   * would refund work the customer received.
   */
  it("says a settlement is owed when the operation completed", () => {
    const found = findOrphanedHolds({
      reservations: [hold()],
      operations: [operation({ status: "completed" })],
      now: NOW,
    });

    expect(found[0]?.owed).toBe("settlement");
  });

  it("reports a cancelled operation as owing a release", () => {
    const found = findOrphanedHolds({
      reservations: [hold()],
      operations: [operation({ status: "cancelled" })],
      now: NOW,
    });

    expect(found[0]?.owed).toBe("release");
  });

  it("says how long the hold has outlived its operation", () => {
    const found = findOrphanedHolds({
      reservations: [hold()],
      operations: [operation({ completedAt: at(60 * 60 * 1000) })],
      now: NOW,
    });

    expect(found[0]?.durationMs).toBe(60 * 60 * 1000);
  });
});

describe("what it must not report", () => {
  /**
   * The whole reason for the grace window. Completing an operation and
   * finalizing its billing are two writes, so every successful operation is
   * momentarily in exactly this state.
   */
  it("stays quiet during the ordinary gap between completing and settling", () => {
    expect(
      findOrphanedHolds({
        reservations: [hold()],
        operations: [operation({ status: "completed", completedAt: at(200) })],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("stays quiet right up to the grace window", () => {
    expect(
      findOrphanedHolds({
        reservations: [hold()],
        operations: [operation({ completedAt: at(SETTLEMENT_GRACE_MS - 1) })],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("leaves a running operation's hold alone, however old", () => {
    expect(
      findOrphanedHolds({
        reservations: [hold()],
        operations: [
          operation({ status: "running", completedAt: at(SETTLEMENT_GRACE_MS * 100) }),
        ],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("leaves a paused operation's hold alone — needs_user is not terminal", () => {
    expect(
      findOrphanedHolds({
        reservations: [hold()],
        operations: [
          operation({ status: "needs_user", completedAt: at(SETTLEMENT_GRACE_MS * 100) }),
        ],
        now: NOW,
      }),
    ).toEqual([]);
  });

  /**
   * A hold with no operation behind it is a different question — a quote, or a
   * row this detector has no business judging. Silence beats a guess.
   */
  it("says nothing about a hold that belongs to no operation", () => {
    expect(
      findOrphanedHolds({
        reservations: [hold({ operationRunId: null })],
        operations: [],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("says nothing when the operation row is not visible", () => {
    expect(
      findOrphanedHolds({ reservations: [hold()], operations: [], now: NOW }),
    ).toEqual([]);
  });

  /**
   * No terminal timestamp means no way to know whether the window has passed.
   * "I cannot tell" is answered with silence, not with a report.
   */
  it.each([null, "not a date"])("says nothing when completedAt is %o", (completedAt) => {
    expect(
      findOrphanedHolds({
        reservations: [hold()],
        operations: [operation({ completedAt })],
        now: NOW,
      }),
    ).toEqual([]);
  });
});

describe("several accounts' worth", () => {
  it("reports each stuck hold and skips the healthy ones in the same set", () => {
    const found = findOrphanedHolds({
      reservations: [
        hold({ id: "stuck_1", operationRunId: "op_failed" }),
        hold({ id: "healthy", operationRunId: "op_running" }),
        hold({ id: "stuck_2", operationRunId: "op_completed" }),
      ],
      operations: [
        { ...operation(), id: "op_failed", status: "failed" },
        { ...operation(), id: "op_running", status: "running" },
        { ...operation(), id: "op_completed", status: "completed" },
      ],
      now: NOW,
    });

    expect(found.map((entry) => entry.reservationId)).toEqual(["stuck_1", "stuck_2"]);
  });
});
