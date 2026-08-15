import { describe, expect, it } from "vitest";
import {
  calendarDayIn,
  completedDays,
  DEFAULT_MEASUREMENT_TIMEZONE,
  planWindows,
  startOfDayIn,
  windowHasClosed,
  windowsOverlap,
} from "./windows";

/**
 * Baseline and post-change windows (Sprint 12B §11, §13, §32, §42).
 *
 * The three mutations these exist to kill:
 *
 *  - the windows overlap, so part of a period is compared against itself
 *  - the merge day is included, importing partial-period bias
 *  - the timezone is implicit, so the answer depends on where the server is
 */

const MERGED_AT = new Date("2026-08-14T14:40:56.438Z");

function seoWindows(timezone?: string) {
  return planWindows({
    mergedAt: MERGED_AT,
    baselineDays: 28,
    measurementDays: 28,
    settlingDays: 14,
    timezone,
  });
}

describe("the windows cannot overlap (§42)", () => {
  it("places the measurement strictly after the baseline", () => {
    const { baseline, measurement } = seoWindows();

    expect(windowsOverlap(baseline, measurement)).toBe(false);
    expect(Date.parse(measurement.start)).toBeGreaterThan(Date.parse(baseline.end));
  });

  it("treats adjacency as non-overlapping, not as overlap", () => {
    // Half-open windows: a baseline ending exactly where a measurement begins
    // shares no instant. Getting this backwards would reject every correct plan.
    const adjacent = planWindows({
      mergedAt: MERGED_AT,
      baselineDays: 7,
      measurementDays: 7,
      settlingDays: 0,
    });

    expect(windowsOverlap(adjacent.baseline, adjacent.baseline)).toBe(true);
    expect(windowsOverlap(adjacent.baseline, adjacent.measurement)).toBe(false);
  });

  it("keeps them disjoint even with no settling gap at all", () => {
    const { baseline, measurement } = planWindows({
      mergedAt: MERGED_AT,
      baselineDays: 7,
      measurementDays: 7,
      settlingDays: 0,
    });

    expect(windowsOverlap(baseline, measurement)).toBe(false);
  });
});

describe("the merge day is excluded from both sides (§13)", () => {
  const mergeDay = "2026-08-14";

  it("ends the baseline where the merge day begins", () => {
    const { baseline } = seoWindows();

    expect(baseline.end).toBe(startOfDayIn(mergeDay, "UTC").toISOString());
  });

  it("starts the measurement after the merge day plus the settling gap", () => {
    const { measurement } = seoWindows();

    // Merge day 14 Aug, excluded. Settling 15–28 Aug, 14 days. Window opens 29th.
    expect(measurement.start).toBe(startOfDayIn("2026-08-29", "UTC").toISOString());
  });

  it("never includes the partial merge day in the baseline, whatever the hour", () => {
    // A merge at one minute past midnight and one at 23:59 must produce the
    // same baseline — otherwise the comparison depends on the clock (§13).
    const early = planWindows({
      mergedAt: new Date("2026-08-14T00:01:00.000Z"),
      baselineDays: 7,
      measurementDays: 7,
      settlingDays: 0,
    });
    const late = planWindows({
      mergedAt: new Date("2026-08-14T23:59:00.000Z"),
      baselineDays: 7,
      measurementDays: 7,
      settlingDays: 0,
    });

    expect(early.baseline).toEqual(late.baseline);
    expect(early.measurement).toEqual(late.measurement);
  });
});

describe("windows are whole calendar days (§13)", () => {
  it("covers exactly the requested number of days", () => {
    const { baseline, measurement } = seoWindows();

    const days = (window: { start: string; end: string }) =>
      (Date.parse(window.end) - Date.parse(window.start)) / (24 * 60 * 60 * 1000);

    expect(days(baseline)).toBe(28);
    expect(days(measurement)).toBe(28);
    expect(baseline.days).toBe(28);
  });

  it("starts and ends at midnight in the stated zone", () => {
    const { baseline } = seoWindows("America/New_York");

    expect(calendarDayIn(new Date(baseline.start), "America/New_York")).toBe("2026-07-17");
    // The instant itself is not midnight UTC — it is midnight *there*.
    expect(baseline.start).not.toContain("T00:00:00.000Z");
  });
});

describe("the timezone is explicit and never implicit (§32)", () => {
  it("defaults to a documented zone rather than the server's", () => {
    expect(DEFAULT_MEASUREMENT_TIMEZONE).toBe("UTC");
    expect(seoWindows().baseline.timezone).toBe("UTC");
  });

  it("carries the zone on every window", () => {
    const { baseline, measurement } = seoWindows("Europe/Berlin");

    expect(baseline.timezone).toBe("Europe/Berlin");
    expect(measurement.timezone).toBe("Europe/Berlin");
  });

  it("produces genuinely different instants in different zones", () => {
    // If this were not true the zone would be decorative, and a customer's
    // "week" would silently be somebody else's.
    expect(seoWindows("UTC").baseline.start).not.toBe(
      seoWindows("Australia/Sydney").baseline.start,
    );
  });

  it("handles a zone whose offset is not a whole hour", () => {
    const { baseline } = planWindows({
      mergedAt: MERGED_AT,
      baselineDays: 7,
      measurementDays: 7,
      settlingDays: 0,
      timezone: "Asia/Kolkata",
    });

    expect(calendarDayIn(new Date(baseline.start), "Asia/Kolkata")).toBe("2026-08-07");
  });

  it("handles a merge that falls on a different day in another zone", () => {
    // 23:30 UTC on the 14th is already the 15th in Sydney, so the baseline
    // there ends a day later. Getting this wrong shifts a whole window.
    const lateNight = new Date("2026-08-14T23:30:00.000Z");

    expect(calendarDayIn(lateNight, "UTC")).toBe("2026-08-14");
    expect(calendarDayIn(lateNight, "Australia/Sydney")).toBe("2026-08-15");
  });
});

describe("the result becomes available when the window closes (§22)", () => {
  it("reports the measurement window's end", () => {
    const plan = seoWindows();
    expect(plan.resultAvailableAt).toBe(plan.measurement.end);
  });

  it("is not closed before its end and is closed at it", () => {
    const { measurement } = seoWindows();

    expect(windowHasClosed(measurement, new Date(Date.parse(measurement.end) - 1))).toBe(false);
    expect(windowHasClosed(measurement, new Date(measurement.end))).toBe(true);
  });
});

describe("progress is counted in complete days, and never exceeds the window (§23)", () => {
  const { measurement } = seoWindows();

  it("is zero before the window opens", () => {
    expect(completedDays(measurement, new Date(measurement.start))).toBe(0);
    expect(completedDays(measurement, new Date(Date.parse(measurement.start) - 5_000))).toBe(0);
  });

  it("counts only whole elapsed days", () => {
    const halfway = new Date(Date.parse(measurement.start) + 3.5 * 24 * 60 * 60 * 1000);
    expect(completedDays(measurement, halfway)).toBe(3);
  });

  it("never reports more days than the window has", () => {
    // "31 of 28 complete days observed" is the kind of nonsense a progress
    // display should be incapable of.
    const longAfter = new Date(Date.parse(measurement.end) + 30 * 24 * 60 * 60 * 1000);
    expect(completedDays(measurement, longAfter)).toBe(28);
  });
});

describe("windows do not move once computed (§42)", () => {
  it("is a pure function of its inputs", () => {
    expect(seoWindows()).toEqual(seoWindows());
  });

  it("does not depend on when it is called", () => {
    // The plan is derived from the merge instant, never from `now` — a window
    // that drifted with the calendar would change a historical result.
    const first = seoWindows();
    const second = seoWindows();
    expect(first.baseline.start).toBe(second.baseline.start);
    expect(first.measurement.end).toBe(second.measurement.end);
  });
});
