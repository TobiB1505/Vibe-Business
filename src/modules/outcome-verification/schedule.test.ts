import { describe, expect, it } from "vitest";
import { DEFAULT_OUTCOME_BUDGETS } from "./budgets";
import { observationSchedule, windowDeadline, withinWindow } from "./schedule";

/**
 * The bounded observation window (Sprint 12A §17, §42, §45).
 *
 * The mutation these tests exist to kill is "the deadline is removed", in every
 * form it can take: an unbounded schedule, a window that never closes, and a
 * `withinWindow` that treats a missing deadline as permission.
 */

describe("the schedule is bounded (§17, §42)", () => {
  it("makes a small, fixed number of attempts", () => {
    const schedule = observationSchedule();

    expect(schedule).toHaveLength(7);
    // Seven attempts × two endpoints. A whole verification's worst case is
    // fourteen public GETs, which is politeness as much as budget.
    expect(schedule.length * 2).toBeLessThanOrEqual(16);
  });

  it("starts immediately, so an already-deployed product answers at once (§20)", () => {
    expect(observationSchedule()[0]).toEqual({ index: 0, offsetMs: 0, sleepMs: 0 });
  });

  it("never schedules an attempt past the window", () => {
    for (const attempt of observationSchedule()) {
      expect(attempt.offsetMs).toBeLessThanOrEqual(DEFAULT_OUTCOME_BUDGETS.observationWindowMs);
    }
  });

  it("has a strictly increasing, non-negative sleep sequence", () => {
    const schedule = observationSchedule();

    for (let index = 1; index < schedule.length; index += 1) {
      expect(schedule[index].offsetMs).toBeGreaterThan(schedule[index - 1].offsetMs);
      expect(schedule[index].sleepMs).toBeGreaterThan(0);
    }
  });

  it("sleeps for exactly the gap between attempts", () => {
    const schedule = observationSchedule();
    const total = schedule.reduce((sum, attempt) => sum + attempt.sleepMs, 0);

    expect(total).toBe(schedule[schedule.length - 1].offsetMs);
  });

  it("is front-loaded, so a fast deployment is caught early", () => {
    const schedule = observationSchedule();
    const withinTwoMinutes = schedule.filter((attempt) => attempt.offsetMs <= 120_000);

    expect(withinTwoMinutes.length).toBeGreaterThanOrEqual(4);
  });

  it("discards offsets outside the window rather than extending it", () => {
    const schedule = observationSchedule({
      ...DEFAULT_OUTCOME_BUDGETS,
      observationWindowMs: 60_000,
      attemptOffsetsMs: [0, 30_000, 60_000, 900_000],
    });

    expect(schedule.map((attempt) => attempt.offsetMs)).toEqual([0, 30_000, 60_000]);
  });

  it("is deterministic, so a replay walks the identical loop (§42)", () => {
    expect(observationSchedule()).toEqual(observationSchedule());
  });
});

describe("the deadline is a fixed point in time (§17, §42)", () => {
  const start = new Date("2026-08-14T14:45:00.000Z");

  it("is the window length after the start", () => {
    expect(windowDeadline(start).toISOString()).toBe("2026-08-14T15:00:00.000Z");
  });

  it("is fifteen minutes by default", () => {
    expect(DEFAULT_OUTCOME_BUDGETS.observationWindowMs).toBe(15 * 60 * 1000);
  });

  it("does not move when recomputed from the same start", () => {
    expect(windowDeadline(start)).toEqual(windowDeadline(start));
  });
});

describe("withinWindow fails closed (§42, §45)", () => {
  const deadline = "2026-08-14T15:00:00.000Z";

  it("permits an attempt before the deadline", () => {
    expect(withinWindow(deadline, new Date("2026-08-14T14:59:59.000Z"))).toBe(true);
  });

  it("refuses at and after the deadline", () => {
    expect(withinWindow(deadline, new Date(deadline))).toBe(false);
    expect(withinWindow(deadline, new Date("2026-08-14T15:00:01.000Z"))).toBe(false);
  });

  it("treats a missing deadline as expired, never as unlimited", () => {
    // The direction matters. One observation fewer is a far better failure than
    // a workflow polling somebody's production website forever — which is what
    // a mutation removing the deadline would otherwise produce (§45).
    expect(withinWindow(null, new Date("2026-08-14T14:45:00.000Z"))).toBe(false);
  });

  it("treats an unparseable deadline as expired", () => {
    expect(withinWindow("not a date", new Date("2026-08-14T14:45:00.000Z"))).toBe(false);
  });
});
