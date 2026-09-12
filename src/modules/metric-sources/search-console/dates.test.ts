import { describe, expect, it } from "vitest";
import {
  assessCompleteness,
  calendarDayIn,
  nextDay,
  previousDay,
  toProviderRange,
  withPendingDays,
} from "./dates";

/**
 * Provider date semantics (Sprint 12C §52).
 *
 * The brief calls this "load-bearing" and it is: every assertion here protects
 * against a bug that produces perfectly plausible numbers about the wrong days.
 * Nothing downstream — not the classifier, not the minimum-sample check, not
 * the UI — could detect a window silently shifted by one day.
 */

describe("Search Console reads dates in Pacific Time, not UTC", () => {
  it("resolves an instant to the PT calendar day, not the UTC one", () => {
    // In August PT is UTC−7, so 06:00Z on the 15th is 23:00 on the 14th in Los
    // Angeles. A UTC-derived boundary calls the same instant the 15th and
    // shifts the whole window by a day.
    expect(calendarDayIn("2026-08-15T06:00:00.000Z", "America/Los_Angeles")).toBe("2026-08-14");
    expect(calendarDayIn("2026-08-15T06:00:00.000Z", "UTC")).toBe("2026-08-15");

    // 07:00Z is exactly midnight PT — the first instant of the 15th, and the
    // boundary a window's start lands on.
    expect(calendarDayIn("2026-08-15T07:00:00.000Z", "America/Los_Angeles")).toBe("2026-08-15");
  });

  it("follows daylight saving rather than a fixed offset", () => {
    // In January PT is UTC−8, so 07:30Z is still the previous day; in August
    // it is UTC−7 and 07:30Z has already rolled over. A hardcoded −8 would get
    // the second case wrong for two-thirds of the year.
    expect(calendarDayIn("2026-01-15T07:30:00.000Z", "America/Los_Angeles")).toBe("2026-01-14");
    expect(calendarDayIn("2026-08-15T07:30:00.000Z", "America/Los_Angeles")).toBe("2026-08-15");
  });

  it("does not depend on the host timezone", () => {
    // The same instant, asked for in the same zone, must give the same answer
    // wherever the function runs — a measurement must not change because a
    // Vercel function was scheduled in a different region.
    const instant = "2026-08-15T03:00:00.000Z";
    const first = calendarDayIn(instant, "America/Los_Angeles");
    const original = process.env.TZ;
    try {
      process.env.TZ = "Asia/Tokyo";
      expect(calendarDayIn(instant, "America/Los_Angeles")).toBe(first);
      process.env.TZ = "UTC";
      expect(calendarDayIn(instant, "America/Los_Angeles")).toBe(first);
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("half-open windows become inclusive provider ranges", () => {
  const window = {
    // A 28-day window, half-open: 17 July through 13 August inclusive.
    start: "2026-07-17T07:00:00.000Z",
    end: "2026-08-14T07:00:00.000Z",
  };

  it("excludes the window's end day", () => {
    // Sprint 12B windows are [start, end). Google's endDate is inclusive.
    // Passing the end straight through would measure 29 days and call it 28.
    const range = toProviderRange(window);

    expect(range.startDate).toBe("2026-07-17");
    expect(range.endDate).toBe("2026-08-13");
    expect(range.days).toHaveLength(28);
  });

  it("enumerates every day in the range", () => {
    const range = toProviderRange(window);

    expect(range.days[0]).toBe("2026-07-17");
    expect(range.days.at(-1)).toBe("2026-08-13");
    expect(new Set(range.days).size).toBe(28);
  });

  it("refuses a window shorter than a provider day", () => {
    expect(() =>
      toProviderRange({ start: "2026-08-15T07:00:00.000Z", end: "2026-08-15T12:00:00.000Z" }),
    ).toThrowError(/shorter than a provider day/);
  });
});

describe("day arithmetic crosses DST without drifting", () => {
  it("steps across a spring-forward boundary", () => {
    // 8 March 2026 is a US DST transition. Arithmetic that adds 86,400,000 ms
    // lands at 23:00 the same day and truncates back to the day it started on.
    expect(nextDay("2026-03-07")).toBe("2026-03-08");
    expect(nextDay("2026-03-08")).toBe("2026-03-09");
    expect(previousDay("2026-03-08")).toBe("2026-03-07");
  });

  it("steps across month and year boundaries", () => {
    expect(nextDay("2026-08-31")).toBe("2026-09-01");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
  });
});

describe("a missing day is pending, never zero", () => {
  const range = toProviderRange({
    start: "2026-08-01T07:00:00.000Z",
    end: "2026-08-04T07:00:00.000Z",
  });

  it("marks days the provider did not finalize", () => {
    const days = withPendingDays(range, [
      { day: "2026-08-01", impressions: 120 },
      { day: "2026-08-02", impressions: 0 },
    ]);

    expect(days).toEqual([
      { day: "2026-08-01", state: "final", impressions: 120 },
      // An explicit zero from the provider is a real observation and stays one.
      { day: "2026-08-02", state: "final", impressions: 0 },
      { day: "2026-08-03", state: "pending" },
    ]);
  });

  it("counts an unfinalized day as missing rather than as zero", () => {
    const completeness = assessCompleteness(
      range,
      withPendingDays(range, [{ day: "2026-08-01", impressions: 5 }]),
    );

    expect(completeness).toEqual({
      expectedDays: 3,
      finalizedDays: 1,
      pendingDays: 2,
      complete: false,
    });
  });

  it("is complete only when every requested day came back finalized", () => {
    const all = withPendingDays(range, [
      { day: "2026-08-01", impressions: 1 },
      { day: "2026-08-02", impressions: 2 },
      { day: "2026-08-03", impressions: 3 },
    ]);

    expect(assessCompleteness(range, all).complete).toBe(true);
    // A zero-impression day still counts as finalized data.
    const withZero = withPendingDays(range, [
      { day: "2026-08-01", impressions: 0 },
      { day: "2026-08-02", impressions: 0 },
      { day: "2026-08-03", impressions: 0 },
    ]);
    expect(assessCompleteness(range, withZero).complete).toBe(true);
  });

  it("ignores provider rows outside the requested range", () => {
    // A provider that returns a day we did not ask for must not inflate the
    // completeness count for a day we did.
    const days = withPendingDays(range, [
      { day: "2026-07-31", impressions: 999 },
      { day: "2026-08-01", impressions: 1 },
    ]);

    expect(days).toHaveLength(3);
    expect(assessCompleteness(range, days).finalizedDays).toBe(1);
  });
});
